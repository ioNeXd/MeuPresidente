/**
 * server.js - WebRTC Signaling Server with room management and security.
 *
 * NAMING CONVENTIONS:
 * - Variables, functions, and methods: camelCase (e.g., `roomId`, `generateRoomId`).
 * - Socket.IO event names: kebab-case (e.g., `create-room`, `join-room`, `viewer-joined`).
 * - Environment variables: UPPER_SNAKE_CASE (e.g., `MAX_CONNECTIONS_PER_IP`).
 *
 * SECURITY FEATURES:
 * - Per-IP and total connection limits.
 * - Orphaned room expiration (TTL).
 * - Input validation (roomId format, password length).
 * - Conditional HSTS/COOP headers via `ALLOW_INSECURE_ORIGIN`.
 * - Explicit CORS configuration for Socket.IO.
 * - Security event logging (in-memory buffer with console output).
 * - Chat: rate limiting (500ms cooldown), max length 500 chars, HTML escaping.
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const helmet = require("helmet");

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------
const ALLOW_INSECURE_ORIGIN =
  process.env.ALLOW_INSECURE_ORIGIN === "1" || process.env.NODE_ENV !== "production";

const MAX_CONNECTIONS_PER_IP = parseInt(process.env.MAX_CONNECTIONS_PER_IP, 10) || 10;
const MAX_TOTAL_CONNECTIONS = parseInt(process.env.MAX_TOTAL_CONNECTIONS, 10) || 200;

const ROOM_TTL_MS = (parseFloat(process.env.ROOM_TTL_MINUTES) || 10) * 60 * 1000;
const ROOM_SWEEP_INTERVAL_MS = parseInt(process.env.ROOM_SWEEP_INTERVAL_MS, 10) || 60 * 1000;

const APP_ORIGINS = (process.env.APP_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// Security event logging
// ---------------------------------------------------------------------------
const MAX_SECURITY_LOG = 200;
const securityEvents = [];

function logSecurity(type, details = {}) {
  const entry = { type, at: new Date().toISOString(), ...details };
  securityEvents.push(entry);
  if (securityEvents.length > MAX_SECURITY_LOG) securityEvents.shift();
  console.log(`[security] ${type}`, JSON.stringify(details));
}

const app = express();
const server = http.createServer(app);

// ---------------------------------------------------------------------------
// Security headers (helmet) — strict in production, relaxed for local testing.
// ---------------------------------------------------------------------------
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      mediaSrc: ["'self'", "blob:"],
    },
  },
  strictTransportSecurity: ALLOW_INSECURE_ORIGIN ? false : undefined,
  crossOriginOpenerPolicy: ALLOW_INSECURE_ORIGIN ? false : undefined,
};
if (ALLOW_INSECURE_ORIGIN) {
  helmetConfig.contentSecurityPolicy.directives.upgradeInsecureRequests = null;
}
app.use(helmet(helmetConfig));

// Serve static files with caching
app.use(
  express.static("public", {
    maxAge: "1d",
    etag: true,
    setHeaders: (res, path) => {
      if (path.includes("client.js") || path.includes("style.css")) {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
    },
  })
);

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
const io = new Server(server, {
  cors: APP_ORIGINS.length > 0 ? { origin: APP_ORIGINS, methods: ["GET", "POST"] } : false,
});

const connectionsPerIp = new Map();

function normalizeIp(addr) {
  return typeof addr === "string" ? addr.replace(/^::ffff:/, "") : "unknown";
}

function getClientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      return forwarded.split(",")[0].trim();
    }
  }
  return normalizeIp(req.socket && req.socket.remoteAddress);
}

function rejectHandshake(res, status, message) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

io.engine.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host;
    const sameOrigin =
      typeof host === "string" && (origin === `http://${host}` || origin === `https://${host}`);
    const allowed = APP_ORIGINS.length > 0 ? APP_ORIGINS.includes(origin) : sameOrigin;
    if (!allowed) {
      logSecurity("origin-rejected", { origin, host });
      return rejectHandshake(res, 403, "Unauthorized origin.");
    }
  }

  if (!req._query.sid) {
    const ip = getClientIp(req);
    const current = connectionsPerIp.get(ip) || 0;
    if (current >= MAX_CONNECTIONS_PER_IP) {
      logSecurity("connection-limit-per-ip", { ip, current, limit: MAX_CONNECTIONS_PER_IP });
      return rejectHandshake(res, 429, "Per-IP connection limit reached.");
    }
    if (io.engine.clientsCount >= MAX_TOTAL_CONNECTIONS) {
      logSecurity("connection-limit-total", {
        current: io.engine.clientsCount,
        limit: MAX_TOTAL_CONNECTIONS,
      });
      return rejectHandshake(res, 429, "Server connection limit reached.");
    }
  }

  next();
});

io.engine.on("connection", (engineSocket) => {
  const ip = engineSocket.request
    ? getClientIp(engineSocket.request)
    : normalizeIp(engineSocket.remoteAddress);
  connectionsPerIp.set(ip, (connectionsPerIp.get(ip) || 0) + 1);

  engineSocket.on("close", () => {
    const n = connectionsPerIp.get(ip);
    if (n <= 1) connectionsPerIp.delete(ip);
    else connectionsPerIp.set(ip, n - 1);
  });
});

// ---------------------------------------------------------------------------
// Room management
// ---------------------------------------------------------------------------
const rooms = {};
const MAX_JOIN_ATTEMPTS = 5;
const joinAttempts = new Map();

// Chat rate limiting: one message per 500ms per socket.
const lastMessageTime = new Map(); // socket.id -> timestamp

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateRoomId() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

const ROOM_ID_RE = /^[0-9A-Fa-f]{6}$/;
const MAX_PASSWORD_LENGTH = 64;

function isValidRoomId(value) {
  return typeof value === "string" && ROOM_ID_RE.test(value.trim());
}

function isValidPassword(value, { min = 4 } = {}) {
  return typeof value === "string" && value.length >= min && value.length <= MAX_PASSWORD_LENGTH;
}

/**
 * Escapes HTML special characters to prevent XSS.
 * @param {string} str - String to escape.
 * @returns {string} Escaped string.
 */
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}

// ---- Orphaned room sweeper ----
function sweepRooms() {
  const now = Date.now();
  for (const [roomId, room] of Object.entries(rooms)) {
    const hostConnected = io.sockets.sockets.has(room.hostSocketId);
    if (hostConnected) continue;

    if (room.hostLeftAt === undefined) {
      room.hostLeftAt = now;
      continue;
    }
    if (now - room.hostLeftAt >= ROOM_TTL_MS) {
      io.to(roomId).emit("host-left");
      delete rooms[roomId];
      logSecurity("room-expired", { roomId, reason: "host-gone", idleMs: now - room.hostLeftAt });
    }
  }
}
setInterval(sweepRooms, ROOM_SWEEP_INTERVAL_MS);

io.on("connection", (socket) => {
  // ----- HOST creates a room -----
  socket.on("create-room", ({ password } = {}, callback) => {
    if (typeof callback !== "function") return;
    if (!isValidPassword(password)) {
      return callback({ ok: false, error: "Password must be at least 4 characters (max 64)." });
    }

    let roomId = generateRoomId();
    while (rooms[roomId]) roomId = generateRoomId();

    rooms[roomId] = {
      passwordHash: hashPassword(password),
      hostSocketId: socket.id,
      viewers: new Set(),
      createdAt: Date.now(),
    };

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.isHost = true;

    callback({ ok: true, roomId });
  });

  // ----- VIEWER joins an existing room -----
  socket.on("join-room", ({ roomId, password } = {}, callback) => {
    const attempts = joinAttempts.get(socket.id) || 0;
    if (attempts >= MAX_JOIN_ATTEMPTS) {
      logSecurity("join-attempts-exhausted", { socketId: socket.id, attempts });
      socket.disconnect(true);
      return;
    }
    if (typeof callback !== "function") return;

    if (!isValidRoomId(roomId)) {
      joinAttempts.set(socket.id, attempts + 1);
      return callback({ ok: false, error: "Invalid room ID format." });
    }
    if (!isValidPassword(password, { min: 1 })) {
      joinAttempts.set(socket.id, attempts + 1);
      return callback({ ok: false, error: "Invalid password." });
    }

    const normalizedRoomId = roomId.trim().toUpperCase();
    const room = rooms[normalizedRoomId];
    if (!room) {
      joinAttempts.set(socket.id, attempts + 1);
      return callback({ ok: false, error: "Room not found." });
    }
    if (room.passwordHash !== hashPassword(password)) {
      joinAttempts.set(socket.id, attempts + 1);
      logSecurity("join-rejected", {
        socketId: socket.id,
        roomId: normalizedRoomId,
        reason: "wrong-password",
      });
      return callback({ ok: false, error: "Incorrect password." });
    }

    joinAttempts.delete(socket.id);
    socket.join(normalizedRoomId);
    socket.data.roomId = normalizedRoomId;
    socket.data.isHost = false;
    room.viewers.add(socket.id);

    socket.to(room.hostSocketId).emit("viewer-joined", { viewerId: socket.id });

    callback({ ok: true });
  });

  // ----- WebRTC signaling -----
  socket.on("signal", ({ to, data } = {}) => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms[roomId];
    if (!room) return;

    if (typeof to !== "string" || !data || typeof data !== "object") return;

    const isSenderHost = socket.data.isHost && room.hostSocketId === socket.id;
    const isSenderViewer = !socket.data.isHost && room.viewers.has(socket.id);

    const targetIsHost = to === room.hostSocketId;
    const targetIsViewer = room.viewers.has(to);

    const allowed = (isSenderHost && targetIsViewer) || (isSenderViewer && targetIsHost);

    if (!allowed) return;

    io.to(to).emit("signal", { from: socket.id, data });
  });

  // ----- Chat message -----
  socket.on("chat-message", ({ message } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return; // not in a room

    // Rate limiting: max 1 message per 500ms
    const now = Date.now();
    const last = lastMessageTime.get(socket.id) || 0;
    if (now - last < 500) return;
    lastMessageTime.set(socket.id, now);

    // Validate length
    if (typeof message !== "string" || message.length === 0 || message.length > 500) return;

    // Sanitize HTML to prevent XSS
    const sanitized = escapeHtml(message);

    // Determine sender role for UI labeling
    const role = socket.data.isHost ? "host" : "viewer";

    // Broadcast to everyone in the room except the sender
    socket.to(roomId).emit("chat-message", {
      from: socket.id,
      role: role,
      message: sanitized,
    });
  });

  // ----- Disconnect handling -----
  socket.on("disconnect", () => {
    joinAttempts.delete(socket.id);
    lastMessageTime.delete(socket.id);

    const roomId = socket.data.roomId;
    if (!roomId) return;

    if (socket.data.isHost) {
      socket.to(roomId).emit("host-left");
      delete rooms[roomId];
    } else {
      const room = rooms[roomId];
      if (room) {
        room.viewers.delete(socket.id);
        io.to(room.hostSocketId).emit("viewer-left", { viewerId: socket.id });
      }
    }
  });
});

// Start server only when executed directly.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io, rooms, sweepRooms, securityEvents, logSecurity };
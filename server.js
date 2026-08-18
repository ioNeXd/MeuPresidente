/**
 * server.js - WebRTC Signaling Server with room management and security.
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------
const ALLOW_INSECURE_ORIGIN =
  process.env.ALLOW_INSECURE_ORIGIN === "1" || process.env.NODE_ENV !== "production";

const MAX_CONNECTIONS_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_IP) || 10;
const MAX_TOTAL_CONNECTIONS = Number(process.env.MAX_TOTAL_CONNECTIONS) || 200;

const ROOM_TTL_MS = (Number(process.env.ROOM_TTL_MINUTES) || 10) * 60 * 1000;
const ROOM_SWEEP_INTERVAL_MS = Number(process.env.ROOM_SWEEP_INTERVAL_MS) || 60 * 1000;

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
// Security headers (helmet)
// ---------------------------------------------------------------------------
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  connectSrc: ["'self'", "ws:", "wss:"],
  imgSrc: ["'self'", "data:"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  mediaSrc: ["'self'", "blob:"],
};

if (!ALLOW_INSECURE_ORIGIN) {
  cspDirectives.upgradeInsecureRequests = [];
}

const helmetConfig = {
  contentSecurityPolicy: { directives: cspDirectives },
  strictTransportSecurity: ALLOW_INSECURE_ORIGIN ? false : undefined,
  crossOriginOpenerPolicy: ALLOW_INSECURE_ORIGIN ? false : undefined,
};

app.use(helmet(helmetConfig));

// ---------------------------------------------------------------------------
// Static files with content-based cache busting
// ---------------------------------------------------------------------------
// index.html é servido de memória com URLs versionadas (?v=<hash do conteúdo>)
// e Cache-Control: no-cache, então o navegador sempre baixa o HTML fresco — mas
// os assets .js/.css (que mudam de URL a cada deploy) podem ser cacheados por
// 1 ano com `immutable`, evitando recarregar tudo a cada deploy.
function computeAssetVersion() {
  const hash = crypto.createHash("sha1");
  const publicDir = path.join(__dirname, "public");
  const walk = (dir) => {
    // withFileTypes pode não existir no filesystem virtual do executável
    // empacotado (pkg) — cai para readdirSync + statSync nesse caso.
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }));
    } catch (e) {
      entries = fs.readdirSync(dir).map((name) => ({
        name,
        isDirectory: fs.statSync(path.join(dir, name)).isDirectory(),
      }));
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory) walk(full);
      else if (/\.(js|css)$/.test(entry.name)) hash.update(fs.readFileSync(full));
    }
  };
  walk(publicDir);
  return hash.digest("hex").slice(0, 8);
}

const ASSET_VERSION = computeAssetVersion();

let indexHtml = fs
  .readFileSync(path.join(__dirname, "public", "index.html"), "utf8")
  .replace('href="/style.css"', `href="/style.css?v=${ASSET_VERSION}"`)
  .replace('src="/js/app.js"', `src="/js/app.js?v=${ASSET_VERSION}"`);

// ---------------------------------------------------------------------------
// Socket.IO client served from memory
// ---------------------------------------------------------------------------
// O socket.io padrão serve /socket.io/socket.io.js com fs.createReadStream de
// um arquivo de node_modules — que não sobrevive ao empacotamento pkg. Então o
// bundle é lido no boot (funciona tanto em dev quanto no executável) e servido
// em /vendor/socket.io.js, fora do prefixo /socket.io que o engine.io intercepta.
function resolveSocketIoClient() {
  // Caminho determinístico: em dev é o node_modules do projeto; no executável
  // pkg é o arquivo embutido via config "assets" (/.snapshot/node_modules/...).
  const p = path.join(__dirname, "node_modules", "socket.io", "client-dist", "socket.io.js");
  try {
    return fs.existsSync(p) ? p : null;
  } catch (e) {
    return null;
  }
}

const SOCKET_IO_CLIENT_PATH = "/vendor/socket.io.js";
const socketIoClientSource = (() => {
  const p = resolveSocketIoClient();
  if (!p) {
    console.warn("[static] bundle do socket.io client não encontrado — /vendor/socket.io.js ficará indisponível");
    return null;
  }
  return fs.readFileSync(p, "utf8");
})();

if (socketIoClientSource !== null) {
  app.get(SOCKET_IO_CLIENT_PATH, (req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    // no-cache: o bundle é amarrado à versão do socket.io instalado, então
    // revalidar é mais seguro do que cachear por muito tempo.
    res.setHeader("Cache-Control", "no-cache");
    res.send(socketIoClientSource);
  });
}

app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.send(indexHtml);
});

// Os módulos ES importam entre si com caminhos relativos (ex: './utils.js').
// Sem um build step, esses imports não receberiam o ?v= do entry point e o
// navegador poderia servir módulos antigos do cache imutável após um deploy.
// Este middleware reescreve os imports relativos na resposta, adicionando o
// mesmo versionamento — assim TODOS os assets mudam de URL quando o conteúdo muda.
const moduleTransformCache = new Map();

app.get("/js/*.js", (req, res, next) => {
  const publicDir = path.join(__dirname, "public");
  const filePath = path.resolve(publicDir, req.path.replace(/^\/+/, ""));
  if (!filePath.startsWith(path.join(publicDir, "js") + path.sep)) {
    return next(); // fora de public/js — deixa o express.static decidir
  }
  if (moduleTransformCache.has(filePath)) {
    res.setHeader("Cache-Control", req.query.v ? "public, max-age=31536000, immutable" : "no-cache");
    return res.type("application/javascript").send(moduleTransformCache.get(filePath));
  }
  fs.readFile(filePath, "utf8", (err, source) => {
    if (err) return next();
    const transformed = source.replace(
      /from\s+(['"])(\.\/[^'"]+)\1/g,
      (match, quote, spec) => `from ${quote}${spec}?v=${ASSET_VERSION}${quote}`
    );
    moduleTransformCache.set(filePath, transformed);
    res.setHeader("Cache-Control", req.query.v ? "public, max-age=31536000, immutable" : "no-cache");
    res.type("application/javascript").send(transformed);
  });
});

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
        // URLs versionadas (?v=...): seguro cachear agressivamente.
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
const io = new Server(server, {
  cors: APP_ORIGINS.length > 0 ? { origin: APP_ORIGINS, methods: ["GET", "POST"] } : false,
  // O serveClient embutido usa fs.createReadStream num arquivo de node_modules
  // que não é embutido no executável pkg — servimos o client nós mesmos, de memória.
  serveClient: false,
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
    if (n === undefined) return;
    if (n <= 1) connectionsPerIp.delete(ip);
    else connectionsPerIp.set(ip, n - 1);
  });
});

// ---------------------------------------------------------------------------
// Room management
// ---------------------------------------------------------------------------
const rooms = {};
const joinAttempts = new Map();
const lastMessageTime = new Map();
const MAX_JOIN_ATTEMPTS = 5;

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

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
      if (rooms[roomId]) {
        io.to(roomId).emit("host-left");
        delete rooms[roomId];
        logSecurity("room-expired", { roomId, reason: "host-gone", idleMs: now - room.hostLeftAt });
      }
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
      viewerNumbers: new Map(),
      viewerCounter: 0,
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

    room.viewerCounter += 1;
    const viewerNumber = room.viewerCounter;
    room.viewers.add(socket.id);
    room.viewerNumbers.set(socket.id, viewerNumber);

    socket.to(room.hostSocketId).emit("viewer-joined", {
      viewerId: socket.id,
      viewerNumber: viewerNumber,
    });

    callback({ ok: true });
  });

  // ----- Restore session (reconnect) -----
  socket.on("restore-session", ({ roomId, role, password, username } = {}, callback) => {
    if (typeof callback !== "function") return;
    if (!roomId || !isValidRoomId(roomId)) {
      return callback({ ok: false, error: "Invalid room ID." });
    }
    const normalizedRoomId = roomId.trim().toUpperCase();
    const room = rooms[normalizedRoomId];
    if (!room) {
      return callback({ ok: false, error: "Room not found." });
    }

    if (role === "host") {
      if (room.hostSocketId && io.sockets.sockets.has(room.hostSocketId)) {
        return callback({ ok: false, error: "Host already connected." });
      }
      room.hostSocketId = socket.id;
      socket.join(normalizedRoomId);
      socket.data.roomId = normalizedRoomId;
      socket.data.isHost = true;
      delete room.hostLeftAt;
      callback({ ok: true, role: "host" });
    } else if (role === "viewer") {
      if (password && room.passwordHash !== hashPassword(password)) {
        return callback({ ok: false, error: "Invalid password." });
      }
      room.viewerCounter += 1;
      const viewerNumber = room.viewerCounter;
      room.viewers.add(socket.id);
      room.viewerNumbers.set(socket.id, viewerNumber);
      socket.join(normalizedRoomId);
      socket.data.roomId = normalizedRoomId;
      socket.data.isHost = false;
      socket.to(room.hostSocketId).emit("viewer-joined", {
        viewerId: socket.id,
        viewerNumber: viewerNumber,
      });
      callback({ ok: true, role: "viewer", viewerNumber });
    } else {
      callback({ ok: false, error: "Invalid role." });
    }
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
    if (!roomId) return;

    const now = Date.now();
    const last = lastMessageTime.get(socket.id) || 0;
    if (now - last < 500) return;
    lastMessageTime.set(socket.id, now);

    if (typeof message !== "string" || message.length === 0 || message.length > 500) return;

    const sanitized = escapeHtml(message);

    const room = rooms[roomId];
    if (!room) return;

    let role = "viewer";
    let viewerNumber = null;
    if (socket.data.isHost) {
      role = "host";
    } else {
      viewerNumber = room.viewerNumbers.get(socket.id) || null;
    }

    socket.to(roomId).emit("chat-message", {
      from: socket.id,
      role: role,
      viewerNumber: viewerNumber,
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
        room.viewerNumbers.delete(socket.id);
        io.to(room.hostSocketId).emit("viewer-left", { viewerId: socket.id });
      }
    }
  });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io, rooms, sweepRooms, securityEvents, logSecurity };
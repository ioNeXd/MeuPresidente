const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const helmet = require("helmet");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Cabeçalhos de segurança básicos (CSP relaxado pro necessário rodar: socket.io + WebRTC)
// Observação: upgradeInsecureRequests é removido de propósito. Por padrão o helmet ativa essa
// diretiva, que manda o navegador reescrever TODO request http:// pra https:// automaticamente.
// Isso quebra o acesso via IP puro sem HTTPS (ex: testes locais via Radmin/LAN), porque o
// navegador tenta buscar os scripts em https:// num servidor que só fala http:// — daí o
// ERR_SSL_PROTOCOL_ERROR. Em produção atrás de HTTPS de verdade (Render, etc.) isso não faz
// falta, porque a conexão já é https:// desde o início.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        mediaSrc: ["'self'", "blob:"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginOpenerPolicy: false,
  })
);

app.use(express.static("public"));

// Guarda as salas em memória: { roomId: { passwordHash, hostSocketId } }
const rooms = {};

// Limite de tentativas de senha por socket (proteção contra força bruta)
const MAX_JOIN_ATTEMPTS = 5;
const joinAttempts = new Map(); // socket.id -> contagem

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateRoomId() {
  // ID curto, fácil de digitar (ex: 7F3K9A)
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

io.on("connection", (socket) => {
  // HOST cria uma sala
  socket.on("create-room", ({ password }, callback) => {
    if (!password || password.length < 4) {
      return callback({ ok: false, error: "Use uma senha com pelo menos 4 caracteres." });
    }

    let roomId = generateRoomId();
    while (rooms[roomId]) roomId = generateRoomId(); // evita colisão

    rooms[roomId] = {
      passwordHash: hashPassword(password),
      hostSocketId: socket.id,
      viewers: new Set(),
    };

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.isHost = true;

    callback({ ok: true, roomId });
  });

  // VIEWER entra numa sala existente
  socket.on("join-room", ({ roomId, password }, callback) => {
    const attempts = joinAttempts.get(socket.id) || 0;
    if (attempts >= MAX_JOIN_ATTEMPTS) {
      socket.disconnect(true);
      return;
    }

    const room = rooms[roomId];
    if (!room) {
      joinAttempts.set(socket.id, attempts + 1);
      return callback({ ok: false, error: "Sala não encontrada." });
    }
    if (room.passwordHash !== hashPassword(password || "")) {
      joinAttempts.set(socket.id, attempts + 1);
      return callback({ ok: false, error: "Senha incorreta." });
    }

    joinAttempts.delete(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.isHost = false;
    room.viewers.add(socket.id);

    // avisa o host que um novo viewer entrou, pra ele iniciar a conexão WebRTC
    socket.to(room.hostSocketId).emit("viewer-joined", { viewerId: socket.id });

    callback({ ok: true });
  });

  // Troca de sinalização WebRTC (offer, answer, ice candidates)
  // "to" é o socket.id do destinatário. Só é permitido entre host e viewer da MESMA sala,
  // pra impedir que alguém injete sinalização em outra sala ou sequestre uma conexão alheia.
  socket.on("signal", ({ to, data }) => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms[roomId];
    if (!room) return;

    const isSenderHost = socket.data.isHost && room.hostSocketId === socket.id;
    const isSenderViewer = !socket.data.isHost && room.viewers.has(socket.id);

    const targetIsHost = to === room.hostSocketId;
    const targetIsViewer = room.viewers.has(to);

    const allowed =
      (isSenderHost && targetIsViewer) || (isSenderViewer && targetIsHost);

    if (!allowed) return;

    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    if (socket.data.isHost) {
      // host saiu: avisa todo mundo na sala e destrói a sala
      socket.to(roomId).emit("host-left");
      delete rooms[roomId];
    } else {
      // viewer saiu: avisa o host
      const room = rooms[roomId];
      if (room) {
        room.viewers.delete(socket.id);
        io.to(room.hostSocketId).emit("viewer-left", { viewerId: socket.id });
      }
    }

    joinAttempts.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

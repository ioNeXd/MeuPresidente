const socket = io();

// STUN público do Google — só ajuda a descobrir o IP público, não retransmite mídia.
// Para redes com NAT/firewall mais restritivo, seria necessário um TURN server.
const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// ---------- UI: alternar entre abas ----------
const tabHost = document.getElementById("tabHost");
const tabViewer = document.getElementById("tabViewer");
const hostPanel = document.getElementById("hostPanel");
const viewerPanel = document.getElementById("viewerPanel");

tabHost.onclick = () => {
  tabHost.classList.add("active");
  tabViewer.classList.remove("active");
  hostPanel.classList.remove("hidden");
  viewerPanel.classList.add("hidden");
};
tabViewer.onclick = () => {
  tabViewer.classList.add("active");
  tabHost.classList.remove("active");
  viewerPanel.classList.remove("hidden");
  hostPanel.classList.add("hidden");
};

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = "status" + (type ? " " + type : "");
}

// ============================================================
// HOST
// ============================================================
const btnCreateRoom = document.getElementById("btnCreateRoom");
const hostRoomInfo = document.getElementById("hostRoomInfo");
const roomIdDisplay = document.getElementById("roomIdDisplay");
const hostStatus = document.getElementById("hostStatus");
const hostPreview = document.getElementById("hostPreview");
const viewersList = document.getElementById("viewersList");

let localStream = null;
// Um RTCPeerConnection por viewer conectado
const peerConnections = {}; // { viewerSocketId: RTCPeerConnection }

btnCreateRoom.onclick = async () => {
  const password = document.getElementById("hostPassword").value;
  if (!password) {
    setStatus(hostStatus, "Defina uma senha antes de continuar.", "error");
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
  } catch (err) {
    setStatus(hostStatus, "Você precisa permitir o compartilhamento de tela.", "error");
    return;
  }

  hostPreview.srcObject = localStream;
  hostPreview.style.display = "block";
  btnCreateRoom.disabled = true;

  socket.emit("create-room", { password }, (res) => {
    if (!res.ok) {
      setStatus(hostStatus, "Erro ao criar a sala.", "error");
      return;
    }
    roomIdDisplay.textContent = res.roomId;
    hostRoomInfo.classList.remove("hidden");
    setStatus(hostStatus, "Compartilhando. Envie o ID e a senha para quem for assistir.", "ok");
  });

  // se o usuário parar o compartilhamento pelo botão nativo do navegador
  localStream.getVideoTracks()[0].onended = () => {
    setStatus(hostStatus, "Compartilhamento encerrado.", "error");
    Object.values(peerConnections).forEach((pc) => pc.close());
  };
};

// Um novo viewer entrou -> cria uma conexão WebRTC e envia uma "offer"
socket.on("viewer-joined", async ({ viewerId }) => {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peerConnections[viewerId] = pc;

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", { to: viewerId, data: { candidate: event.candidate } });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: viewerId, data: { sdp: offer } });

  updateViewersList();
});

socket.on("viewer-left", ({ viewerId }) => {
  if (peerConnections[viewerId]) {
    peerConnections[viewerId].close();
    delete peerConnections[viewerId];
  }
  updateViewersList();
});

function updateViewersList() {
  const count = Object.keys(peerConnections).length;
  viewersList.textContent = count === 0
    ? "Nenhum espectador ainda."
    : `${count} espectador(es) conectado(s).`;
}

// ============================================================
// VIEWER
// ============================================================
const btnJoinRoom = document.getElementById("btnJoinRoom");
const viewerStatus = document.getElementById("viewerStatus");
const viewerVideo = document.getElementById("viewerVideo");

let viewerPc = null;

// ---------- Controles de exibição do vídeo (teatro / tela cheia / miniatura) ----------
const viewerControls = document.getElementById("viewerControls");
const btnTheater = document.getElementById("btnTheater");
const btnFullscreen = document.getElementById("btnFullscreen");
const btnMini = document.getElementById("btnMini");

btnTheater.onclick = () => {
  document.body.classList.toggle("theater-mode");
  btnTheater.classList.toggle("active");
};

btnFullscreen.onclick = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    viewerVideo.requestFullscreen().catch(() => {
      setStatus(viewerStatus, "Não foi possível entrar em tela cheia.", "error");
    });
  }
};

btnMini.onclick = async () => {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await viewerVideo.requestPictureInPicture();
    }
  } catch (err) {
    setStatus(viewerStatus, "Miniatura não suportada neste navegador.", "error");
  }
};

btnJoinRoom.onclick = () => {
  const roomId = document.getElementById("viewerRoomId").value.trim().toUpperCase();
  const password = document.getElementById("viewerPassword").value;

  if (!roomId || !password) {
    setStatus(viewerStatus, "Preencha o ID da sala e a senha.", "error");
    return;
  }

  socket.emit("join-room", { roomId, password }, (res) => {
    if (!res.ok) {
      setStatus(viewerStatus, res.error, "error");
      return;
    }
    setStatus(viewerStatus, "Conectado. Aguardando vídeo do host...", "ok");
    btnJoinRoom.disabled = true;

    viewerPc = new RTCPeerConnection(RTC_CONFIG);

    viewerPc.ontrack = (event) => {
      viewerVideo.srcObject = event.streams[0];
      viewerVideo.style.display = "block";
      viewerControls.classList.remove("hidden");
    };

    viewerPc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("signal", { to: hostIdPlaceholder(), data: { candidate: event.candidate } });
      }
    };
  });
};

// Guarda o id do host assim que a primeira "signal" chegar (é quem manda a offer)
let hostSocketId = null;
function hostIdPlaceholder() {
  return hostSocketId;
}

// Sinalização recebida (tanto host quanto viewer usam este mesmo evento)
socket.on("signal", async ({ from, data }) => {
  // --- Lado VIEWER recebendo offer do host ---
  if (viewerPc && data.sdp && data.sdp.type === "offer") {
    hostSocketId = from;
    await viewerPc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await viewerPc.createAnswer();
    await viewerPc.setLocalDescription(answer);
    socket.emit("signal", { to: from, data: { sdp: answer } });
    return;
  }

  // --- Lado VIEWER recebendo ICE candidate do host ---
  if (viewerPc && data.candidate) {
    try {
      await viewerPc.addIceCandidate(data.candidate);
    } catch (e) { /* ignora candidatos fora de ordem */ }
    return;
  }

  // --- Lado HOST recebendo answer de um viewer ---
  if (peerConnections[from] && data.sdp && data.sdp.type === "answer") {
    await peerConnections[from].setRemoteDescription(new RTCSessionDescription(data.sdp));
    return;
  }

  // --- Lado HOST recebendo ICE candidate de um viewer ---
  if (peerConnections[from] && data.candidate) {
    try {
      await peerConnections[from].addIceCandidate(data.candidate);
    } catch (e) { /* ignora */ }
    return;
  }
});

socket.on("host-left", () => {
  setStatus(viewerStatus, "O host encerrou o compartilhamento.", "error");
  viewerVideo.style.display = "none";
  viewerControls.classList.add("hidden");
  document.body.classList.remove("theater-mode");
  btnTheater.classList.remove("active");
  btnJoinRoom.disabled = false;
});

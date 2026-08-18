/**
 * client.js - WebRTC Screen Sharing Client (Host & Viewer)
 *
 * NAMING CONVENTIONS:
 * - Variables/functions: camelCase.
 * - Socket.IO events: kebab-case.
 *
 * PERFORMANCE IMPROVEMENTS:
 * - ICE candidate debouncing (per‑viewer, to prevent lost candidates).
 * - Bitrate/bandwidth control.
 * - Strict cleanup of RTCPeerConnection.
 * - Cached static assets.
 *
 * AUDIO FEATURES:
 * - System audio capture.
 * - Microphone mixing via AudioContext.
 * - Volume control and mute on viewer side.
 * - Host: mute/unmute microphone, microphone gain slider.
 *
 * CHAT FEATURES:
 * - Collapsible chat panel with message history.
 * - Messages displayed safely (textContent, no XSS).
 * - Rate limiting (server-enforced).
 * - Viewer numbering (e.g., "Viewer #3").
 */

// ================================================================
//  STATE MANAGER
// ================================================================
const state = {
  // Host
  localStream: null,
  peerConnections: {}, // viewerId -> RTCPeerConnection
  audioContext: null,
  micStream: null,
  isMicEnabled: false,
  micGain: null, // GainNode for microphone
  screenGain: null, // GainNode for system audio

  // Viewer
  viewerPc: null,
  hostSocketId: null,
  viewerVideo: null,

  // Chat
  chatMessages: [],
  viewerNumber: null, // assigned by server

  // Shared
  socket: io(),
};

// ================================================================
//  UTILITY FUNCTIONS
// ================================================================

/** Debounce function to group ICE candidate emissions. */
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Updates the status message element.
 * @param {HTMLElement} el - Status element.
 * @param {string} msg - Message text.
 * @param {string} [type] - Optional class (e.g., 'error', 'ok', 'warning').
 */
function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = "status" + (type ? " " + type : "");
}

/**
 * Returns the appropriate status element based on the current active tab.
 * @returns {HTMLElement} hostStatus or viewerStatus.
 */
function getStatusElement() {
  const hostPanel = document.getElementById("hostPanel");
  const viewerPanel = document.getElementById("viewerPanel");
  if (!hostPanel.classList.contains("hidden")) {
    return document.getElementById("hostStatus");
  } else if (!viewerPanel.classList.contains("hidden")) {
    return document.getElementById("viewerStatus");
  }
  // Fallback: return hostStatus (should never happen)
  return document.getElementById("hostStatus");
}

/**
 * Cleans up a RTCPeerConnection: closes it and optionally stops tracks.
 * @param {RTCPeerConnection} pc - The peer connection to clean.
 * @param {boolean} stopTracks - Whether to stop the tracks (default true).
 */
function cleanupPeerConnection(pc, stopTracks = true) {
  if (!pc) return;
  pc.onicecandidate = null;
  pc.ontrack = null;
  pc.onnegotiationneeded = null;
  pc.oniceconnectionstatechange = null;
  pc.onsignalingstatechange = null;
  pc.close();
  if (stopTracks) {
    pc.getSenders().forEach((sender) => {
      if (sender.track) sender.track.stop();
    });
  }
}

/**
 * Applies bitrate limits to a RTCPeerConnection's senders.
 * @param {RTCPeerConnection} pc - The peer connection.
 * @param {number} maxBitrate - Maximum bitrate in bps.
 */
function setBitrateLimit(pc, maxBitrate = 500000) {
  pc.getSenders().forEach((sender) => {
    if (sender.track && sender.track.kind === "video") {
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].maxBitrate = maxBitrate;
      sender.setParameters(params).catch((e) => {
        console.warn("Failed to set bitrate limit:", e);
      });
    }
  });
}

// ================================================================
//  UI TABS
// ================================================================
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

// ================================================================
//  CHAT UI
// ================================================================
const chatToggle = document.getElementById("chatToggle");
const chatContainer = document.getElementById("chatContainer");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");

let chatVisible = false;

chatToggle.onclick = () => {
  chatVisible = !chatVisible;
  chatContainer.classList.toggle("hidden", !chatVisible);
  if (chatVisible) {
    chatInput.focus();
  }
};

/**
 * Adds a message to the chat UI.
 * Uses textContent to prevent XSS (safe).
 * @param {string} role - 'host' or 'viewer'
 * @param {number|null} viewerNumber - Viewer number (if role === 'viewer')
 * @param {string} message - Message text (already sanitized on server).
 */
function addChatMessage(role, viewerNumber, message) {
  const div = document.createElement("div");
  div.className = `chat-message ${role}`;

  const labelSpan = document.createElement("span");
  labelSpan.className = "chat-label";
  if (role === "host") {
    labelSpan.textContent = "👤 Host:";
  } else {
    const num = viewerNumber !== null ? ` #${viewerNumber}` : "";
    labelSpan.textContent = `👤 Viewer${num}:`;
  }

  const textSpan = document.createElement("span");
  textSpan.className = "chat-text";
  textSpan.textContent = message; // safe: textContent escapes HTML

  div.appendChild(labelSpan);
  div.appendChild(textSpan);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  state.chatMessages.push({ role, viewerNumber, message });
}

// Send chat message
function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  if (text.length > 500) {
    const statusEl = getStatusElement();
    setStatus(statusEl, "Message too long (max 500 chars).", "error");
    return;
  }
  // Emit to server
  state.socket.emit("chat-message", { message: text });
  // Add locally immediately (optimistic)
  const localRole = window._isHost ? "host" : "viewer";
  const localNumber = state.viewerNumber;
  addChatMessage(localRole, localNumber, text);
  chatInput.value = "";
  chatInput.focus();
}

chatSend.onclick = sendChatMessage;
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChatMessage();
  }
});

// ================================================================
//  HOST LOGIC
// ================================================================
const btnCreateRoom = document.getElementById("btnCreateRoom");
const hostRoomInfo = document.getElementById("hostRoomInfo");
const roomIdDisplay = document.getElementById("roomIdDisplay");
const hostStatus = document.getElementById("hostStatus");
const hostPreview = document.getElementById("hostPreview");
const viewersList = document.getElementById("viewersList");
const hostEnableMic = document.getElementById("hostEnableMic");
const hostMuteMic = document.getElementById("hostMuteMic");
const hostMicVolume = document.getElementById("hostMicVolume");
const hostMicVolumeLabel = document.getElementById("hostMicVolumeLabel");

// Per‑viewer debounced ICE emission functions
const iceDebouncers = {}; // viewerId -> debounced function
const candidateBuffers = {}; // viewerId -> array of candidates

/**
 * Emits ICE candidates for a specific viewer (called by the debounced function).
 * @param {string} viewerId
 * @param {Array} candidates
 */
function emitIceCandidatesForViewer(viewerId, candidates) {
  if (candidates.length === 0) return;
  state.socket.emit("signal", { to: viewerId, data: { candidates } });
  candidateBuffers[viewerId] = []; // clear buffer after sending
}

/**
 * Mixes a microphone track with the system audio track using AudioContext.
 * Returns an object with the mixed stream and gain nodes for control.
 */
async function mixAudioStreams(screenStream, micStream) {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = state.audioContext;

  const screenSource = ctx.createMediaStreamSource(screenStream);
  const micSource = ctx.createMediaStreamSource(micStream);

  const screenGain = ctx.createGain();
  screenGain.gain.value = 1.0;
  const micGain = ctx.createGain();
  micGain.gain.value = 0.8; // default

  screenSource.connect(screenGain);
  micSource.connect(micGain);

  const mixer = ctx.createChannelMerger(2);
  screenGain.connect(mixer, 0, 0);
  micGain.connect(mixer, 0, 1);

  const dest = ctx.createMediaStreamDestination();
  mixer.connect(dest);

  const videoTracks = screenStream.getVideoTracks();
  const audioTracks = dest.stream.getAudioTracks();

  const mixedStream = new MediaStream([...videoTracks, ...audioTracks]);

  // Store gain nodes for later control
  state.screenGain = screenGain;
  state.micGain = micGain;

  return mixedStream;
}

btnCreateRoom.onclick = async () => {
  const password = document.getElementById("hostPassword").value;
  if (!password) {
    setStatus(hostStatus, "Set a password before starting.", "error");
    return;
  }

  let screenStream = null;
  let micStream = null;
  let finalStream = null;

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: true,
    });
  } catch (err) {
    setStatus(hostStatus, "Screen sharing permission denied.", "error");
    return;
  }

  const hasSystemAudio = screenStream.getAudioTracks().length > 0;
  if (!hasSystemAudio) {
    setStatus(hostStatus, "System audio not available. Only video will be shared.", "warning");
  }

  const wantMic = hostEnableMic.checked;
  if (wantMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.micStream = micStream;
      state.isMicEnabled = true;
    } catch (err) {
      setStatus(hostStatus, "Microphone not accessible. Sharing screen without mic.", "warning");
    }
  }

  if (micStream && hasSystemAudio) {
    try {
      finalStream = await mixAudioStreams(screenStream, micStream);
    } catch (err) {
      console.warn("Audio mixing failed, using screen stream only.", err);
      finalStream = screenStream;
    }
  } else {
    finalStream = screenStream;
    if (micStream && !hasSystemAudio) {
      micStream.getAudioTracks().forEach((track) => {
        screenStream.addTrack(track);
      });
      finalStream = screenStream;
    }
  }

  state.localStream = finalStream;
  window._isHost = true; // flag for chat

  hostPreview.srcObject = state.localStream;
  hostPreview.style.display = "block";
  btnCreateRoom.disabled = true;

  // Enable mic controls
  if (state.micGain) {
    hostMuteMic.classList.remove("hidden");
    hostMicVolume.classList.remove("hidden");
    hostMicVolumeLabel.classList.remove("hidden");
    hostMuteMic.textContent = "🔊 Mute Mic";
    hostMicVolume.value = state.micGain.gain.value;
    hostMicVolumeLabel.textContent = state.micGain.gain.value.toFixed(2);
  } else {
    hostMuteMic.classList.add("hidden");
    hostMicVolume.classList.add("hidden");
    hostMicVolumeLabel.classList.add("hidden");
  }

  state.socket.emit("create-room", { password }, (res) => {
    if (!res.ok) {
      setStatus(hostStatus, "Failed to create room.", "error");
      return;
    }
    roomIdDisplay.textContent = res.roomId;
    hostRoomInfo.classList.remove("hidden");
    setStatus(
      hostStatus,
      hasSystemAudio
        ? "Sharing screen + audio. Send room ID and password to viewers."
        : "Sharing screen (no system audio). Send room ID and password.",
      "ok"
    );
    // Enable chat
    chatToggle.classList.remove("hidden");
    chatContainer.classList.remove("hidden");
    chatVisible = true;
    chatInput.focus();
  });

  const videoTrack = state.localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.onended = () => {
      setStatus(hostStatus, "Screen sharing ended.", "error");
      Object.values(state.peerConnections).forEach((pc) => cleanupPeerConnection(pc, false));
      state.peerConnections = {};
      // Clean up debouncers and buffers
      Object.keys(iceDebouncers).forEach((id) => delete iceDebouncers[id]);
      Object.keys(candidateBuffers).forEach((id) => delete candidateBuffers[id]);
      updateViewersList();
      btnCreateRoom.disabled = false;
      if (state.audioContext) {
        state.audioContext.close();
        state.audioContext = null;
      }
      if (state.micStream) {
        state.micStream.getTracks().forEach((t) => t.stop());
        state.micStream = null;
      }
      chatToggle.classList.add("hidden");
      chatContainer.classList.add("hidden");
      chatVisible = false;
      // Hide mic controls
      hostMuteMic.classList.add("hidden");
      hostMicVolume.classList.add("hidden");
      hostMicVolumeLabel.classList.add("hidden");
    };
  }
};

// ----- Host: mute/unmute microphone -----
hostMuteMic.onclick = () => {
  if (!state.micGain) return;
  const current = state.micGain.gain.value;
  if (current > 0) {
    state.micGain.gain.value = 0;
    hostMuteMic.textContent = "🔇 Unmute Mic";
  } else {
    state.micGain.gain.value = parseFloat(hostMicVolume.value) || 0.8;
    hostMuteMic.textContent = "🔊 Mute Mic";
  }
};

// ----- Host: microphone volume slider -----
hostMicVolume.addEventListener("input", () => {
  if (!state.micGain) return;
  const val = parseFloat(hostMicVolume.value);
  state.micGain.gain.value = val;
  hostMicVolumeLabel.textContent = val.toFixed(2);
  // If gain > 0 and mute button says "Unmute", update text
  if (val > 0 && hostMuteMic.textContent === "🔇 Unmute Mic") {
    hostMuteMic.textContent = "🔊 Mute Mic";
  }
});

// ----- Host: viewer joined -----
state.socket.on("viewer-joined", async ({ viewerId, viewerNumber }) => {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  state.peerConnections[viewerId] = pc;
  candidateBuffers[viewerId] = [];

  // Create a debounced emitter for this viewer
  iceDebouncers[viewerId] = debounce((viewerId) => {
    const candidates = candidateBuffers[viewerId] || [];
    if (candidates.length > 0) {
      state.socket.emit("signal", { to: viewerId, data: { candidates } });
      candidateBuffers[viewerId] = [];
    }
  }, 50);

  // Add local tracks
  state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));

  pc.onnegotiationneeded = () => {
    setBitrateLimit(pc, 500000);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      candidateBuffers[viewerId].push(event.candidate);
      iceDebouncers[viewerId](viewerId);
    }
  };

  // ICE connection state monitoring
  pc.oniceconnectionstatechange = () => {
    const stateStr = pc.iceConnectionState;
    console.log(`ICE state for viewer ${viewerId}: ${stateStr}`);
    if (stateStr === "failed" || stateStr === "disconnected") {
      setStatus(hostStatus, `Connection to viewer ${viewerNumber} lost.`, "error");
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  state.socket.emit("signal", { to: viewerId, data: { sdp: offer } });

  updateViewersList();
});

// ----- Host: viewer left -----
state.socket.on("viewer-left", ({ viewerId }) => {
  if (state.peerConnections[viewerId]) {
    cleanupPeerConnection(state.peerConnections[viewerId], false); // do NOT stop tracks
    delete state.peerConnections[viewerId];
    delete candidateBuffers[viewerId];
    delete iceDebouncers[viewerId];
  }
  updateViewersList();
});

function updateViewersList() {
  const count = Object.keys(state.peerConnections).length;
  viewersList.textContent =
    count === 0 ? "No viewers yet." : `${count} viewer(s) connected.`;
}

// ================================================================
//  VIEWER LOGIC
// ================================================================
const btnJoinRoom = document.getElementById("btnJoinRoom");
const viewerStatus = document.getElementById("viewerStatus");
const viewerVideo = document.getElementById("viewerVideo");
const viewerControls = document.getElementById("viewerControls");

const btnTheater = document.getElementById("btnTheater");
const btnFullscreen = document.getElementById("btnFullscreen");
const btnMini = document.getElementById("btnMini");
const volumeSlider = document.getElementById("volumeSlider");
const btnMute = document.getElementById("btnMute");

state.viewerVideo = viewerVideo;

// ----- Viewer UI controls -----
btnTheater.onclick = () => {
  document.body.classList.toggle("theater-mode");
  btnTheater.classList.toggle("active");
};

btnFullscreen.onclick = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    viewerVideo.requestFullscreen().catch(() => {
      setStatus(viewerStatus, "Fullscreen not supported.", "error");
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
    setStatus(viewerStatus, "Picture-in-Picture not supported.", "error");
  }
};

// Volume control
volumeSlider.addEventListener("input", () => {
  viewerVideo.volume = parseFloat(volumeSlider.value);
  if (viewerVideo.volume === 0) {
    btnMute.textContent = "🔇";
  } else {
    btnMute.textContent = "🔊";
  }
});

btnMute.onclick = () => {
  if (viewerVideo.volume > 0) {
    viewerVideo.volume = 0;
    volumeSlider.value = 0;
    btnMute.textContent = "🔇";
  } else {
    viewerVideo.volume = 1;
    volumeSlider.value = 1;
    btnMute.textContent = "🔊";
  }
};

// ----- Viewer: join room -----
btnJoinRoom.onclick = () => {
  const roomId = document.getElementById("viewerRoomId").value.trim().toUpperCase();
  const password = document.getElementById("viewerPassword").value;

  if (!roomId || !password) {
    setStatus(viewerStatus, "Fill in room ID and password.", "error");
    return;
  }

  state.socket.emit("join-room", { roomId, password }, (res) => {
    if (!res.ok) {
      setStatus(viewerStatus, res.error, "error");
      return;
    }
    setStatus(viewerStatus, "Connected. Waiting for host video...", "ok");
    btnJoinRoom.disabled = true;
    window._isHost = false; // viewer flag for chat

    // Enable chat
    chatToggle.classList.remove("hidden");
    chatContainer.classList.remove("hidden");
    chatVisible = true;
    chatInput.focus();

    state.viewerPc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    state.viewerPc.ontrack = (event) => {
      viewerVideo.srcObject = event.streams[0];
      viewerVideo.style.display = "block";
      viewerControls.classList.remove("hidden");
      viewerVideo.volume = parseFloat(volumeSlider.value);
    };

    // ICE connection state monitoring
    state.viewerPc.oniceconnectionstatechange = () => {
      const stateStr = state.viewerPc.iceConnectionState;
      console.log(`Viewer ICE state: ${stateStr}`);
      if (stateStr === "connected") {
        setStatus(viewerStatus, "Video stream connected.", "ok");
      } else if (stateStr === "failed" || stateStr === "disconnected") {
        setStatus(viewerStatus, "Connection lost. Trying to reconnect...", "error");
      }
    };

    const viewerCandidateBuffer = [];
    const emitViewerIce = debounce(() => {
      if (viewerCandidateBuffer.length === 0) return;
      state.socket.emit("signal", {
        to: state.hostSocketId,
        data: { candidates: viewerCandidateBuffer },
      });
      viewerCandidateBuffer.length = 0;
    }, 50);

    state.viewerPc.onicecandidate = (event) => {
      if (event.candidate) {
        viewerCandidateBuffer.push(event.candidate);
        emitViewerIce();
      }
    };
  });
};

// ----- Signaling receiver -----
state.socket.on("signal", async ({ from, data }) => {
  // Viewer side: receiving offer
  if (state.viewerPc && data.sdp && data.sdp.type === "offer") {
    state.hostSocketId = from;
    await state.viewerPc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await state.viewerPc.createAnswer();
    await state.viewerPc.setLocalDescription(answer);
    state.socket.emit("signal", { to: from, data: { sdp: answer } });
    return;
  }

  // Viewer side: ICE candidates (batch)
  if (state.viewerPc && data.candidates) {
    for (const candidate of data.candidates) {
      try {
        await state.viewerPc.addIceCandidate(candidate);
      } catch (e) {
        console.warn("Failed to add ICE candidate (viewer):", e);
      }
    }
    return;
  }

  // Host side: receiving answer
  if (state.peerConnections[from] && data.sdp && data.sdp.type === "answer") {
    await state.peerConnections[from].setRemoteDescription(
      new RTCSessionDescription(data.sdp)
    );
    return;
  }

  // Host side: ICE candidates (batch)
  if (state.peerConnections[from] && data.candidates) {
    for (const candidate of data.candidates) {
      try {
        await state.peerConnections[from].addIceCandidate(candidate);
      } catch (e) {
        console.warn("Failed to add ICE candidate (host):", e);
      }
    }
    return;
  }

  // Fallback for single candidates
  if (state.viewerPc && data.candidate) {
    try {
      await state.viewerPc.addIceCandidate(data.candidate);
    } catch (e) {
      console.warn("Failed to add single ICE candidate (viewer):", e);
    }
    return;
  }
  if (state.peerConnections[from] && data.candidate) {
    try {
      await state.peerConnections[from].addIceCandidate(data.candidate);
    } catch (e) {
      console.warn("Failed to add single ICE candidate (host):", e);
    }
    return;
  }
});

// ----- Chat messages received from server -----
state.socket.on("chat-message", ({ role, viewerNumber, message }) => {
  addChatMessage(role, viewerNumber, message);
});

// ----- Host left -----
state.socket.on("host-left", () => {
  setStatus(viewerStatus, "Host stopped sharing.", "error");
  viewerVideo.style.display = "none";
  viewerControls.classList.add("hidden");
  document.body.classList.remove("theater-mode");
  btnTheater.classList.remove("active");
  btnJoinRoom.disabled = false;

  if (state.viewerPc) {
    cleanupPeerConnection(state.viewerPc, true);
    state.viewerPc = null;
    state.hostSocketId = null;
  }

  chatToggle.classList.add("hidden");
  chatContainer.classList.add("hidden");
  chatVisible = false;
});

// ----- Connection error -----
state.socket.on("connect_error", () => {
  const msg = "Cannot connect to server. Check your network.";
  const statusEl = getStatusElement();
  setStatus(statusEl, msg, "error");
});
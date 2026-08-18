// utils.js - Funções utilitárias

export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

export function cleanupPeerConnection(pc, stopTracks = true) {
  if (!pc) return;
  // Remove todos os handlers para evitar vazamento de memória em sessões
  // longas com muitas entradas/saídas de espectadores.
  pc.onicecandidate = null;
  pc.onicecandidateerror = null;
  pc.oniceconnectionstatechange = null;
  pc.onicegatheringstatechange = null;
  pc.onsignalingstatechange = null;
  pc.onnegotiationneeded = null;
  pc.ontrack = null;
  pc.onremovetrack = null;
  pc.ondatachannel = null;
  pc.onconnectionstatechange = null;
  try {
    pc.close();
  } catch (e) {
    // Já fechada — ignora.
  }
  if (stopTracks) {
    pc.getSenders().forEach((sender) => {
      if (sender.track) sender.track.stop();
    });
    pc.getReceivers().forEach((receiver) => {
      if (receiver.track) receiver.track.stop();
    });
  }
}

export function setBitrateLimit(pc, maxBitrate = 500000) {
  pc.getSenders().forEach((sender) => {
    if (sender.track && sender.track.kind === 'video') {
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].maxBitrate = maxBitrate;
      sender.setParameters(params).catch((e) => {
        console.warn('Failed to set bitrate limit:', e);
      });
    }
  });
}

export function savePreference(key, value) {
  try {
    localStorage.setItem('screen-share-' + key, JSON.stringify(value));
  } catch (e) { /* ignore */ }
}

export function loadPreference(key, defaultValue) {
  try {
    const val = localStorage.getItem('screen-share-' + key);
    return val ? JSON.parse(val) : defaultValue;
  } catch (e) { return defaultValue; }
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 3000);
}

export function getStatusElement() {
  const hostPanel = document.getElementById('hostPanel');
  const viewerPanel = document.getElementById('viewerPanel');
  if (!hostPanel.classList.contains('hidden')) {
    return document.getElementById('hostStatus');
  } else if (!viewerPanel.classList.contains('hidden')) {
    return document.getElementById('viewerStatus');
  }
  return document.getElementById('hostStatus');
}
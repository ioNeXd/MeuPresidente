// app.js - Ponto de entrada principal

import { HostManager } from './host.js';
import { ViewerManager } from './viewer.js';
import { ChatManager } from './chat.js';
import { setStatus, savePreference, loadPreference, showToast } from './utils.js';

const socket = io();

const state = {
  socket,
  localStream: null,
  isHost: false,
  roomId: null,
  password: null,
  username: null,
  viewerNumber: null,
  micGain: null,
  micStream: null,
  audioContext: null,
  screenGain: null,
  isMicEnabled: false,
};

// DOM elements
const chatToggle = document.getElementById('chatToggle');
const tabHost = document.getElementById('tabHost');
const tabViewer = document.getElementById('tabViewer');
const hostPanel = document.getElementById('hostPanel');
const viewerPanel = document.getElementById('viewerPanel');
const btnCreateRoom = document.getElementById('btnCreateRoom');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const hostPassword = document.getElementById('hostPassword');
const hostUsername = document.getElementById('hostUsername');
const viewerRoomId = document.getElementById('viewerRoomId');
const viewerPassword = document.getElementById('viewerPassword');
const viewerUsername = document.getElementById('viewerUsername');
const hostStatus = document.getElementById('hostStatus');
const viewerStatus = document.getElementById('viewerStatus');

// Tema
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.onclick = () => {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    savePreference('theme', isLight ? 'light' : 'dark');
  };
  const theme = loadPreference('theme', 'dark');
  if (theme === 'light') document.body.classList.add('light-mode');
}

// Abas - alternar visibilidade dos painéis
tabHost.onclick = () => {
  tabHost.classList.add('active');
  tabViewer.classList.remove('active');
  hostPanel.classList.remove('hidden');
  viewerPanel.classList.add('hidden');
  console.log('Switched to Host tab');
};

tabViewer.onclick = () => {
  tabViewer.classList.add('active');
  tabHost.classList.remove('active');
  viewerPanel.classList.remove('hidden');
  hostPanel.classList.add('hidden');
  console.log('Switched to Viewer tab');
};

// Chat
const chat = new ChatManager(socket);
chat.hide();

// Managers
const hostManager = new HostManager(socket, state);
const viewerManager = new ViewerManager(socket, state);

// Criar sala
btnCreateRoom.onclick = async () => {
  const password = hostPassword.value;
  const username = hostUsername.value.trim() || 'Host';
  if (!password) {
    setStatus(hostStatus, 'Defina uma senha.', 'error');
    return;
  }
  savePreference('hostPassword', password);
  savePreference('hostUsername', username);

  try {
    await hostManager.createRoom(
      password,
      username,
      document.getElementById('hostEnableMic').checked
    );
    chat.show();
    chatToggle.classList.remove('hidden');
    savePreference('session', { roomId: state.roomId, role: 'host', password, username });
    showToast('Sala criada! Compartilhe o ID e a senha.', 'success');
  } catch (err) {
    setStatus(hostStatus, err.message, 'error');
  }
};

// Entrar na sala
btnJoinRoom.onclick = () => {
  const roomId = viewerRoomId.value.trim().toUpperCase();
  const password = viewerPassword.value;
  const username = viewerUsername.value.trim() || 'Viewer';
  if (!roomId || !password) {
    setStatus(viewerStatus, 'Preencha ID e senha.', 'error');
    return;
  }
  savePreference('viewerRoomId', roomId);
  savePreference('viewerPassword', password);
  savePreference('viewerUsername', username);

  viewerManager.joinRoom(roomId, password, username);
};

// Alternar chat
chatToggle.onclick = () => {
  chat.toggle();
};

// Reconnection
socket.on('connect', () => {
  const saved = loadPreference('session', null);
  if (saved) {
    const { roomId, role, password, username } = saved;
    if (roomId && role) {
      let responded = false;
      socket.emit('restore-session', { roomId, role, password, username }, (res) => {
        responded = true;
        if (res && res.ok) {
          if (role === 'host') {
            tabHost.click();
            hostManager.restore(roomId);
            chat.show();
            chatToggle.classList.remove('hidden');
            showToast('Sessão restaurada!', 'info');
          } else if (role === 'viewer') {
            tabViewer.click();
            viewerManager.restore(roomId);
            chat.show();
            chatToggle.classList.remove('hidden');
            showToast('Sessão restaurada!', 'info');
          } else {
            savePreference('session', null);
          }
        } else {
          savePreference('session', null);
          showToast('Sessão expirada. Entre novamente.', 'error');
        }
      });
      setTimeout(() => {
        if (!responded) {
          savePreference('session', null);
          showToast('Falha na restauração.', 'error');
        }
      }, 5000);
    }
  }
});

// Password toggle
document.querySelectorAll('.toggle-pwd').forEach(el => {
  el.onclick = () => {
    const target = document.getElementById(el.dataset.target);
    if (target) {
      if (target.type === 'password') {
        target.type = 'text';
        el.textContent = '🙈';
      } else {
        target.type = 'password';
        el.textContent = '👁️';
      }
    }
  };
});

console.log('App inicializado.');
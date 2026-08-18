// viewer.js - Lógica do espectador

import { debounce, setStatus, cleanupPeerConnection, savePreference, loadPreference, showToast } from './utils.js';

export class ViewerManager {
  constructor(socket, state) {
    this.socket = socket;
    this.state = state;
    this.pc = null;
    this.hostSocketId = null;
    this.candidateBuffer = [];
    this.emitDebounce = debounce(() => this.sendCandidates(), 50);
    this.volumeSlider = document.getElementById('volumeSlider');
    this.muteBtn = document.getElementById('btnMute');
    this.video = document.getElementById('viewerVideo');
    this.controls = document.getElementById('viewerControls');
    this.theaterBtn = document.getElementById('btnTheater');
    this.fullscreenBtn = document.getElementById('btnFullscreen');
    this.miniBtn = document.getElementById('btnMini');
    this.viewerStatus = document.getElementById('viewerStatus');
    this.btnJoinRoom = document.getElementById('btnJoinRoom');

    this.bindUI();
    this.bindSocketEvents();
  }

  bindUI() {
    const vol = loadPreference('volume', 1);
    this.volumeSlider.value = vol;
    this.video.volume = vol;
    const muted = loadPreference('muted', false);
    if (muted) {
      this.video.volume = 0;
      this.volumeSlider.value = 0;
      this.muteBtn.textContent = '🔇';
    }
    const theater = loadPreference('theater', false);
    if (theater) document.body.classList.add('theater-mode');

    this.volumeSlider.addEventListener('input', () => {
      const val = parseFloat(this.volumeSlider.value);
      this.video.volume = val;
      this.muteBtn.textContent = val === 0 ? '🔇' : '🔊';
      savePreference('volume', val);
    });
    this.muteBtn.onclick = () => {
      if (this.video.volume > 0) {
        this.video.volume = 0;
        this.volumeSlider.value = 0;
        this.muteBtn.textContent = '🔇';
        savePreference('muted', true);
      } else {
        this.video.volume = 1;
        this.volumeSlider.value = 1;
        this.muteBtn.textContent = '🔊';
        savePreference('muted', false);
      }
    };
    this.theaterBtn.onclick = () => {
      document.body.classList.toggle('theater-mode');
      const active = document.body.classList.contains('theater-mode');
      savePreference('theater', active);
    };
    this.fullscreenBtn.onclick = () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        this.video.requestFullscreen().catch(() => {});
      }
    };
    this.miniBtn.onclick = () => {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
      } else {
        this.video.requestPictureInPicture().catch(() => {});
      }
    };
  }

  bindSocketEvents() {
    this.socket.on('signal', async ({ from, data }) => {
      if (this.pc && data.sdp && data.sdp.type === 'offer') {
        this.hostSocketId = from;
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.socket.emit('signal', { to: from, data: { sdp: answer } });
        return;
      }
      if (this.pc && data.candidates) {
        for (const candidate of data.candidates) {
          try {
            await this.pc.addIceCandidate(candidate);
          } catch (e) {
            console.warn('Failed to add ICE candidate (viewer):', e);
          }
        }
        return;
      }
      if (this.pc && data.candidate) {
        try {
          await this.pc.addIceCandidate(data.candidate);
        } catch (e) {
          console.warn('Failed to add single ICE candidate (viewer):', e);
        }
        return;
      }
    });

    this.socket.on('host-left', () => {
      this.handleHostLeft();
    });
  }

  joinRoom(roomId, password, username) {
    this.socket.emit('join-room', { roomId, password, username }, (res) => {
      if (!res.ok) {
        setStatus(this.viewerStatus, res.error || 'Falha ao entrar.', 'error');
        return;
      }
      this.state.roomId = roomId;
      this.state.isHost = false;
      this.state.viewerNumber = res.viewerNumber || null;
      this.state.username = username;
      setStatus(this.viewerStatus, 'Conectado. Aguardando vídeo...', 'ok');
      this.btnJoinRoom.disabled = true;

      this.pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      this.pc.ontrack = (event) => {
        this.video.srcObject = event.streams[0];
        this.video.style.display = 'block';
        this.controls.classList.remove('hidden');
        this.video.volume = parseFloat(this.volumeSlider.value);
        setStatus(this.viewerStatus, 'Vídeo conectado!', 'ok');
        showToast('Stream recebido!', 'success');
      };
      this.pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.candidateBuffer.push(event.candidate);
          this.emitDebounce();
        }
      };
      this.pc.oniceconnectionstatechange = () => {
        const stateStr = this.pc.iceConnectionState;
        if (stateStr === 'connected') {
          setStatus(this.viewerStatus, 'Vídeo conectado.', 'ok');
        } else if (stateStr === 'failed' || stateStr === 'disconnected') {
          setStatus(this.viewerStatus, 'Conexão perdida.', 'error');
        }
      };

      savePreference('session', { roomId, role: 'viewer', password, username });
      this.socket.emit('room-joined', { roomId });
      document.getElementById('chatToggle').classList.remove('hidden');
      document.getElementById('chatContainer').classList.remove('hidden');
    });
  }

  sendCandidates() {
    if (this.candidateBuffer.length === 0) return;
    const toSend = this.candidateBuffer.slice();
    this.candidateBuffer = [];
    this.socket.emit('signal', {
      to: this.hostSocketId,
      data: { candidates: toSend },
    });
  }

  handleHostLeft() {
    setStatus(this.viewerStatus, 'O host encerrou a transmissão.', 'error');
    this.video.style.display = 'none';
    this.controls.classList.add('hidden');
    document.body.classList.remove('theater-mode');
    this.btnJoinRoom.disabled = false;
    if (this.pc) {
      cleanupPeerConnection(this.pc, true);
      this.pc = null;
      this.hostSocketId = null;
    }
    document.getElementById('chatToggle').classList.add('hidden');
    document.getElementById('chatContainer').classList.add('hidden');
    this.state.isHost = false;
    this.state.roomId = null;
    savePreference('session', null);
  }

  restore(roomId) {
    const saved = loadPreference('session', null);
    if (saved && saved.role === 'viewer') {
      this.joinRoom(saved.roomId, saved.password, saved.username);
    } else {
      setStatus(this.viewerStatus, 'Sessão não encontrada. Entre novamente.', 'error');
    }
  }
}
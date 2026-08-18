// host.js - Lógica do host

import { debounce, setStatus, cleanupPeerConnection, setBitrateLimit, savePreference, loadPreference, showToast } from './utils.js';

export class HostManager {
  constructor(socket, state) {
    this.socket = socket;
    this.state = state;
    this.peerConnections = {};
    this.candidateBuffers = {};
    this.iceDebouncers = {};
    this.recorder = null;
    this.statsMonitors = {};
    this.statsSamples = {};
    this.adaptive = {};
    this.bitrateSlider = document.getElementById('hostBitrate');
    this.bitrateValue = document.getElementById('hostBitrateValue');
    this.recordBtn = document.getElementById('hostRecordBtn');
    this.statsToggle = document.getElementById('hostStatsToggle');
    this.statsPanel = document.getElementById('hostStatsPanel');
    this.statsContent = document.getElementById('hostStatsContent');
    this.hostStatus = document.getElementById('hostStatus');
    this.hostPreview = document.getElementById('hostPreview');
    this.viewersList = document.getElementById('viewersList');
    this.hostMuteMic = document.getElementById('hostMuteMic');
    this.hostMicVolume = document.getElementById('hostMicVolume');
    this.hostMicVolumeLabel = document.getElementById('hostMicVolumeLabel');
    this.roomIdDisplay = document.getElementById('roomIdDisplay');
    this.hostRoomInfo = document.getElementById('hostRoomInfo');
    this.btnCreateRoom = document.getElementById('btnCreateRoom');
    this.copyRoomIdBtn = document.getElementById('copyRoomIdBtn');

    this.bindUI();
    this.bindSocketEvents();
  }

  bindUI() {
    // Bitrate
    if (this.bitrateSlider && this.bitrateValue) {
      this.bitrateSlider.addEventListener('input', () => {
        const val = parseInt(this.bitrateSlider.value, 10);
        this.bitrateValue.textContent = val;
        this.updateBitrate(val * 1000);
        savePreference('bitrate', val);
      });
      const savedBitrate = loadPreference('bitrate', 500);
      this.bitrateSlider.value = savedBitrate;
      this.bitrateValue.textContent = savedBitrate;
    }

    // Gravar
    if (this.recordBtn) {
      this.recordBtn.onclick = () => this.toggleRecording();
    }

    // Estatísticas
    if (this.statsToggle) {
      this.statsToggle.onclick = () => {
        this.statsPanel.classList.toggle('hidden');
        if (!this.statsPanel.classList.contains('hidden')) {
          this.startStats();
        } else {
          this.stopStats();
        }
      };
    }

    // Copiar ID
    if (this.copyRoomIdBtn) {
      this.copyRoomIdBtn.onclick = () => {
        const roomId = this.roomIdDisplay.textContent;
        if (roomId) {
          navigator.clipboard.writeText(roomId).then(() => {
            showToast('ID copiado!', 'success');
          }).catch(() => {
            showToast('Falha ao copiar.', 'error');
          });
        }
      };
    }

    // Microfone
    if (this.hostMuteMic) {
      this.hostMuteMic.onclick = () => {
        if (!this.state.micGain) return;
        const current = this.state.micGain.gain.value;
        if (current > 0) {
          this.state.micGain.gain.value = 0;
          this.hostMuteMic.textContent = '🔇 Desmutar Mic';
        } else {
          this.state.micGain.gain.value = parseFloat(this.hostMicVolume.value) || 0.8;
          this.hostMuteMic.textContent = '🔊 Mudo Mic';
        }
      };
    }

    if (this.hostMicVolume) {
      this.hostMicVolume.addEventListener('input', () => {
        if (!this.state.micGain) return;
        const val = parseFloat(this.hostMicVolume.value);
        this.state.micGain.gain.value = val;
        this.hostMicVolumeLabel.textContent = val.toFixed(2);
        if (val > 0 && this.hostMuteMic.textContent === '🔇 Desmutar Mic') {
          this.hostMuteMic.textContent = '🔊 Mudo Mic';
        }
      });
    }
  }

  bindSocketEvents() {
    this.socket.on('viewer-joined', async ({ viewerId, viewerNumber }) => {
      this.handleViewerJoined(viewerId, viewerNumber);
    });
    this.socket.on('viewer-left', ({ viewerId }) => {
      this.handleViewerLeft(viewerId);
    });
    this.socket.on('signal', async ({ from, data }) => {
      if (this.peerConnections[from] && data.sdp && data.sdp.type === 'answer') {
        await this.peerConnections[from].setRemoteDescription(new RTCSessionDescription(data.sdp));
        return;
      }
      if (this.peerConnections[from] && data.candidates) {
        for (const candidate of data.candidates) {
          try {
            await this.peerConnections[from].addIceCandidate(candidate);
          } catch (e) {
            console.warn('Failed to add ICE candidate (host):', e);
          }
        }
        return;
      }
      if (this.peerConnections[from] && data.candidate) {
        try {
          await this.peerConnections[from].addIceCandidate(data.candidate);
        } catch (e) {
          console.warn('Failed to add single ICE candidate (host):', e);
        }
        return;
      }
    });
  }

  async createRoom(password, username, enableMic) {
    // Presets de captura com fallback: tenta 1080p30, depois 720p30, depois
    // 1024x768@24 e por fim o padrão do navegador. Erros de permissão (usuário
    // recusou) abortam imediatamente; erros de constraints seguem para o próximo.
    let screenStream = null;
    const capturePresets = [
      { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      { width: { ideal: 1024 }, height: { ideal: 768 }, frameRate: { ideal: 24 } },
      true,
    ];
    for (const video of capturePresets) {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video, audio: true });
        break;
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          throw new Error('Permissão de compartilhamento negada.');
        }
        console.warn('getDisplayMedia com constraints reduzidas:', err.name, err.message);
      }
    }
    if (!screenStream) {
      throw new Error('Não foi possível capturar a tela.');
    }

    const hasSystemAudio = screenStream.getAudioTracks().length > 0;
    if (!hasSystemAudio) {
      setStatus(this.hostStatus, 'Áudio do sistema não disponível. Apenas vídeo.', 'warning');
    }

    let micStream = null;
    if (enableMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.state.micStream = micStream;
        this.state.isMicEnabled = true;
      } catch (err) {
        setStatus(this.hostStatus, 'Microfone não acessível. Sem mic.', 'warning');
      }
    }

    let finalStream = screenStream;
    if (micStream && hasSystemAudio) {
      try {
        finalStream = await this.mixAudioStreams(screenStream, micStream);
      } catch (err) {
        console.warn('Mixagem falhou, usando stream da tela.', err);
        finalStream = screenStream;
      }
    } else if (micStream && !hasSystemAudio) {
      micStream.getAudioTracks().forEach(track => screenStream.addTrack(track));
      finalStream = screenStream;
    }

    this.state.localStream = finalStream;
    this.state.isHost = true;
    this.state.username = username;

    this.hostPreview.srcObject = finalStream;
    this.hostPreview.style.display = 'block';
    this.btnCreateRoom.disabled = true;

    if (this.state.micGain) {
      this.hostMuteMic.classList.remove('hidden');
      this.hostMicVolume.classList.remove('hidden');
      this.hostMicVolumeLabel.classList.remove('hidden');
      this.hostMuteMic.textContent = '🔊 Mudo Mic';
      this.hostMicVolume.value = this.state.micGain.gain.value;
      this.hostMicVolumeLabel.textContent = this.state.micGain.gain.value.toFixed(2);
    }

    const result = await new Promise((resolve) => {
      this.socket.emit('create-room', { password, username }, resolve);
    });
    if (!result.ok) {
      throw new Error(result.error || 'Falha ao criar sala.');
    }
    this.state.roomId = result.roomId;
    this.roomIdDisplay.textContent = result.roomId;
    this.hostRoomInfo.classList.remove('hidden');
    setStatus(this.hostStatus, hasSystemAudio ? 'Compartilhando tela + áudio. Envie ID e senha.' : 'Compartilhando tela (sem áudio).', 'ok');
    showToast('Sala criada!', 'success');

    const videoTrack = finalStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => this.cleanup();
    }

    savePreference('session', { roomId: result.roomId, role: 'host', password, username });
    this.socket.emit('room-created', { roomId: result.roomId });
  }

  async mixAudioStreams(screenStream, micStream) {
    if (!this.state.audioContext) {
      this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = this.state.audioContext;
    const screenSource = ctx.createMediaStreamSource(screenStream);
    const micSource = ctx.createMediaStreamSource(micStream);
    const screenGain = ctx.createGain();
    screenGain.gain.value = 1.0;
    const micGain = ctx.createGain();
    micGain.gain.value = 0.8;
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
    this.state.screenGain = screenGain;
    this.state.micGain = micGain;
    return mixedStream;
  }

  async handleViewerJoined(viewerId, viewerNumber) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    this.peerConnections[viewerId] = pc;
    this.candidateBuffers[viewerId] = [];
    this.iceDebouncers[viewerId] = debounce(() => {
      this.emitIceCandidatesForViewer(viewerId);
    }, 50);

    this.startAdaptiveBitrate(viewerId);

    this.state.localStream.getTracks().forEach(track => pc.addTrack(track, this.state.localStream));

    pc.onnegotiationneeded = () => {
      const bitrate = parseInt(this.bitrateSlider.value, 10) * 1000 || 500000;
      setBitrateLimit(pc, bitrate);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.candidateBuffers[viewerId].push(event.candidate);
        this.iceDebouncers[viewerId](viewerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const stateStr = pc.iceConnectionState;
      console.log(`ICE state for viewer ${viewerId}: ${stateStr}`);
      if (stateStr === 'failed' || stateStr === 'disconnected') {
        setStatus(this.hostStatus, `Conexão com espectador ${viewerNumber} perdida.`, 'error');
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.socket.emit('signal', { to: viewerId, data: { sdp: offer } });
    this.updateViewersList();
    showToast(`Espectador #${viewerNumber} entrou.`, 'info');
  }

  handleViewerLeft(viewerId) {
    if (this.peerConnections[viewerId]) {
      cleanupPeerConnection(this.peerConnections[viewerId], false);
      delete this.peerConnections[viewerId];
      delete this.candidateBuffers[viewerId];
      delete this.iceDebouncers[viewerId];
      this.stopAdaptiveBitrate(viewerId);
    }
    this.updateViewersList();
  }

  emitIceCandidatesForViewer(viewerId) {
    const candidates = this.candidateBuffers[viewerId] || [];
    if (candidates.length === 0) return;
    const toSend = candidates.slice();
    this.candidateBuffers[viewerId] = [];
    this.socket.emit('signal', { to: viewerId, data: { candidates: toSend } });
  }

  updateViewersList() {
    const count = Object.keys(this.peerConnections).length;
    this.viewersList.textContent = count === 0 ? 'Nenhum espectador ainda.' : `${count} espectador(es) conectado(s).`;
  }

  updateBitrate(bitrate) {
    Object.values(this.peerConnections).forEach(pc => {
      setBitrateLimit(pc, bitrate);
    });
    // Atualiza o teto dos controladores adaptativos para que possam subir/descer
    // dentro do novo limite escolhido pelo host.
    Object.values(this.adaptive).forEach(controller => {
      controller.ceiling = bitrate;
      if (controller.current !== null) {
        controller.current = Math.min(controller.current, bitrate);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Bitrate adaptativo por espectador
  // ---------------------------------------------------------------------------
  // Monitora cada conexão (perda de pacotes e RTT) e reduz o maxBitrate quando
  // a rede degrada, voltando a subir gradualmente quando ela se estabiliza —
  // sempre respeitando o teto escolhido no slider.
  startAdaptiveBitrate(viewerId) {
    const pc = this.peerConnections[viewerId];
    if (!pc || this.adaptive[viewerId]) return;

    const ceiling = (parseInt(this.bitrateSlider.value, 10) || 500) * 1000;
    const controller = {
      ceiling,
      current: null,
      prev: null,
      healthyWindows: 0,
      interval: null,
    };

    controller.interval = setInterval(async () => {
      try {
        const stats = await pc.getStats();
        let outbound = null;
        let rtt = 0;
        stats.forEach((stat) => {
          if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
            outbound = stat;
          }
          if (stat.type === 'candidate-pair' && stat.nominated && stat.currentRoundTripTime) {
            rtt = stat.currentRoundTripTime * 1000;
          }
        });
        if (!outbound) return;

        const sample = {
          ts: outbound.timestamp,
          bytes: outbound.bytesSent || 0,
          lost: outbound.packetsLost || 0,
          packets: outbound.packetsSent || 0,
        };

        if (controller.prev) {
          const dtMs = sample.ts - controller.prev.ts;
          if (dtMs > 0) {
            const packetDelta = sample.packets - controller.prev.packets;
            const lostDelta = Math.max(0, sample.lost - controller.prev.lost);
            const lossRatio = packetDelta > 0 ? lostDelta / packetDelta : 0;

            let current = controller.current ?? controller.ceiling;
            if (lossRatio > 0.02 || rtt > 300) {
              current = Math.max(100000, Math.round(current * 0.75));
              controller.healthyWindows = 0;
            } else if (current < controller.ceiling) {
              controller.healthyWindows += 1;
              if (controller.healthyWindows >= 3) {
                current = Math.min(controller.ceiling, Math.round(current * 1.15));
                controller.healthyWindows = 0;
              }
            } else {
              controller.healthyWindows = 0;
            }
            if (current !== controller.current) {
              controller.current = current;
              setBitrateLimit(pc, current);
            }
          }
        }
        controller.prev = sample;
      } catch (e) {
        console.warn('Adaptive bitrate error:', e);
      }
    }, 3000);

    this.adaptive[viewerId] = controller;
  }

  stopAdaptiveBitrate(viewerId) {
    const controller = this.adaptive[viewerId];
    if (controller) {
      clearInterval(controller.interval);
      delete this.adaptive[viewerId];
    }
  }

  toggleRecording() {
    if (!this.recorder) {
      if (!this.state.localStream) {
        showToast('Inicie o compartilhamento primeiro.', 'error');
        return;
      }
      this.recorder = new MediaRecorder(this.state.localStream, {
        mimeType: 'video/webm;codecs=vp9',
      });
      let chunks = [];
      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      this.recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recording-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        chunks = [];
        this.recordBtn.textContent = '🔴 Gravar';
      };
    }
    if (this.recorder.state === 'recording') {
      this.recorder.stop();
      this.recordBtn.textContent = '🔴 Gravar';
    } else {
      this.recorder.start(1000);
      this.recordBtn.textContent = '⏹️ Parar Gravação';
    }
  }  startStats() {
    Object.values(this.peerConnections).forEach(pc => {
      if (!this.statsMonitors[pc]) {
        const monitor = { pc, interval: null };
        monitor.interval = setInterval(async () => {
          try {
            const stats = await pc.getStats();
            let report = { bitrate: 0, packetsLost: 0, rtt: 0 };
            stats.forEach((stat) => {
              if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
                // Bitrate real = delta de bytes entre duas amostras / delta de tempo.
                // (o rtpTimestamp não é wall-clock; dividir bytes por ele dava valor sem sentido)
                const prev = this.statsSamples[pc];
                if (prev && stat.timestamp > prev.ts && stat.bytesSent >= prev.bytes) {
                  const dtMs = stat.timestamp - prev.ts;
                  report.bitrate = dtMs > 0 ? ((stat.bytesSent - prev.bytes) * 8 * 1000) / dtMs : 0;
                  report.packetsLost = Math.max(0, (stat.packetsLost || 0) - prev.lost);
                }
                this.statsSamples[pc] = {
                  ts: stat.timestamp,
                  bytes: stat.bytesSent,
                  lost: stat.packetsLost || 0,
                };
              }
              if (stat.type === 'candidate-pair' && stat.nominated && stat.currentRoundTripTime) {
                report.rtt = stat.currentRoundTripTime * 1000 || 0;
              }
            });
            this.statsContent.innerHTML = `
              <div>Bitrate: ${(report.bitrate / 1000).toFixed(0)} kbps</div>
              <div>Pacotes perdidos (janela): ${report.packetsLost}</div>
              <div>RTT: ${report.rtt.toFixed(1)} ms</div>
            `;
          } catch (e) {
            console.warn('Stats error:', e);
          }
        }, 2000);
        this.statsMonitors[pc] = monitor;
      }
    });
  }

  stopStats() {
    Object.values(this.statsMonitors).forEach(m => clearInterval(m.interval));
    this.statsMonitors = {};
    this.statsSamples = {};
    this.statsContent.textContent = 'Estatísticas paradas.';
  }

  cleanup() {
    setStatus(this.hostStatus, 'Compartilhamento encerrado.', 'error');
    Object.values(this.peerConnections).forEach(pc => cleanupPeerConnection(pc, false));
    this.peerConnections = {};
    Object.keys(this.iceDebouncers).forEach(id => delete this.iceDebouncers[id]);
    Object.keys(this.candidateBuffers).forEach(id => delete this.candidateBuffers[id]);
    Object.keys(this.adaptive).forEach(id => this.stopAdaptiveBitrate(id));
    this.updateViewersList();
    this.btnCreateRoom.disabled = false;
    if (this.state.audioContext) {
      this.state.audioContext.close();
      this.state.audioContext = null;
    }
    if (this.state.micStream) {
      this.state.micStream.getTracks().forEach(t => t.stop());
      this.state.micStream = null;
    }
    if (this.state.localStream) {
      this.state.localStream.getTracks().forEach(t => t.stop());
      this.state.localStream = null;
    }
    this.state.isHost = false;
    this.state.roomId = null;
    this.hostMuteMic.classList.add('hidden');
    this.hostMicVolume.classList.add('hidden');
    this.hostMicVolumeLabel.classList.add('hidden');
    this.hostRoomInfo.classList.add('hidden');
    this.hostPreview.style.display = 'none';
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.stop();
      this.recordBtn.textContent = '🔴 Gravar';
    }
    this.stopStats();
    savePreference('session', null);
  }

  restore(roomId) {
    this.roomIdDisplay.textContent = roomId;
    this.hostRoomInfo.classList.remove('hidden');
    this.btnCreateRoom.disabled = true;
    setStatus(this.hostStatus, 'Sessão restaurada. Reinicie o compartilhamento.', 'warning');
  }
}
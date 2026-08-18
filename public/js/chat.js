// chat.js - Gerenciamento do chat

import { showToast } from './utils.js';

export class ChatManager {
  constructor(socket) {
    this.socket = socket;
    this.container = document.getElementById('chatContainer');
    this.input = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('chatSend');
    this.messages = document.getElementById('chatMessages');
    this.visible = false;
    this.bindEvents();
    this.bindSocketEvents();
  }

  bindEvents() {
    this.sendBtn.onclick = () => this.send();
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.send();
      }
    });
  }

  bindSocketEvents() {
    this.socket.on('chat-message', ({ from, role, viewerNumber, message }) => {
      let label = role === 'host' ? 'Host' : (viewerNumber !== null ? `Espectador #${viewerNumber}` : 'Espectador');
      this.addMessage(label, message);
    });
  }

  toggle() {
    this.visible = !this.visible;
    this.container.classList.toggle('hidden', !this.visible);
    if (this.visible) this.input.focus();
  }

  send() {
    const text = this.input.value.trim();
    if (!text) return;
    if (text.length > 500) {
      showToast('Mensagem muito longa (máx 500).', 'error');
      return;
    }
    this.socket.emit('chat-message', { message: text });
    this.addMessage('Você', text, 'local');
    this.input.value = '';
    this.input.focus();
  }

  addMessage(username, message, type = 'remote') {
    const div = document.createElement('div');
    div.className = 'chat-message';
    const label = document.createElement('span');
    label.className = 'chat-label';
    label.textContent = username + ': ';
    const text = document.createElement('span');
    text.className = 'chat-text';
    text.textContent = message;
    div.appendChild(label);
    div.appendChild(text);
    if (type === 'local') div.style.opacity = '0.7';
    this.messages.appendChild(div);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  show() {
    this.container.classList.remove('hidden');
    this.visible = true;
  }

  hide() {
    this.container.classList.add('hidden');
    this.visible = false;
  }
}
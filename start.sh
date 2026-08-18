#!/usr/bin/env bash
# Screen Sharing - servidor local (Linux/macOS)
set -e
cd "$(dirname "$0")"

echo "============================================"
echo " Screen Sharing - Servidor local"
echo "============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] Node.js nao encontrado."
  echo "Instale o Node.js LTS em https://nodejs.org e rode este script de novo."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Instalando dependencias na primeira vez, pode demorar um pouco..."
  npm install
fi

# Descobre o IP local da rede (macOS: ipconfig getifaddr; Linux: hostname -I)
# e valida que o resultado parece um IPv4 antes de usar.
looks_like_ipv4() {
  case "$1" in
    [0-9]*.[0-9]*.[0-9]*.[0-9]*) return 0 ;;
    *) return 1 ;;
  esac
}

IP=""
for iface in en0 en1 en2; do
  IP="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  looks_like_ipv4 "$IP" && break
  IP=""
done
if [ -z "$IP" ]; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  looks_like_ipv4 "$IP" || IP=""
fi
[ -z "$IP" ] && IP="IP_DA_MAQUINA"

echo
echo " Abra no SEU computador (para compartilhar a tela):"
echo "   http://localhost:3000"
echo
echo " Amigos na MESMA rede Wi-Fi abrem:"
echo "   http://${IP}:3000"
echo
echo " Para compartilhar pela INTERNET (qualquer rede), use um tunel HTTPS:"
echo "   cloudflared tunnel --url http://localhost:3000"
echo
echo " IMPORTANTE: use sempre http://localhost:3000 para compartilhar a tela"
echo " (o navegador bloqueia a captura fora de localhost/HTTPS)."
echo
echo " Pressione Ctrl+C para parar o servidor."
echo "============================================"
echo

node server.js

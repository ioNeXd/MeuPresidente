#!/usr/bin/env bash
set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
fail() { echo -e "${RED}[X]${NC} $1"; }
info() { echo -e "${CYAN}[*]${NC} $1"; }

echo "============================================"
echo "   Screen Sharing - WebRTC P2P"
echo "============================================"
echo ""

# --- Detectar sistema ---
OS="$(uname -s)"
ARCH="$(uname -m)"

# --- Verificar/instalar Node.js ---
if ! command -v node &> /dev/null; then
    warn "Node.js nao encontrado."
    info "Instalando Node.js..."

    if [ "$OS" = "Darwin" ]; then
        if command -v brew &> /dev/null; then
            brew install node
        else
            fail "Homebrew nao encontrado. Instale primeiro:"
            echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
            exit 1
        fi
    elif [ "$OS" = "Linux" ]; then
        if command -v apt &> /dev/null; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command -v dnf &> /dev/null; then
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo dnf install -y nodejs
        else
            fail "Gerenciador de pacotes nao suportado."
            echo "  Baixe manualmente: https://nodejs.org"
            exit 1
        fi
    fi
    ok "Node.js instalado."
else
    ok "Node.js encontrado ($(node --version))."
fi

# --- Verificar/instalar cloudflared ---
HAS_CLOUDFLARED=false
if command -v cloudflared &> /dev/null; then
    HAS_CLOUDFLARED=true
    ok "cloudflared encontrado."
else
    warn "cloudflared nao encontrado."
    info "Instalando cloudflared..."

    if [ "$OS" = "Darwin" ]; then
        if command -v brew &> /dev/null; then
            brew install cloudflared
            HAS_CLOUDFLARED=true
        fi
    elif [ "$OS" = "Linux" ]; then
        ARCH_NAME="amd64"
        [ "$ARCH" = "aarch64" ] && ARCH_NAME="arm64"
        curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH_NAME}" -o /tmp/cloudflared
        chmod +x /tmp/cloudflared
        sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
        HAS_CLOUDFLARED=true
    fi

    if [ "$HAS_CLOUDFLARED" = true ]; then
        ok "cloudflared instalado."
    else
        warn "cloudflared nao instalado."
        warn "Sera possivel acessar apenas pela rede local."
    fi
fi

# --- Instalar dependencias ---
if [ ! -d "node_modules" ]; then
    info "Instalando dependencias..."
    npm install --omit=dev
    ok "Dependencias instaladas."
fi

# --- Detectar IP da rede ---
LOCAL_IP=""
if [ "$OS" = "Darwin" ]; then
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "")
elif [ "$OS" = "Linux" ]; then
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
fi
# Validar IPv4
if ! echo "$LOCAL_IP" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    LOCAL_IP=""
fi

echo ""
echo "============================================"
echo "   URLs de acesso"
echo "============================================"
echo ""
echo "  Localhost:   http://localhost:3000"
if [ -n "$LOCAL_IP" ]; then
    echo "  Rede local:  http://${LOCAL_IP}:3000"
fi
echo ""

# --- Iniciar cloudflared tunnel ---
TUNNEL_URL=""
if [ "$HAS_CLOUDFLARED" = true ]; then
    info "Iniciando tunel HTTPS gratuito..."
    cloudflared tunnel --url http://localhost:3000 &> /tmp/cloudflared.log &
    CF_PID=$!

    # Aguardar o link aparecer no log
    for i in $(seq 1 15); do
        sleep 1
        TUNNEL_URL=$(grep -o 'https://[^ ]*trycloudflare[^ ]*' /tmp/cloudflared.log 2>/dev/null | head -1 || echo "")
        if [ -n "$TUNNEL_URL" ]; then
            break
        fi
    done

    if [ -n "$TUNNEL_URL" ]; then
        echo "  Internet:    ${TUNNEL_URL}"
    else
        warn "Tunel demorou para iniciar."
    fi
else
    warn "cloudflared nao disponivel."
    echo "  Para acesso pela internet, instale:"
    echo "    brew install cloudflared"
fi

echo ""
echo "============================================"
echo "   Servidor iniciando..."
echo "============================================"
echo ""
echo "  Pressione Ctrl+C para encerrar."
echo ""

# --- Iniciar servidor ---
node server.js

# Cleanup cloudflared ao sair
if [ -n "$CF_PID" ]; then
    kill "$CF_PID" 2>/dev/null || true
fi

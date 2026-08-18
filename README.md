# 🖥️ Screen Sharing — Compartilhamento de Tela P2P

Compartilhe sua tela com amigos pelo navegador, sem instalar nada. Funciona como o Discord, mas leve e simples — abra o link, crie uma sala, mande o código e pronto.

## Como funciona (resumo rápido)

1. Você abre o link, cria uma sala com senha e clica em **Iniciar compartilhamento**
2. Manda o **código da sala** + **senha** pro amigo (WhatsApp, Telegram, etc.)
3. O amigo abre o link, digita o código e vê sua tela — em segundos

O vídeo vai **direto do seu navegador pro dele** (peer-to-peer), sem passar por servidor. O servidor só ajuda a fazer a conexão acontecer.

## O que tem

- 🖥️ Compartilhamento de tela com áudio do sistema
- 🎤 Microfone op mistura com o áudio da tela
- 💬 Chat integrado na sala
- 🎬 Gravação da transmissão (salva um arquivo .webm no seu PC)
- 📊 Estatísticas em tempo real (qualidade, perda de pacotes)
- 🎨 Tema claro/escuro
- 🔄 Reconexão automática se a conexão cair
- ⚡ Controle de qualidade (bitrate) e FPS (30/60/120)

## Como usar — passo a passo

### Criar uma sala (Host)

1. Abra `http://localhost:3000`
2. Na aba **Compartilhar (Host)**, digite uma senha (mínimo 4 caracteres)
3. Clique em **🚀 Iniciar compartilhamento**
4. Escolha o que compartilhar (tela, janela ou aba) na janela do navegador
5. Anote o **ID da sala** (tipo `7F3K9A`) que aparece na tela
6. Envie o ID + senha pro amigo

### Entrar como espectador

1. Abra `http://localhost:3000`
2. Na aba **Assistir (Espectador)**, digite o ID da sala e a senha
3. Clique em **🎥 Entrar na sala**
4. Pronto — a tela do host aparece

### Controles do host

- **Bitrate** (100–2000 kbps): controla a qualidade. Menos = mais fluido; mais = mais nítido
- **FPS** (30/60/120): quadros por segundo. 30 é suficiente pra maioria; 60 pra jogos; 120 se a tela e a rede aguentarem
- **🔴 Gravar**: grava a transmissão e salva um arquivo .webm
- **📊 Estatísticas**: mostra bitrate real, pacotes perdidos e latência
- **💬 Chat**: clique no ícone 💬 no canto superior direito

### Controles do espectador

- **Teatro** (🎬): expande o vídeo pra tela inteira dentro do card
- **Tela cheia** (⛶): entra em tela cheia no navegador
- **Mini** (🗗): Picture-in-Picture — janela flutuante por cima de tudo
- **Volume** e **Mudo**: controle o áudio que chega

## Como rodar

### Jeito fácil (recomendado)

Dê **dois cliques** no arquivo correto pro seu sistema:

| Sistema | Arquivo |
|---------|---------|
| Windows | `start.bat` |
| Mac/Linux | `start.sh` |

O script faz tudo sozinho:
- Verifica se o Node.js está instalado (se não, instala)
- Instala as dependências do projeto
- Sobe o servidor
- Mostra os links prontos na tela

### Jeito manual (se preferir)

```bash
npm install        # instala dependências
node server.js     # sobe o servidor
```

Depois abra `http://localhost:3000` no navegador.

### Jeito avançado (desenvolvimento)

```bash
npm run dev        # sobe com nodemon (reinicia ao alterar arquivos)
```

## Como os amigos acessam pela internet

Se os amigos estão em outra rede (outra casa, outra cidade), `localhost` não funciona. Use o **túnel HTTPS gratuito** do Cloudflare:

```bash
cloudflared tunnel --url http://localhost:3000
```

Ele gera um link tipo `https://abc-xyz.trycloudflare.com`. Manda esse link pro amigo — funciona de qualquer lugar, sem precisar liberar porta no roteador.

**Se não tem o cloudflared instalado**, os scripts `start.bat`/`start.sh` já instalam automaticamente.

### Pra que o host use o link do túnel

O navegador só permite capturar tela em endereços **seguros** (`https://` ou `localhost`). Se o host acessar por `http://192.168.1.5:3000`, a captura de tela **vai falhar**. Por isso o túnel HTTPS é importante — ele garante que funcione pra todo mundo.

> O espectador não precisa de `https://` — ele só recebe o vídeo.

## Deploy no Render (grátis, com HTTPS automático)

Se quiser um endereço fixo na internet:

1. Suba o projeto no GitHub
2. Crie conta em https://render.com (pode logar com GitHub)
3. Clique em **New → Web Service** e selecione o repositório
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
5. Clique em **Deploy**

Em 1–3 minutos o Render gera uma URL tipo `https://seu-app.onrender.com`. Esse é o link que você abre pra ser host e que manda pros amigos.

> No plano grátis, o Render dorme depois de ~15 minutos sem acesso. Na primeira visita do dia, demora uns 30–50 segundos pra acordar. Não afeta o uso.

## Empacotar como executável (sem precisar de Node)

Se quiser distribuir o servidor pros amigos sem exigir que eles instalem Node:

```bash
npm run build
```

Gera executáveis em `dist/` (~60 MB cada) pra Windows, Linux e Mac. Cada um roda o arquivo do seu sistema e o servidor sobe na porta 3000 — sem instalar nada.

## Segurança

- **Ninguém controla o PC de ninguém.** Não existe código pra receber cliques ou teclado — o projeto só captura a tela em modo leitura
- **Sala protegida por senha** — verificada no servidor por hash SHA-256
- **Bloqueio de força bruta** — 5 tentativas erradas e o socket é desconectado
- **Chat seguro** — mensagens são escapadas no servidor (proteção contra XSS)
- **Salas em memória** — não ficam salvas em banco de dados; se o servidor reiniciar, as salas somem (é intencional)

## Variáveis de ambiente

| Variável | Padrão | O que faz |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `NODE_ENV` | — | `production` ativa headers de segurança (HTTPS, HSTS) |
| `ALLOW_INSECURE_ORIGIN` | `0` | `1` relaxa headers pra testes via HTTP/IP em LAN |
| `MAX_CONNECTIONS_PER_IP` | `10` | Limite de conexões por IP |
| `MAX_TOTAL_CONNECTIONS` | `200` | Limite total de conexões |
| `APP_ORIGINS` | vazio | Origins permitidas por CORS (separadas por vírgula) |

## Limitações

- **Poucos espectadores** — como é P2P, cada espectador é uma conexão direta do host. Pra muita gente ao mesmo tempo, seria necessário um servidor de mídia (SFU), que foge do escopo
- **Sem TURN** — em redes muito restritivas (firewall corporativo) a conexão pode falhar; em casa normalmente funciona
- **Áudio do sistema** depende do navegador — Chrome/Edge suportam; Firefox nem sempre
- **Chat e salas são temporários** — não há histórico salvo

## Licença

Uso pessoal. Não há licença formal definida.

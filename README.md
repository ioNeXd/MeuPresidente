# Compartilhamento de Tela P2P

Protótipo de compartilhamento de tela via navegador (estilo "Discord"), usando WebRTC.
O vídeo trafega **direto entre os navegadores** (peer-to-peer); o servidor só cuida
de criar a sala, validar a senha e trocar as informações iniciais de conexão (sinalização).

## Recursos

- **Compartilhamento de tela P2P** com áudio do sistema e opção de misturar o
  microfone (mixagem via WebAudio, com controle de ganho e mudo).
- **Chat integrado** — com rate limit, limite de tamanho e escape no servidor
  (proteção contra XSS).
- **Controle de bitrate** (100–2000 kbps) com **ajuste adaptativo por espectador**:
  em conexões com perda de pacotes ou latência alta o bitrate é reduzido
  automaticamente, e volta a subir quando a rede estabiliza.
- **Captura com fallback de resolução** — tenta 1080p30, depois 720p30,
  1024×768@24 e por fim o padrão do navegador, sem travar a captura em
  máquinas/ telas que não suportam as constraints ideais.
- **Gravação local** da transmissão (WebM) e **estatísticas em tempo real**
  (bitrate, perda de pacotes, RTT).
- **Tema claro/escuro**, modo teatro, tela cheia, Picture-in-Picture e controles
  de volume — preferências salvas no navegador.
- **Restauração de sessão**: se a conexão cair, host e espectadores voltam para
  a sala automaticamente na reconexão.
- **Cache de estáticos com versionamento por hash de conteúdo** — o HTML nunca é
  cacheado, e os assets `.js`/`.css` mudam de URL a cada deploy, então o
  navegador não recarrega tudo de novo em cada atualização.

## Como usar

1. Na aba **Compartilhar (Host)**, defina uma senha (mín. 4 caracteres), opcionalmente
   ative o microfone e clique em **Iniciar compartilhamento**.
2. Envie o **ID da sala** (6 letras/números, ex: `7F3K9A`) e a senha para quem assistir.
3. Na aba **Assistir (Espectador)**, entre com ID + senha e aguarde o vídeo.
4. O host pode ajustar o bitrate (qualidade × consumo de banda), gravar a tela,
   ver estatísticas e usar o chat (ícone 💬).

## Rodar localmente

```bash
npm install
node server.js
```

Acesse `http://localhost:3000`. Para desenvolvimento com reload automático:
`npm run dev` (nodemon).

## Deploy no Render (grátis, com HTTPS automático)

1. Suba este projeto para um repositório no GitHub.
2. Crie uma conta em https://render.com (dá pra logar com o GitHub).
3. No painel: **New → Web Service** e selecione o repositório.
4. Configuração do build:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
5. Deploy. Em 1–3 minutos o Render gera uma URL tipo
   `https://seu-app.onrender.com` — esse é o link que você abre pra ser
   host, e que manda pros seus amigos abrirem como espectadores.

No plano free, o serviço "dorme" depois de um tempo sem acesso e demora
uns 30–50s pra acordar na primeira conexão do dia. Não afeta o uso em si,
só a primeira abertura.

## O que garante a segurança

- **Ninguém controla o PC de ninguém.** O projeto só implementa `getDisplayMedia`
  (captura de tela em modo leitura) e áudio — não existe nenhum canal de dados
  WebRTC nem qualquer código que receba ou repasse cliques/teclado. Não há como um
  espectador enviar comandos para o host, porque essa funcionalidade
  simplesmente não foi implementada.
- **Sala protegida por ID + senha.** O ID sozinho não basta — a senha é obrigatória
  (mínimo 4 caracteres) e é verificada no servidor via hash SHA-256, nunca em
  texto puro armazenado.
- **Bloqueio de força bruta.** Depois de 5 tentativas erradas de senha, a conexão
  daquele socket é derrubada.
- **Sinalização isolada por sala.** O servidor só deixa host e espectadores da
  MESMA sala trocarem mensagens de sinalização entre si — não dá pra injetar
  sinalização em outra sala ou tentar sequestrar a conexão de outra pessoa.
- **Chat seguro contra XSS.** Mensagens são escapadas no servidor antes de serem
  repassadas, com rate limit (500ms) e limite de 500 caracteres.
- **HTTPS obrigatório em produção.** No Render isso já vem de fábrica; é o que
  permite o `getDisplayMedia` funcionar sem gambiarra de flags de navegador.
- **Estado só em memória.** As salas não ficam salvas em banco de dados — se o
  servidor reiniciar, todas as salas somem. Isso é intencional para esse caso
  de uso (sessões pontuais, não um serviço permanente).

## Configuração (variáveis de ambiente)

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta do servidor HTTP. |
| `NODE_ENV` | — | `production` ativa os headers estritos e confia no `X-Forwarded-For` (Render define isso automaticamente). |
| `ALLOW_INSECURE_ORIGIN` | off | `1` relaxa headers de segurança (HSTS, `upgrade-insecure-requests`, COOP) para permitir acesso via IP/HTTP puro — testes locais em LAN/Radmin. Sem isso, em produção os headers estritos voltam a valer. |
| `MAX_CONNECTIONS_PER_IP` | `10` | Limite de conexões simultâneas por IP. Aplicado no handshake do Socket.io (mitigação de abuso/DoS básico). |
| `MAX_TOTAL_CONNECTIONS` | `200` | Limite total de conexões simultâneas no servidor. |
| `ROOM_TTL_MINUTES` | `10` | Tempo (minutos) que uma sala órfã — cujo host morreu sem desconexão limpa — fica de pé antes de ser removida pela varredura. |
| `ROOM_SWEEP_INTERVAL_MS` | `60000` | Intervalo da varredura de salas órfãs (ms). |
| `APP_ORIGINS` | vazio | Lista de origins permitidas via CORS, separadas por vírgula (ex: `https://seu-app.onrender.com`). Vazio = apenas mesma origem. |
| `TRUST_PROXY` | `1` se `NODE_ENV=production` | Confia no header `X-Forwarded-For` para identificar o IP real atrás de proxy. |

### Headers de segurança (helmet)

- **Em produção** (`NODE_ENV=production`): HSTS, `upgrade-insecure-requests`, COOP
  e CSP ficam ativos.
- **Fora de produção** (ou com `ALLOW_INSECURE_ORIGIN=1`): HSTS, COOP e
  `upgrade-insecure-requests` ficam desligados para o acesso via HTTP/IP puro
  funcionar em testes de LAN — o `upgrade-insecure-requests`, se ativo, faria o
  navegador reescrever todos os `http://` para `https://` e quebraria a página
  com `ERR_SSL_PROTOCOL_ERROR` num servidor que só fala HTTP.

### Logs de eventos de segurança

Tentativas de senha incorretas, desconexões por excesso de tentativas, rejeições
de origem e limites de conexão atingidos são registrados no console (prefixo
`[security]`) e guardados num buffer em memória (`securityEvents`, últimos 200
eventos). Não é gravado em arquivo público.

## Limitações a ter em mente

- Escala bem para poucos espectadores por sala (é P2P puro — cada espectador
  é uma conexão separada saindo do host). Para dezenas de pessoas ao mesmo
  tempo seria necessário um SFU (ex: LiveKit, mediasoup), o que foge do
  escopo de um protótipo pessoal.
- Sem TURN server: em redes muito restritivas (firewalls corporativos, por
  exemplo) a conexão pode falhar. Para uso entre amigos em redes domésticas
  normais, não costuma ser um problema.
- O áudio do sistema depende do navegador/SO suportar captura de áudio no
  `getDisplayMedia` (Chrome/Edge suportam; Firefox nem sempre). Se não houver,
  o host é avisado e segue só com vídeo.
- Chat e salas são efêmeros (estado só em memória) — não há histórico.

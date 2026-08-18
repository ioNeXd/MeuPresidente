# 🤝 Como Contribuir

Obrigado por querer ajudar! Aqui vai o passo a passo pra contribuir com o projeto.

## Primeiros passos

1. Faça um **fork** do repositório
2. Clone o fork na sua máquina:
   ```bash
   git clone https://github.com/SEU-USUARIO/screen-sharing-p2p.git
   cd screen-sharing-p2p
   ```
3. Instale as dependências:
   ```bash
   npm install
   ```
4. Crie uma branch pra sua mudança:
   ```bash
   git checkout -b minha-mudanca
   ```

## Regras de código

- Use **camelCase** pra variáveis, funções e métodos
- Nomes de eventos do Socket.IO em **kebab-case** (ex: `create-room`, `join-room`)
- Variáveis de ambiente em **MAIÚSCULAS_SEPARADAS_POR_UNDERSCORE**
- Indentação: 2 espaços
- Use `const` e `let`; evite `var`
- Comentários e documentação em **português**

## Estrutura do projeto

```
server.js              → Servidor Express + Socket.IO (sinalização, salas, segurança)
public/
  index.html           → Página principal
  style.css            → Estilos (tema dark/light)
  js/
    app.js             → Ponto de entrada, orquestra tudo
    host.js            → Lógica do host (captura, peers, bitrate)
    viewer.js          → Lógica do espectador
    chat.js            → Chat integrado
    utils.js           → Funções auxiliares (cleanup, toasts, preferências)
```

## O que cada módulo faz

| Módulo | Responsabilidade |
|--------|------------------|
| `server.js` | Salas, senhas (hash SHA-256), sinalização isolada, rate limiting, cache de estáticos |
| `host.js` | Captura de tela (com fallback de resolução), 1 conexão RTCPeerConnection por espectador, bitrate adaptativo, gravação |
| `viewer.js` | Recebe vídeo, controles (teatro, tela cheia, PiP, volume) |
| `chat.js` | Mensagens com rate limit (500ms) e limite de 500 caracteres |
| `utils.js` | `cleanupPeerConnection`, `showToast`, `savePreference`, debounce |

## Mensagens de commit

Use o modo imperativo ("Adiciona feature", não "Adicionei feature"):
- ✅ `Adiciona controle de FPS`
- ✅ `Corrige tela preta no segundo espectador`
- ✅ `Remove código morto do buffer de candidatos`
- ❌ `Updated README`
- ❌ `Fix bug`

Mantenha a primeira linha com menos de 72 caracteres. Referencie issues quando aplicável.

## Pull Requests

- Descreva claramente o que mudou e por quê
- Link issues relacionadas
- Cada PR deve focar em **uma mudança lógica** (não misture correção de bug com feature nova)
- Teste localmente antes de enviar:
  ```bash
  node server.js          # verifique se o servidor sobe
  node --check server.js  # verifique erros de sintaxe
  ```

## Encontrou um bug?

Abra uma **issue** descrevendo:
1. O que você esperava que acontecesse
2. O que realmente aconteceu
3. Passos pra reproduzir
4. Navegador e sistema operacional

## Descobriu uma falha de segurança?

**Não abra issue pública.** Reporte diretamente por email (veja o README). Falhas de segurança devem ser tratadas antes de serem divulgadas.

## Dicas pra desenvolvimento

- Use `npm run dev` pra rodar com **nodemon** (reinicia automaticamente ao alterar arquivos)
- O servidor aceita a variável `PORT` pra rodar em outra porta: `PORT=4000 node server.js`
- Teste com **dois navegadores diferentes** (ou aba anônima) pra simular host + espectador
- No Chrome, abra `chrome://flags/#unsafely-treat-insecure-origin-as-secure` e adicione `http://localhost:3000` pra testar em HTTP local

Obrigado por contribuir! 🚀

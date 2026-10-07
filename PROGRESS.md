# Progresso (arquivo de retomada)

Este arquivo existe para que uma sessão interrompida possa continuar de onde parou.

## Estado: funcional e testado
- Backend completo (`lib/`, `api/index.js`, `server.js`) + 159 testes unitários/API (`npm test`).
- Front-end completo: home com grade de torneios, login/cadastro, convite de administradores, painel do admin
  (Painel, Times, Ao vivo, Chaveamento, Marketing, Configurações) e página do visitante
  (início, jogos, chaveamento, times, inscrição com PIX/cartão, meu time + repescagem).
- E2E (`e2e/run.mjs`): 28 cenários passando · Pelada (`e2e/pelada.mjs`): 25 cenários.
- README com instruções (local, Vercel + Redis, pagamentos, segurança, limitações).

## App Pelada (PWA) — adicionado
- `/pelada/` (HTML próprio + manifesto + service worker + ícones). Backend em `lib/routes/peladas.js`, regras em `lib/domain/pelada.js`
  e `public/assets/js/shared/pelada.js`; telas em `public/assets/js/pelada/`; CSS em `public/assets/css/pelada.css`.
- Botão "Organize a pelada" na home do ArenaMaster (`/pelada/organizar`: sem conta → autenticação rápida; com conta → Dashboard).
- Testes: `tests/unit/pelada-*.test.js` (regras, API, domínio, PWA), `e2e/pelada.mjs` (19 cenários) e `e2e/pelada-a11y.mjs`.
- Tela de compartilhamento: arte exata do modelo do Canva (cópia limpa, sem os textos variáveis: `DAHXVxxikls`; original `DAHXVw36EII` intocado) em alta resolução + textos dinâmicos (período, nomes, gols) calibrados sobre o modelo. O rodapé "arenamaster.skin" faz parte da arte.
- Celular (PWA instalado): topo verde (combina com `theme-color`), barra de navegação inferior (`.pl-bnav`, só com conta), modais como folha,
  campos com 16px (o iOS não dá zoom ao focar), botões fixos no formulário e botão de tema no topo. Qualquer elemento mais largo que a tela
  faz o Chrome mobile encolher a página inteira ("modo desktop"): `e2e/pelada.mjs` confere 390/360/320px.
- Pelada demo: botão "Criar pelada demo" na criação (`POST /api/pelada/peladas/demo`) → jogo de hoje com 17 confirmados (nome de 2 palavras + avatar SVG gerado). Elenco em código (`lib/domain/pelada-demo.js`, IDs `pl_demoNN` resolvidos em `getPlayer` e na rota de imagem; nada vai para o banco). Testes: `tests/unit/pelada-demo.test.js`.
- Ao criar novos arquivos JS em `public/assets/js/pelada/`, inclua-os no `SHELL` de `public/pelada/sw.js` (há teste que confere).

- **Cerca e sorteio automático** (substituem o "time incompleto"/sobras distribuídas): `lib/domain/pelada.js` (`planDraw`/`applyDraw`/`rotateFence`/`performDraw`), regras puras em `shared/pelada.js` (`planTeams`, `formTeams`, `drawNotes`).
  A Cerca é derivada (`freePids`): presentes que não estão em nenhum time. Configuração `autoDraw`/`autoEvery` (pelada e por data), `day.sinceDraw`, `m.rosters` (elenco de cada partida encerrada) e `m.stay` (vencedor que continua).
  Só o organizador sorteia (`POST .../draw` é `owner: true`), sempre ativo. Sair da pelada / excluir jogador: `POST .../leave`, `DELETE .../members/:pid` (`removeMember`; gols ficam). Login salvo: `/pelada/auth/resume` + `localStorage`.
  Link de convite com pré-visualização: `GET /pelada/page/:id` (`pelada-share.js`) + imagem `preview` montada em `ui/preview.js`. Bug do botão de perfil: `wireShell` agora é idempotente por container.
  Testes novos em `tests/unit/pelada-*.test.js` e cenários em `e2e/pelada.mjs` (25).

## Notificações no app — adicionado
- Sininho com contador, painel, página `/pelada/notificacoes` e configurações `/pelada/configuracoes` (por tipo, por pelada, aviso na tela).
- Feed de eventos por pelada (`plf:ID`) gravado em `act()` → `withPelada(..., { after })`; caixa montada na leitura (`lib/notifications.js`).
- Testes: `tests/unit/pelada-notifications.test.js` (10) e `e2e/pelada-notificacoes.mjs` (7 cenários); telas novas na auditoria `e2e/pelada-a11y.mjs`.
- Próximo passo possível: Web Push (avisar com o app fechado).

## Pendências / ideias
- Conectar o Upstash Redis na Vercel (ação do dono do projeto) — sem isso o deploy roda em modo demonstração.
- Validar o Mercado Pago com credenciais de teste antes de cobrar de verdade.
- Recuperação de senha por e-mail; armazenamento real dos PDFs; Open Graph dinâmico por torneio.

## Como rodar
- `npm run dev` → http://localhost:3000 (dados em `.data/arena.json`)
- `npm test` · `npm run lint` · `cd e2e && npm install && node run.mjs`

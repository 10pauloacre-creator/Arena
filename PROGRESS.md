# Progresso (arquivo de retomada)

Este arquivo existe para que uma sessão interrompida possa continuar de onde parou.

## Estado: funcional e testado
- Backend completo (`lib/`, `api/index.js`, `server.js`) + 187 testes unitários/API (`npm test`).
- Front-end completo: home com grade de torneios, login/cadastro, convite de administradores, painel do admin
  (Painel, Times, Ao vivo, Chaveamento, Marketing, Configurações) e página do visitante
  (início, jogos, chaveamento, times, inscrição com PIX/cartão, meu time + repescagem).
- E2E (`e2e/run.mjs`): 32 cenários passando · Pelada (`e2e/pelada.mjs`): 25 cenários.
- Criação de torneio em página própria (`/novo-torneio`): inscrição gratuita/valor, regras (checklist), detalhes e premiação
  (geral/masculino/feminino); tudo editável em Configurações. Catálogo de regras em `public/assets/js/shared/rules.js`,
  validação em `lib/domain/rules.js`, blocos de formulário em `public/assets/js/ui/tourneyform.js`.
- README com instruções (local, Vercel + Redis, pagamentos, segurança, limitações).

## App Pelada (PWA) — adicionado
- `/pelada/` (HTML próprio + manifesto + service worker + ícones). Backend em `lib/routes/peladas.js`, regras em `lib/domain/pelada.js`
  e `public/assets/js/shared/pelada.js`; telas em `public/assets/js/pelada/`; CSS em `public/assets/css/pelada.css`.
- Botão "Organize a pelada" na home do ArenaMaster (`/pelada/organizar`: sem conta → autenticação rápida; com conta → Dashboard).
- Testes: `tests/unit/pelada-*.test.js` (regras, API, domínio, PWA), `e2e/pelada.mjs` (19 cenários) e `e2e/pelada-a11y.mjs`.
- Tela de compartilhamento: arte exata do modelo do Canva (cópia limpa, sem os textos variáveis: `DAHXVxxikls`; original `DAHXVw36EII` intocado) em alta resolução + textos dinâmicos (período, nomes, gols) calibrados sobre o modelo. O rodapé "partidafacil.click" faz parte da arte (atualizada em 08/10/2026 a partir do design original: só o rodapé mudou; a cópia limpa `DAHXVxxikls` no Canva ainda mostra o rodapé antigo).
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

## Motor de sorteio v2 + Jarvis + push + pontos corridos — adicionado
- Motor em `lib/domain/pelada.js` (`fenceDraw`, `manualDraw`, `finishMatch`, `settleArrivals`, `fixTeams`/`inheritFixed`) e funções puras em `lib/domain/pelada-engine.js` (`dayStats`, `pairHistory`, `planGeneral`). Config: `autoDraw` (Cerca), `generalDraw`/`generalEvery`; dia: `lastLeaver`, `pending` (geral combinado), `fixed`. `autoEvery` foi removido.
- Contadores do dia (jogos por jogador) são calculados das partidas encerradas (`m.rosters` + empréstimos): corrigir uma partida corrige tudo.
- Jarvis: `lib/ai.js` (provedores por variável de ambiente), `lib/domain/pelada-jarvis.js`, `lib/domain/tournament-jarvis.js`. Push: `lib/push.js` (`pp:vapid`, `pp:users`, `pps:UID`), SW com `push`/`notificationclick`, `ui` em Configurações.
- Pontos corridos: `lib/domain/league.js`, `t.format` (`knockout`|`league`), `t.leagueMax`, `t.league`; telas `ui/league.js` e `pages/admin/league.js`.
- Testes: `pelada-domain` (motor), `pelada-push`, `pelada-jarvis`, `league`; simulação aleatória de dias usada na auditoria do motor (10 mil partidas, regras: toda a Cerca entra, ninguém duplicado, prioridade por jogos/gols, vez de quem descansou).

## Notificações no app — adicionado
- Sininho com contador, painel, página `/pelada/notificacoes` e configurações `/pelada/configuracoes` (por tipo, por pelada, aviso na tela).
- Feed de eventos por pelada (`plf:ID`) gravado em `act()` → `withPelada(..., { after })`; caixa montada na leitura (`lib/notifications.js`).
- Testes: `tests/unit/pelada-notifications.test.js` (10) e `e2e/pelada-notificacoes.mjs` (7 cenários); telas novas na auditoria `e2e/pelada-a11y.mjs`.
- Web Push (aviso com o app fechado) já está implementado (`lib/push.js`).

## Pendências / ideias
- Categoria de time (masculino/feminino) com chaves separadas: hoje a premiação por gênero é só informativa.
- Conectar o Upstash Redis na Vercel (ação do dono do projeto) — sem isso o deploy roda em modo demonstração.
- Validar o Mercado Pago com credenciais de teste antes de cobrar de verdade.
- Recuperação de senha por e-mail; armazenamento real dos PDFs; Open Graph dinâmico por torneio.

## Como rodar
- `npm run dev` → http://localhost:3000 (dados em `.data/arena.json`)
- `npm test` · `npm run lint` · `cd e2e && npm install && node run.mjs`

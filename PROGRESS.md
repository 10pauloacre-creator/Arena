# Progresso (arquivo de retomada)

Este arquivo existe para que uma sessão interrompida possa continuar de onde parou.

## Estado: funcional e testado
- Backend completo (`lib/`, `api/index.js`, `server.js`) + 93 testes unitários/API (`npm test`).
- Front-end completo: home com grade de torneios, login/cadastro, convite de administradores, painel do admin
  (Painel, Times, Ao vivo, Chaveamento, Marketing, Configurações) e página do visitante
  (início, jogos, chaveamento, times, inscrição com PIX/cartão, meu time + repescagem).
- E2E (`e2e/run.mjs`): 28 cenários passando · Pelada (`e2e/pelada.mjs`): 20 cenários.
- README com instruções (local, Vercel + Redis, pagamentos, segurança, limitações).

## App Pelada (PWA) — adicionado
- `/pelada/` (HTML próprio + manifesto + service worker + ícones). Backend em `lib/routes/peladas.js`, regras em `lib/domain/pelada.js`
  e `public/assets/js/shared/pelada.js`; telas em `public/assets/js/pelada/`; CSS em `public/assets/css/pelada.css`.
- Botão "Organize a pelada" na home do ArenaMaster (`/pelada/organizar`: sem conta → autenticação rápida; com conta → Dashboard).
- Testes: `tests/unit/pelada-*.test.js` (regras, API, domínio, PWA), `e2e/pelada.mjs` (19 cenários) e `e2e/pelada-a11y.mjs`.
- Tela de compartilhamento: arte exata do modelo do Canva (cópia limpa, sem os textos variáveis: `DAHXVxxikls`; original `DAHXVw36EII` intocado) em alta resolução + textos dinâmicos (período, nomes, gols) calibrados sobre o modelo. O rodapé "arenamaster.skin" faz parte da arte.
- Pelada demo: botão "Criar pelada demo" na criação (`POST /api/pelada/peladas/demo`) → jogo de hoje com 17 confirmados (nome de 2 palavras + avatar SVG gerado). Elenco em código (`lib/domain/pelada-demo.js`, IDs `pl_demoNN` resolvidos em `getPlayer` e na rota de imagem; nada vai para o banco). Testes: `tests/unit/pelada-demo.test.js`.
- Ao criar novos arquivos JS em `public/assets/js/pelada/`, inclua-os no `SHELL` de `public/pelada/sw.js` (há teste que confere).

## Modo offline — adicionado
- Os dois apps funcionam sem internet e sincronizam sozinhos (README, seção "Modo offline"). Código em `public/assets/js/offline/`,
  regras compartilhadas em `public/assets/js/shared/domain/` (o domínio saiu de `lib/` para rodar também no navegador), service workers
  `public/sw.js` e `public/pelada/sw.js` (núcleo em `offline/sw-core.js`; `npm run sw` atualiza as listas de arquivos).
- Servidor: ações em `shared/domain/pelada-actions.js` e `tournament-actions.js` (as rotas só as registram); `X-Op-Id` (idempotência no
  documento), `X-Op-At` (hora da ação), `X-Replica` (cópia do documento; no torneio só para administradores).
- Testes: `tests/unit/offline-*.test.js` (paridade aparelho × servidor, resposta perdida, conflitos, 401, SW) e `e2e/offline.mjs`.
- Ao criar um endpoint que mude pelada/torneio, prefira registrá-lo como *ação* compartilhada para ele funcionar offline também.

## Pendências / ideias
- Conectar o Upstash Redis na Vercel (ação do dono do projeto) — sem isso o deploy roda em modo demonstração.
- Validar o Mercado Pago com credenciais de teste antes de cobrar de verdade.
- Recuperação de senha por e-mail; armazenamento real dos PDFs; Open Graph dinâmico por torneio.

## Como rodar
- `npm run dev` → http://localhost:3000 (dados em `.data/arena.json`)
- `npm test` · `npm run lint` · `cd e2e && npm install && node run.mjs`

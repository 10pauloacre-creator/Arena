# Progresso (arquivo de retomada)

Este arquivo existe para que uma sessão interrompida possa continuar de onde parou.

## Estado: funcional e testado
- Backend completo (`lib/`, `api/index.js`, `server.js`) + 158 testes unitários/API (`npm test`).
- Front-end completo: home com grade de torneios, login/cadastro, convite de administradores, painel do admin
  (Painel, Times, Ao vivo, Chaveamento, Marketing, Configurações) e página do visitante
  (início, jogos, chaveamento, times, inscrição com PIX/cartão, meu time + repescagem).
- E2E (`e2e/run.mjs`): 32 cenários passando · Pelada (`e2e/pelada.mjs`): 20 cenários.
- Criação de torneio em página própria (`/novo-torneio`): inscrição gratuita/valor, regras (checklist), detalhes e premiação
  (geral/masculino/feminino); tudo editável em Configurações. Catálogo de regras em `public/assets/js/shared/rules.js`,
  validação em `lib/domain/rules.js`, blocos de formulário em `public/assets/js/ui/tourneyform.js`.
- README com instruções (local, Vercel + Redis, pagamentos, segurança, limitações).

## App Pelada (PWA) — adicionado
- `/pelada/` (HTML próprio + manifesto + service worker + ícones). Backend em `lib/routes/peladas.js`, regras em `lib/domain/pelada.js`
  e `public/assets/js/shared/pelada.js`; telas em `public/assets/js/pelada/`; CSS em `public/assets/css/pelada.css`.
- Botão "Organize a pelada" na home do ArenaMaster (`/pelada/organizar`: sem conta → autenticação rápida; com conta → Dashboard).
- Testes: `tests/unit/pelada-*.test.js` (regras, API, domínio, PWA), `e2e/pelada.mjs` (19 cenários) e `e2e/pelada-a11y.mjs`.
- Tela de compartilhamento: arte exata do modelo do Canva (cópia limpa, sem os textos variáveis: `DAHXVxxikls`; original `DAHXVw36EII` intocado) em alta resolução + textos dinâmicos (período, nomes, gols) calibrados sobre o modelo. O rodapé "arenamaster.skin" faz parte da arte.
- Pelada demo: botão "Criar pelada demo" na criação (`POST /api/pelada/peladas/demo`) → jogo de hoje com 17 confirmados (nome de 2 palavras + avatar SVG gerado). Elenco em código (`lib/domain/pelada-demo.js`, IDs `pl_demoNN` resolvidos em `getPlayer` e na rota de imagem; nada vai para o banco). Testes: `tests/unit/pelada-demo.test.js`.
- Ao criar novos arquivos JS em `public/assets/js/pelada/`, inclua-os no `SHELL` de `public/pelada/sw.js` (há teste que confere).

## Pendências / ideias
- Categoria de time (masculino/feminino) com chaves separadas: hoje a premiação por gênero é só informativa.
- Conectar o Upstash Redis na Vercel (ação do dono do projeto) — sem isso o deploy roda em modo demonstração.
- Validar o Mercado Pago com credenciais de teste antes de cobrar de verdade.
- Recuperação de senha por e-mail; armazenamento real dos PDFs; Open Graph dinâmico por torneio.

## Como rodar
- `npm run dev` → http://localhost:3000 (dados em `.data/arena.json`)
- `npm test` · `npm run lint` · `cd e2e && npm install && node run.mjs`

# Progresso (arquivo de retomada)

Este arquivo existe para que uma sessão interrompida possa continuar de onde parou.

## Pronto
- Backend completo (`lib/`, `api/index.js`, `server.js`) + 82 testes unitários/API (`npm test`).
- Front-end completo: design system, roteador, home com grade de torneios, login/cadastro, convite de administradores,
  painel do admin (Painel, Times, Ao vivo, Chaveamento, Marketing, Configurações) e página do visitante
  (início, jogos, chaveamento, times, inscrição com pagamento PIX/cartão, meu time + repescagem).
- E2E (`e2e/run.mjs`): 19 cenários passando (organizador, visitante, pagamento, jogos ao vivo, repescagem, mobile).

## Falta
- README final (como rodar, Vercel + Redis, Mercado Pago, limitações), revisão visual final, verificação do deploy na Vercel.
- Opcional: testes de acessibilidade/Lighthouse, mais QA em telas pequenas.

## Como rodar
- `npm run dev` → http://localhost:3000 (dados em `.data/arena.json`)
- `npm test` (unitários/API) · `cd e2e && npm install && node run.mjs` (E2E, precisa do Chromium)

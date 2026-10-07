# Progresso (arquivo de retomada)

Este arquivo existe para que uma sessão interrompida possa continuar de onde parou.

## Pronto
- Backend completo (`lib/`, `api/index.js`, `server.js`) + 79 testes (`npm test`).
- Front-end: design system (`public/assets/css`), roteador, home, login/cadastro, convite,
  painel admin: Painel, Times, Ao vivo, Chaveamento.

## Falta
- Admin: Marketing (flyer + QR) e Configurações (prazo, taxa, convites, exclusão).
- Página do visitante (`public/assets/js/pages/visitor/`): início, inscrição + pagamento, jogos, chaveamento, times, meu time/repescagem.
- Testes E2E (`e2e/`), revisão visual desktop/mobile, README final, verificação do deploy na Vercel.

## Como rodar
- `npm run dev` → http://localhost:3000 (dados em `.data/arena.json`)
- `npm test` (unitários/API) · `cd e2e && npm install && node run.mjs` (E2E)

# Progresso (arquivo de retomada)

Este arquivo existe para que uma sessão interrompida possa continuar de onde parou.

## Estado: funcional e testado
- Backend completo (`lib/`, `api/index.js`, `server.js`) + 93 testes unitários/API (`npm test`).
- Front-end completo: home com grade de torneios, login/cadastro, convite de administradores, painel do admin
  (Painel, Times, Ao vivo, Chaveamento, Marketing, Configurações) e página do visitante
  (início, jogos, chaveamento, times, inscrição com PIX/cartão, meu time + repescagem).
- E2E (`e2e/run.mjs`): 29 cenários passando.
- README com instruções (local, Vercel + Redis, pagamentos, segurança, limitações).

## Pendências / ideias
- Conectar o Upstash Redis na Vercel (ação do dono do projeto) — sem isso o deploy roda em modo demonstração.
- Validar o Mercado Pago com credenciais de teste antes de cobrar de verdade.
- Recuperação de senha por e-mail; armazenamento real dos PDFs; Open Graph dinâmico por torneio.

## Como rodar
- `npm run dev` → http://localhost:3000 (dados em `.data/arena.json`)
- `npm test` · `npm run lint` · `cd e2e && npm install && node run.mjs`

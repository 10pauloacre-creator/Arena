# Regras do projeto (leia antes de qualquer mudança)

## Endereço oficial do site

| App | URL oficial |
| --- | --- |
| **ArenaMaster** (torneios) | **https://partidafacil.click** |
| **Pelada** (PWA) | **https://partidafacil.click/pelada** |

Regras:

- Toda URL pública escrita no código, nos testes, na documentação, em textos de divulgação, em exemplos e em mensagens ao usuário
  deve usar `https://partidafacil.click` (ArenaMaster) e `https://partidafacil.click/pelada` (Pelada).
- Não usar `*.vercel.app` nem `localhost` como endereço "do site" em textos para o usuário. `localhost` só vale para rodar em desenvolvimento.
- Links gerados pelo servidor (convites, link do visitante, Open Graph, canonical, webhooks) devem sair desse domínio em produção.
  Em produção, defina na Vercel `PUBLIC_BASE_URL=https://partidafacil.click` (sem barra no final). Sem a variável, o servidor usa o host da requisição.
- Links dos jogos e peladas seguem o padrão: `https://partidafacil.click/t/AM-AAAA-NNNN` (torneio) e `https://partidafacil.click/pelada/p/PL-XXXXXX` (pelada).
- Se o domínio mudar, a única fonte da verdade a editar é este arquivo (e a variável `PUBLIC_BASE_URL`).

## Publicação

- O deploy de produção sai da branch `main` (Vercel). Mudanças validadas (lint, `npm test`, E2E) devem ser mescladas na `main` para ficarem publicadas.
- A Vercel precisa de banco conectado (Upstash Redis ou Supabase); sem ele o site roda em modo demonstração.

## Referências

- `README.md`: como rodar, testar e publicar. `PROGRESS.md`: estado atual e pendências.
- Testes: `npm test`, `npm run lint`, `cd e2e && node run.mjs` (ArenaMaster), `node pelada.mjs` (Pelada), `node a11y.mjs`.

# ArenaMaster AI

Plataforma de torneios com **painel do organizador** e **página do visitante**:
inscrição de times com pagamento (PIX ou cartão), sorteio de chaveamento, jogos ao vivo,
repescagem beneficente e divulgação (flyer + QR Code).

- **Organizador**: cria conta (e-mail + senha), cria torneios, edita e **salva** as configurações,
  convida outros administradores por **link de convite** e gerencia times, jogos e chaveamento.
- **Visitante** (sem login): entra pelo **link** ou digitando o **ID** do torneio (ex.: `AM-2026-9843`),
  inscreve o time até o **dia e horário limite**, paga (PIX/cartão) e, confirmado o pagamento, o time entra na lista.
  Também acompanha partidas ao vivo, resultados e o chaveamento.

> O protótipo original (HTML único) está em [`legacy/arenamaster-ai.html`](legacy/arenamaster-ai.html), só como referência.

---

## Rodando no seu computador (Windows, macOS ou Linux)

Requisitos: **Node.js 20+** (nenhuma dependência npm é necessária para rodar).

```powershell
# 1) Clonar o repositório na pasta do projeto (Windows)
git clone https://github.com/10pauloacre-creator/Arena C:\Projetos\Arena-Master
cd C:\Projetos\Arena-Master
git checkout claude/affectionate-allen-xaegks   # ou main, depois do merge do PR

# 2) Subir o servidor local
npm run dev        # abre em http://localhost:3000
```

Se a pasta `C:\Projetos\Arena-Master` já existe com um repositório git, basta vincular ao GitHub:

```powershell
cd C:\Projetos\Arena-Master
git remote add origin https://github.com/10pauloacre-creator/Arena   # (ou: git remote set-url origin ...)
git fetch origin
git checkout claude/affectionate-allen-xaegks
```

Os dados locais ficam em `.data/arena.json` (ignorado pelo git). Apague a pasta `.data` para recomeçar do zero.

### Testes

```powershell
npm test                         # 93 testes unitários e de API (node:test, sem dependências)
npm run lint                     # verifica imports não utilizados
cd e2e; node a11y.mjs            # auditoria de acessibilidade (axe-core) nas principais telas
cd e2e; npm install; node run.mjs   # 28 cenários E2E com Playwright (usa o Chromium instalado)
```

---

## Publicando na Vercel

O projeto já é compatível com a Vercel (arquivos estáticos em `public/` + uma função serverless em `api/index.js`).
Cada push na branch gera uma **pré-visualização**; o merge na `main` publica em produção.

### ⚠️ Passo obrigatório: conectar um banco (Redis)

A Vercel não guarda arquivos entre execuções. Sem banco, o app funciona em **modo demonstração**
(dados em `/tmp`, que podem sumir a qualquer momento — um aviso amarelo aparece no topo das telas).

Para usar de verdade (2 minutos):

1. No painel da Vercel → seu projeto → **Storage** → **Create Database** → **Upstash Redis** (plano gratuito basta).
2. Conecte ao projeto (marque Production **e** Preview). A integração cria sozinha as variáveis
   `KV_REST_API_URL` e `KV_REST_API_TOKEN` (também aceitamos `UPSTASH_REDIS_REST_URL/TOKEN`).
3. Faça um novo deploy (**Redeploy**). Pronto: contas, torneios e pagamentos passam a ser persistentes.

Opcional: defina `AUTH_SECRET` (qualquer texto longo e aleatório). Se não definir, um segredo aleatório é gerado e guardado no banco.

---

## Pagamentos (PIX e cartão)

| Modo | Como ativar | O que acontece |
| --- | --- | --- |
| **Teste** (padrão) | nada a fazer | Nenhum valor é cobrado. O PIX mostra um QR/copia-e-cola de teste e um botão **"Simular pagamento aprovado"**. Cartões de teste: `4242 4242 4242 4242` aprova · `4000 0000 0000 0002` recusa · `4000 0000 0000 9995` sem saldo. Dados de cartão **nunca** são guardados. |
| **Mercado Pago** | `PAYMENT_PROVIDER=mercadopago`, `MP_ACCESS_TOKEN`, (opcional, para cartão) `MP_PUBLIC_KEY`, e `PUBLIC_BASE_URL=https://seu-site.vercel.app` | PIX real (QR + copia-e-cola) e cartão tokenizado no navegador pelo SDK do Mercado Pago. Os pagamentos chegam por **webhook** (`/api/webhooks/mercadopago`) e a página do capitão também consulta o status. |

Como o time entra na lista: a inscrição **reserva a vaga por 30 minutos** (estendida ao iniciar o pagamento, máx. 60 min).
Quando o provedor confirma o pagamento, o time é confirmado automaticamente. Se o pagamento chegar sem vaga
(reserva vencida e vagas esgotadas), o painel avisa que há **reembolso pendente**.

> ⚠️ A integração com o Mercado Pago segue a documentação oficial e foi testada contra uma API simulada
> (`tests/unit/payments.test.js`, `webhook.test.js`). **Valide com as credenciais de TESTE do Mercado Pago
> antes de cobrar valores reais.**

---

## Como usar (resumo)

1. **Criar conta** → na home, **Novo torneio** (nome, modalidade, data da final). O ID (`AM-2026-XXXX`) é gerado.
2. No **Painel**, edite nome/data/modalidade e clique em **Salvar alterações**.
3. Em **Configurações**: prazo (data e hora), valor da inscrição, vagas (4/8/16/32), tipo (amador/oficial), repescagem e
   **convites de administrador** (link de uso único, válido por 7 dias).
4. Em **Times**, exporte a lista de times e de atletas em CSV (abre direto no Excel).
5. Compartilhe o **link do visitante** (aba Marketing tem flyer com QR Code e texto pronto para WhatsApp).
6. Quando as inscrições terminarem: **Chaveamento → Sortear**. O sorteio equilibra a força dos times, evita confrontos do
   mesmo bairro/clube na 1ª fase, dá *byes* quando o número de times não fecha a chave e registra uma semente auditável.
7. Em **Ao vivo**: placar, relógio, gols, cartões, pênaltis (empate), encerrar e avançar. Visitantes veem em tempo real.
8. **Repescagem beneficente**: time eliminado doa (PIX/cartão) e disputa uma revanche contra quem o eliminou.

Dica: marque **"Torneio de demonstração"** ao criar para ganhar 8 times de exemplo e testar tudo sem inscrições reais.

---

## Estrutura

```
api/index.js            função serverless da Vercel (todas as rotas /api/*)
lib/                    backend (sem dependências)
  router.js · handler.js · routes/*     API REST
  domain/*                              regras: torneio, times, chaveamento, ao vivo, pagamentos, visões
  payments/*                            provedores (modo teste e Mercado Pago)
  store/*                               armazenamento (arquivo local, Redis REST/Upstash/Vercel KV, memória)
public/                 front-end (HTML + ES modules + CSS, sem build)
  assets/js/pages/*                     telas: home, login, convite, admin/*, visitor/*
  assets/js/shared/*                    código compartilhado servidor/navegador (modalidades, validadores)
server.js               servidor de desenvolvimento local
tests/unit/*            testes unitários e de API
e2e/                    testes de ponta a ponta (Playwright)
legacy/                 protótipo original
```

## Segurança (resumo)

- Senhas com **scrypt**; sessão em cookie `HttpOnly` + `SameSite=Lax` assinado (HMAC); proteção CSRF (checagem de `Origin` e `Content-Type: application/json`).
- Limites de tentativas: login, cadastro, inscrições, pagamento e acesso por código do capitão.
- Visitantes **não recebem** dados pessoais (contato, CPF/RG, códigos). Dados de cartão nunca são armazenados.
- Todo texto de usuário é escapado no front-end; CSP restritiva (`vercel.json` e `server.js`).

## Limitações conhecidas / próximos passos

- **Recuperação de senha por e-mail** ainda não existe (exige provedor de e-mail, ex.: Resend).
- **Documentos em PDF** (torneio oficial): só nome/tamanho do arquivo são registrados; o arquivo não é armazenado (exigiria Vercel Blob/S3). CPF e RG são validados e exibidos ao organizador.
- **Biometria (FaceMatch)** do protótipo original não foi mantida: era uma simulação. O painel mostra "Atletas validados" e "Fraudes barradas" com base em dados reais (elencos válidos e CPFs duplicados entre times).
- O "sorteio inteligente" é um algoritmo de otimização (não usa modelo de IA); a semente garante auditoria.
- Atualização ao vivo por *polling* (3–6 s); pode evoluir para SSE/WebSocket.

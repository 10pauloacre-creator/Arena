# ArenaMaster AI

Plataforma de torneios com **painel do organizador** e **página do visitante**:
inscrição de times com pagamento (PIX ou cartão), sorteio de chaveamento, jogos ao vivo,
repescagem beneficente e divulgação (flyer + QR Code).

Inclui também o **app Pelada** (`/pelada/`): um segundo app, em HTML próprio e **instalável como PWA**, para organizar
peladas entre amigos (lista de presença, sorteio de times, súmula com cronômetro e artilharia). Veja [App Pelada](#app-pelada-pwa).

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
npm test                         # 187 testes unitários e de API (node:test, sem dependências)
npm run lint                     # verifica imports não utilizados
cd e2e; node a11y.mjs            # auditoria de acessibilidade (axe-core) nas principais telas
cd e2e; npm install; node run.mjs   # 32 cenários E2E do ArenaMaster com Playwright (usa o Chromium instalado)
cd e2e; node pelada.mjs          # 20 cenários E2E do app Pelada (conta, criação, pelada demo, sorteio, súmula, pódio, PWA offline)
cd e2e; node pelada-notificacoes.mjs  # 7 cenários E2E das notificações no app (sininho, painel, avisos, configurações)
cd e2e; node pelada-a11y.mjs     # auditoria de acessibilidade (axe-core) nas telas do app Pelada
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

**Já usa o Supabase na Vercel?** Também funciona, sem Redis:

1. No Supabase do projeto (Vercel → Storage → seu Supabase → *Open in Supabase*), abra **SQL Editor**, cole o conteúdo de
   [`supabase/arena_kv.sql`](supabase/arena_kv.sql) e clique em **Run** (cria a tabela `arena_kv`, só o servidor acessa).
2. Garanta que o projeto da Vercel tenha `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (a integração cria; aceitamos também
   `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SECRET_KEY`). Marque Production **e** Preview.
3. **Redeploy**. Se houver Redis e Supabase ao mesmo tempo, o Redis tem prioridade.

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

1. **Criar conta** → na home, **Novo torneio**. A página de criação reúne: nome, modalidade e data da final; **inscrição gratuita** (ou o valor por time); **regras** (checklist); **detalhes** e **premiação**. O ID (`AM-2026-XXXX`) é gerado.
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

### Inscrição gratuita, regras, detalhes e premiação

Tudo isso é definido na criação do torneio e pode ser alterado depois em **Configurações** (botão *Salvar alterações*).

- **Inscrição gratuita**: ativada, o time se inscreve sem pagar e já entra na lista. Desativada, é preciso informar o valor
  (mínimo R$ 5,00) e o time só entra depois de pagar por PIX ou cartão. Ao ativar a gratuidade em um torneio que já tinha
  reservas aguardando pagamento, quem ainda não iniciou nenhum pagamento é confirmado na hora.
- **Regras do torneio (checklist)**: o organizador marca o que vale.
  - *Conferidas pelo sistema* (barram a inscrição): quantidade mínima de jogadores, cada jogador com seu número de camisa
    (desligada, o número vira opcional) e emblema do time obrigatório.
  - *Aceite do capitão* (o capitão marca "li e aceito" no último passo; a data do aceite aparece para o organizador):
    uniforme padronizado, documento oficial com foto, idade mínima, chegar 15 minutos antes e capitão presente — além de
    até 8 regras livres escritas pelo organizador.
  - A inscrição manual feita pelo organizador respeita o mínimo de jogadores e o número da camisa, mas não exige emblema nem aceite.
  - Mudar uma regra vale para novas inscrições; times já inscritos não são afetados.
- **Detalhes**: texto livre (até 4.000 caracteres, com quebras de linha) para avisos e regras gerais, exibido na página do visitante.
- **Premiação**: colocações 1º, 2º, 3º… (até 10) em três categorias — *Geral*, *Masculino* e *Feminino* — cada uma com
  texto, valor em dinheiro ou os dois. O visitante vê tudo na aba Início e o texto de divulgação cita o prêmio do 1º lugar.

---

## App Pelada (PWA)

Abra **`/pelada/`** (na home do ArenaMaster, o botão destacado **"Organize a pelada"** leva para lá). É um app separado
(`public/pelada/index.html`, manifesto, ícones e service worker próprios, escopo `/pelada/`), então dá para **favoritar** ou
**instalar só o Pelada** na tela inicial (Chrome/Android: *Instalar app*; iPhone: *Compartilhar → Adicionar à Tela de Início*).
A interface é pré-carregada pelo service worker e abre sem internet; os dados sempre vêm da rede.

| Tela | Rota |
| --- | --- |
| Início / "Organize a pelada" (sem conta → autenticação rápida; com conta → Dashboard) | `/pelada/` · `/pelada/organizar` |
| Autenticação rápida · Dashboard · Criar/editar pelada | `/pelada/entrar` · `/pelada/painel` · `/pelada/nova` · `/pelada/p/ID/editar` |
| Página da pelada (jogos, histórico público, artilharia, jogadores) | `/pelada/p/PL-XXXXXX` (link de convite) |
| Dia de jogo (presença, sorteio, partidas, artilharia) | `/pelada/p/PL-XXXXXX/d/DIA` |

- **Conta ultra-rápida**: *Nome* (usuário) + *Data de nascimento* (senha inicial), foto opcional com recorte/zoom. **O login fica salvo no
  aparelho**: a sessão dura 1 ano (cookie, renovado a cada abertura do app), o perfil fica no `localStorage` e uma *chave do aparelho*
  (token assinado, `POST /api/pelada/auth/resume`) refaz a sessão se o navegador apagar o cookie — o jogador não precisa entrar de novo ao
  abrir o site ou o app. Sair da conta (perfil) apaga a chave. A senha pode ser trocada no perfil (isso encerra as outras sessões e invalida
  as chaves antigas). A data de nascimento é uma senha fraca por definição: há limite de tentativas por nome/IP e a data nunca é guardada
  (só o hash scrypt).
- **Pelada**: nome, foto, capa, categoria (feminino/masculino), mínimo por time, calendário de datas, **organização por data**
  (igual ao padrão ou personalizada), partidas por dia (adicionar/excluir) e a opção **"Sem formação de times"** (só presença e gols individuais).
  Cada pelada tem um ID (`PL-XXXXXX`) e um **link de convite que só o criador vê**. O link compartilhado tem **pré-visualização**
  (WhatsApp, Telegram…): o servidor entrega o `index.html` do app com as metatags Open Graph da pelada (`/pelada/p/ID` →
  `lib/domain/pelada-share.js`) — título, descrição com os dados (categoria, organizador, participantes, mínimo por time, próximo jogo) e a
  imagem: uma **prévia 1200×630 montada no navegador do organizador** com a capa, a foto de perfil e o nome (refeita ao editar a pelada;
  peladas antigas ganham a prévia quando o organizador as abre). Sem prévia: capa → foto de perfil → ícone do app.
  Na Vercel o rewrite `/pelada/p/:id` → `/api/index?__p=pelada/page/:id` e o `includeFiles` do `vercel.json` cuidam disso.
- **Sair da pelada / excluir jogador**: quem participa (menos o organizador) tem um ícone de sair no canto superior direito da página da
  pelada, com confirmação; a pelada some do painel dele e ele sai das listas de hoje em diante. O **organizador exclui jogadores** na aba
  *Jogadores*. Em ambos os casos **os gols já marcados continuam somando na artilharia** (dia e geral) e o histórico de datas passadas não muda.
- **Pelada demo**: na tela de criação, o botão **"Criar pelada demo"** monta o jogo de hoje com **17 jogadores já confirmados** (nome e
  sobrenome + foto de perfil), para ver a organização de um dia de jogo sem convidar ninguém: 17 ÷ 5 = 3 times, com as 2 sobras
  na **Cerca**. O elenco é sorteado a cada clique entre 40 jogadores fictícios e **não é gravado no banco** (ficam só dentro da pelada;
  as contas demo não têm senha nem reservam nomes). As fotos são avatares ilustrados gerados em código (`lib/domain/pelada-demo.js`),
  sem arquivos nem rede; ao mudar o desenho, suba `DEMO_ART_VERSION` (as imagens ficam 1 ano em cache). A pelada recebe o selo
  "Demonstração" e pode ser excluída normalmente (limite de 10 por hora por pessoa).
- **Presença**: qualquer jogador logado marca/retira a presença no dia; o nome e a foto aparecem na hora (o criador também marca).
- **Configuração do sorteio** (padrão da pelada e, se quiser, por data): *Sorteio automático de jogadores* (liga/desliga) e *de quantas em
  quantas partidas* sortear — **a cada 1, 2 ou 3 partidas, ou nunca** (`autoDraw` / `autoEvery`, `0` = nunca).
- **Sorteio** (botão "Sortear Times", animação de 5 s, **só o organizador**; os demais veem apenas o resultado): divide os confirmados em
  times **completos** de exatamente o mínimo por time (precisa de 2 times: 2 × mínimo presentes). **Quem sobra é a Cerca** (antes: "time
  incompleto"/jogadores distribuídos): fica aguardando a próxima partida e entra no time que perder. Quem chega depois do sorteio e os
  convidados também entram na Cerca (o organizador pode encaixá-los num time). Cada time é "Time 2 - Valéria" (capitão sorteado); clicar
  no nome mostra as jogadoras. A Cerca aparece na lista dos times e **no rodapé de toda partida que ainda não terminou**.
- **O sorteio fica sempre ativo**, inclusive com partida em andamento: é a parte *manual* do sorteio automático. Os times em quadra (e o
  vencedor que continua na próxima partida) se mantêm; os demais jogadores e a Cerca são sorteados para a próxima partida. Antes de
  qualquer partida começar, o sorteio simplesmente é refeito do zero.
- **Sorteio automático** (quando marcado): ao encerrar a partida de ordem N, N-ésima desde o último sorteio (1, 2 ou 3), **o time vencedor
  se mantém com seus jogadores** e o resto é sorteado de novo: o **time que perdeu é sorteado adicionando quem estava na Cerca**, e **quem
  estava jogando e foi substituído vira a nova Cerca** da próxima partida. Com o sorteio automático marcado, **quem está na Cerca entra
  obrigatoriamente na próxima partida** (tanto no automático quanto no manual). Com **mais de dois times**, a Cerca entra como um time
  formado e é completada com jogadores sorteados dos times que estão fora (o que perdeu e os que esperavam); o time completado ganha o
  número (o do time que perdeu) e o nome do capitão — sorteado entre os integrantes principais (quem veio da Cerca) —, e quem sobra do sorteio
  é a nova Cerca. Fora dos momentos de sorteio vale a fila clássica (quem ganha fica; o perdedor vai para o fim da fila; no empate sai
  quem está há mais partidas seguidas). O "Assistente do sorteio" e a lista "Últimas rotações da Cerca" explicam cada decisão.
- **Partidas e súmula**: botão "Adicionar partida", escolha dos dois times, cronômetro configurável, gols por jogador (lista de presentes,
  "jogador de fora" e "sem autor"). Ao encerrar (ou quando o tempo acaba), a **próxima partida é criada sozinha**. A partida encerrada
  guarda os elencos de quem jogou (os times mudam de jogadores nos sorteios). **Só o organizador pode corrigir uma partida encerrada**
  ("Editar placar e gols": soma/tira gols de cada jogador ou "sem autor"); o placar e a artilharia se ajustam sozinhos, mas a próxima
  partida já montada não é refeita.
- **Histórico e artilharia**: resultados públicos; pódio *do dia* e *geral* com medalhas ouro/prata/bronze (empates dividem a colocação);
  **Compartilhar Resultados** abre a tela de compartilhamento e copia para a área de transferência a imagem do **modelo exato do Canva**
  em alta resolução (2172×2896, `public/pelada/share/modelo-compartilhamento.webp`). O sistema só troca o que varia: o **período**
  (da primeira data da pelada até o dia da emissão; no "Do dia", a data do jogo), os **nomes**, os **gols** e as fotos nas molduras
  (sem foto, aparecem as iniciais). Também baixa o PNG, envia pelo menu do celular ou copia o texto para o WhatsApp.
  As fontes (Barlow Condensed e League Spartan, licença SIL OFL em `public/assets/fonts/OFL-LICENSE.txt`) ficam no próprio site.
  Para trocar a arte: exporte o modelo do Canva **sem** os textos variáveis (2×) e substitua o arquivo `.webp`; as posições dos
  textos estão em `public/assets/js/pelada/ui/share.js` (medidas do design de 1086×1448).

### Notificações no app

O **sininho** no topo mostra quantas novidades há; tocar nele abre as últimas e as marca como lidas
(**Ver todas** → `/pelada/notificacoes`). Com o app aberto, uma notificação nova também aparece como aviso rápido na tela,
e no app instalado o número aparece no ícone (onde o sistema suporta). Ninguém é avisado das próprias ações.

| Notificação | Quando | Padrão |
| --- | --- | --- |
| Novos participantes | alguém entra na pelada (link de convite, ID ou ao marcar presença pela 1ª vez) | ligada |
| Presenças no jogo do dia | alguém confirma presença, ou o organizador adiciona um convidado | ligada |
| Desistências | alguém retira a presença ou é tirado da lista | ligada |
| Sorteio de times | times sorteados ou refeitos, com **"você está no Time X"** | ligada |
| Início das partidas | uma partida começou | desligada |
| Resultados dos jogos | placar final, quem fez os gols e se o **seu time** venceu | ligada |
| Agenda de jogos | data nova, jogo remarcado ou cancelado | ligada |
| Lembrete no dia do jogo | no dia do jogo (diz se sua presença já está confirmada) | ligada |

Em **Configurações** (`/pelada/configuracoes`, também no menu da conta) cada pessoa liga/desliga cada tipo, desliga tudo,
desliga o aviso na tela e **silencia peladas específicas** (atalho no botão "Notificações ativadas" da página da pelada).
Para não virar spam: marcar e desmarcar presença em poucos minutos não gera aviso, um sorteio refeito logo em seguida substitui
o anterior e a correção de gols depois de encerrar atualiza o resultado já avisado. Quem entra numa pelada só vê o que
aconteceu depois de entrar.

Como funciona: cada pelada guarda os últimos 120 eventos (`plf:ID`, gravados junto da ação, com a pelada bloqueada); a caixa
de cada jogador é montada na leitura (`GET /api/pelada/notifications`, com ETag) a partir das peladas dele, aplicando as
preferências (`pnt:ID`). O app consulta a cada 20 s com a tela aberta. Regras e textos em
`public/assets/js/shared/notifications.js`; servidor em `lib/notifications.js`; telas em `public/assets/js/pelada/notify.js`,
`ui/notifications.js`, `pages/notifications.js` e `pages/settings.js`.
> Notificações com o app **fechado** (Web Push) ainda não existem: exigem chaves VAPID e o envio pelo servidor.

API em `lib/routes/peladas.js` (`/api/pelada/*`), regras em `lib/domain/pelada.js` e `public/assets/js/shared/pelada.js`
(compartilhadas com o navegador), tela em `public/assets/js/pelada/`. Como as contas e peladas ficam no mesmo armazenamento do
restante do projeto, **na Vercel é preciso conectar o Redis** (passo acima) para os dados não se perderem; sem isso o app mostra um aviso amarelo.

## Estrutura

```
api/index.js            função serverless da Vercel (todas as rotas /api/*)
lib/                    backend (sem dependências)
  router.js · handler.js · routes/*     API REST
  domain/*                              regras: torneio, times, chaveamento, ao vivo, pagamentos, visões
  payments/*                            provedores (modo teste e Mercado Pago)
  store/*                               armazenamento (arquivo local, Redis REST/Upstash/Vercel KV, memória)
public/pelada/          app Pelada instalável (index.html, manifest, service worker, ícones)
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

- A premiação masculina/feminina é só informativa: o torneio tem **um único chaveamento**. Não há ainda times com categoria
  (masculino/feminino) nem chaves separadas por categoria.

- **Recuperação de senha por e-mail** ainda não existe (exige provedor de e-mail, ex.: Resend).
- **Documentos em PDF** (torneio oficial): só nome/tamanho do arquivo são registrados; o arquivo não é armazenado (exigiria Vercel Blob/S3). CPF e RG são validados e exibidos ao organizador.
- **Biometria (FaceMatch)** do protótipo original não foi mantida: era uma simulação. O painel mostra "Atletas validados" e "Fraudes barradas" com base em dados reais (elencos válidos e CPFs duplicados entre times).
- O "sorteio inteligente" é um algoritmo de otimização (não usa modelo de IA); a semente garante auditoria.
- Atualização ao vivo por *polling* (3–6 s); pode evoluir para SSE/WebSocket.

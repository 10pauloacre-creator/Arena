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
npm test                         # 177 testes unitários e de API (node:test, sem dependências)
npm run lint                     # verifica imports não utilizados
cd e2e; node a11y.mjs            # auditoria de acessibilidade (axe-core) nas principais telas
cd e2e; npm install; node run.mjs   # 28 cenários E2E do ArenaMaster com Playwright (usa o Chromium instalado)
cd e2e; node pelada.mjs          # 19 cenários E2E do app Pelada (conta, criação, sorteio, súmula, pódio, PWA offline)
cd e2e; node offline.mjs         # 7 cenários E2E do modo offline (internet cortada no navegador: Pelada, painel do organizador, visitante)
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

## App Pelada (PWA)

Abra **`/pelada/`** (na home do ArenaMaster, o botão destacado **"Organize a pelada"** leva para lá). É um app separado
(`public/pelada/index.html`, manifesto, ícones e service worker próprios, escopo `/pelada/`), então dá para **favoritar** ou
**instalar só o Pelada** na tela inicial (Chrome/Android: *Instalar app*; iPhone: *Compartilhar → Adicionar à Tela de Início*).
A interface é pré-carregada pelo service worker e **o app inteiro funciona sem internet** (veja [Modo offline](#modo-offline-funciona-sem-internet-e-sincroniza-sozinho)).

| Tela | Rota |
| --- | --- |
| Início / "Organize a pelada" (sem conta → autenticação rápida; com conta → Dashboard) | `/pelada/` · `/pelada/organizar` |
| Autenticação rápida · Dashboard · Criar/editar pelada | `/pelada/entrar` · `/pelada/painel` · `/pelada/nova` · `/pelada/p/ID/editar` |
| Página da pelada (jogos, histórico público, artilharia, jogadores) | `/pelada/p/PL-XXXXXX` (link de convite) |
| Dia de jogo (presença, sorteio, partidas, artilharia) | `/pelada/p/PL-XXXXXX/d/DIA` |

- **Conta ultra-rápida**: *Nome* (usuário) + *Data de nascimento* (senha inicial), foto opcional com recorte/zoom. A sessão dura 1 ano
  (cookie) e o perfil fica salvo no aparelho. A senha pode ser trocada no perfil (isso encerra as outras sessões). A data de nascimento é
  uma senha fraca por definição: há limite de tentativas por nome/IP e a data nunca é guardada (só o hash scrypt).
- **Pelada**: nome, foto, capa, categoria (feminino/masculino), mínimo por time, calendário de datas, **organização por data**
  (igual ao padrão ou personalizada), partidas por dia (adicionar/excluir) e a opção **"Sem formação de times"** (só presença e gols individuais).
  Cada pelada tem um ID (`PL-XXXXXX`) e um **link de convite que só o criador vê**.
- **Presença**: qualquer jogador logado marca/retira a presença no dia; o nome e a foto aparecem na hora (o criador também marca).
- **Sorteio** (botão "Sortear Times", animação de 5 s): divide os confirmados pelo mínimo por time. Sobra de **3 ou mais** → o último time
  fica incompleto e pode pegar jogadores de fora; sobra de **1 ou 2** → o time incompleto é desfeito e os jogadores são distribuídos nos
  outros times (ex.: 6 jogadores). Cada time é "Time 2 - Valéria" (capitão sorteado); clicar no nome mostra as jogadoras. O criador pode
  adicionar **convidados** (entram no sorteio, ou depois: inteiram um time ou ficam avulsos). Refazer o sorteio só até começar uma partida.
  O primeiro sorteio do dia pode ser feito por qualquer confirmado; refazer é só do criador.
- **Partidas e súmula**: botão "Adicionar partida", escolha dos dois times, cronômetro configurável, gols por jogador (lista de presentes,
  "jogador de fora" e "sem autor"). Ao encerrar (ou quando o tempo acaba), a **próxima partida é criada sozinha**: quem ganha fica, o perdedor
  vai para o fim da fila; no empate sai quem está há mais partidas seguidas na quadra.
- **Histórico e artilharia**: resultados públicos; pódio *do dia* e *geral* com medalhas ouro/prata/bronze (empates dividem a colocação);
  **Compartilhar Resultados** abre a tela de compartilhamento e copia para a área de transferência a imagem do **modelo exato do Canva**
  em alta resolução (2172×2896, `public/pelada/share/modelo-compartilhamento.webp`). O sistema só troca o que varia: o **período**
  (da primeira data da pelada até o dia da emissão; no "Do dia", a data do jogo), os **nomes**, os **gols** e as fotos nas molduras
  (sem foto, aparecem as iniciais). Também baixa o PNG, envia pelo menu do celular ou copia o texto para o WhatsApp.
  As fontes (Barlow Condensed e League Spartan, licença SIL OFL em `public/assets/fonts/OFL-LICENSE.txt`) ficam no próprio site.
  Para trocar a arte: exporte o modelo do Canva **sem** os textos variáveis (2×) e substitua o arquivo `.webp`; as posições dos
  textos estão em `public/assets/js/pelada/ui/share.js` (medidas do design de 1086×1448).

API em `lib/routes/peladas.js` (`/api/pelada/*`), regras em `lib/domain/pelada.js` e `public/assets/js/shared/pelada.js`
(compartilhadas com o navegador), tela em `public/assets/js/pelada/`. Como as contas e peladas ficam no mesmo armazenamento do
restante do projeto, **na Vercel é preciso conectar o Redis** (passo acima) para os dados não se perderem; sem isso o app mostra um aviso amarelo.

## Modo offline (funciona sem internet e sincroniza sozinho)

Os dois apps (ArenaMaster e Pelada) continuam funcionando quando a internet cai. O que a pessoa faz **fica guardado no aparelho**
e, quando a conexão volta, é **enviado sozinho, em ordem, sem duplicar nada**. Um selo no canto da tela mostra o estado
(*Sem internet*, *N alterações guardadas*, *Sincronizando…*, *Tudo sincronizado*); tocando nele abre o painel **Sincronização**
com a lista do que está esperando e do que o servidor recusou.

| Parte do sistema | Sem internet |
| --- | --- |
| **Abrir os apps** (telas, fontes, ícones) | ✅ O service worker (`/sw.js` no ArenaMaster, `/pelada/sw.js` no Pelada) guarda toda a interface. Se a internet estiver só *lenta*, após 4 s usa a cópia guardada. |
| **Pelada — dia de jogo** (presença, convidados, sorteio, escolher times, cronômetro, gols, jogador de fora, encerrar partida e criar a próxima, gols do dia, mover jogador) | ✅ Funciona por completo, com as **mesmas regras do servidor**. |
| **Pelada — gestão** (editar nome/regras, datas, entrar na pelada) | ✅ Funciona (trocar *foto* ou *capa* exige internet). |
| **ArenaMaster — organizador** (placar ao vivo, lances, relógio, encerrar/reabrir partida, cadastrar/editar/confirmar/remover times, sorteio, configurações, transmissão) | ✅ Funciona por completo. Cadastrar time **com emblema** exige internet. |
| **ArenaMaster — visitante** (ver torneio, jogos, chaveamento, times) | ✅ Mostra a última cópia vista. A **inscrição gratuita** feita sem internet é guardada e enviada sozinha quando a conexão volta (o código do capitão aparece na hora do envio). |
| **Pagamento (PIX/cartão), inscrição com taxa, repescagem** | ❌ Precisa de internet (o servidor reserva a vaga e fala com o provedor). O formulário não se perde. |
| **Criar conta / entrar / sair / trocar senha, criar ou excluir pelada/torneio, convites, reembolso** | ❌ Precisam de internet. Quem já está logado continua logado (o perfil fica no aparelho). |

**Como funciona (resumo técnico)**

- `public/assets/js/offline/` — `engine.js` (fila, envio, "rebase"), `storage.js` (IndexedDB, com reserva em localStorage/memória),
  `plugins/*` (um por tipo de documento), `ui.js` (selo e painel), `sw-core.js` (núcleo dos service workers).
- **Leitura**: cada resposta do servidor é guardada no aparelho (separada por usuário). Para pelada e torneio o servidor também
  envia, quando o aparelho pede (`X-Replica`), **uma cópia do documento**; é ela que permite prever o resultado das ações.
- **Escrita**: com internet, a chamada segue como sempre. Sem internet, a ação é aplicada na cópia local pelo **mesmo código do servidor**
  (`public/assets/js/shared/domain/*-actions.js`) e entra na fila (IndexedDB). A tela atualiza na hora, como se tivesse salvo.
- **Envio**: ao voltar a internet (evento `online`, volta ao app, ou novas tentativas a cada 3–30 s), a fila é enviada em ordem.
  Cada operação leva um **id** (`X-Op-Id`) e a **hora em que foi feita** (`X-Op-At`: o cronômetro e os horários ficam certos mesmo se o envio
  atrasar). O documento guarda os últimos ids aplicados, então **reenviar a mesma operação nunca duplica um gol ou um lance** (ex.: a internet
  caiu justo depois de o servidor gravar). Ids e sorteios são **determinísticos por operação**, então o que o aparelho previu é exatamente
  o que o servidor grava (há testes de paridade).
- **Conflitos**: o servidor sempre tem a palavra final. Mudanças de outras pessoas feitas enquanto o aparelho estava offline se juntam às
  dele. Se o servidor recusar uma operação (ex.: a partida foi excluída em outro aparelho), ela vai para a lista *"Não foi possível enviar"*
  do painel Sincronização, com o motivo, e as demais seguem.
- **Sessão expirada**: a fila fica guardada e espera a pessoa entrar de novo. **Sair da conta** com itens não enviados pede confirmação
  (e exige internet, pois o servidor encerra a sessão).
- **Limites**: no iPhone/Safari o navegador pode apagar dados de sites que ficam muito tempo sem uso; instalar o app na tela inicial evita isso.
  Se o navegador não permitir armazenamento durável, o painel avisa.
- Depois de adicionar/renomear arquivos JS do front-end, rode `npm run sw` para atualizar as listas de arquivos dos service workers
  (há teste que confere).

## Estrutura

```
api/index.js            função serverless da Vercel (todas as rotas /api/*)
lib/                    backend (sem dependências)
  router.js · handler.js · routes/*     API REST (as ações de pelada/torneio vêm de shared/domain/*-actions.js)
  payments/*                            provedores (modo teste e Mercado Pago)
  store/*                               armazenamento (arquivo local, Redis REST/Upstash/Vercel KV, Supabase, memória)
public/pelada/          app Pelada instalável (index.html, manifest, service worker, ícones)
public/sw.js            service worker do ArenaMaster (escopo /)
public/                 front-end (HTML + ES modules + CSS, sem build)
  assets/js/pages/*                     telas: home, login, convite, admin/*, visitor/*
  assets/js/offline/*                   modo offline: motor, armazenamento, plugins, selo de sincronização, núcleo dos service workers
  assets/js/shared/*                    código compartilhado servidor/navegador (modalidades, validadores, rand/route/errors)
  assets/js/shared/domain/*             regras: torneio, times, chaveamento, ao vivo, pagamentos, visões, pelada e suas "ações"
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
- Modo offline: criar conta/pelada/torneio, pagamento e foto/emblema ainda exigem internet (veja [Modo offline](#modo-offline-funciona-sem-internet-e-sincroniza-sozinho)).
  Quando duas pessoas alteram o *mesmo* dado enquanto uma está offline, vale a regra do servidor ao sincronizar (sem fusão campo a campo).

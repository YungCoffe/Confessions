# Bot de Confissões

Bot de confissões anônimas em Node.js (discord.js v14), feito para servidores enormes
(250k+ membros): só comandos slash, cache no mínimo, banco rápido e aprovação pela Gestão.

## Como funciona

1. Um Administrador roda `/configurar-confissoes`. O bot **cria os canais, define quem vê cada
   um** e posta o painel de envio.
2. Qualquer membro clica em **Enviar Confissão** (ou usa `/confissao`) e escreve o texto.
3. O bot gera um **código de rastreio** (ex.: `4K7P2M`) e manda para `analise-confissoes`
   apenas o texto e o código — **o autor não aparece no Discord**.
4. O vínculo `código → autor` fica **somente no banco**. A Gestão+ identifica o autor com
   `/autor-confissao codigo` (a consulta é registrada em `logs-confissoes`, sem revelar o autor).
5. Quem tem o cargo **Gestão ou acima** (ou Administrador) clica em **Aprovar** ou **Recusar**.
6. Aprovada → publica anônima em `confissoes`, com o código no rodapé. O autor acompanha
   o status com `/minhas-confissoes`.

## Primeiros passos

1. **Convide o bot** com este link (troque `SEU_CLIENT_ID`):

   ```
   https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&scope=bot%20applications.commands&permissions=268520464
   ```

   Permissões: Ver Canais, Enviar Mensagens, Inserir Links, Ver Histórico de Mensagens e,
   só para configurar os canais, **Gerenciar Canais** e **Gerenciar Cargos**.
2. Rode **`/configurar-confissoes`** e escolha o cargo na opção `cargo-gestao`
   (se o cargo já se chama "Gestão", a opção pode ficar vazia).
3. Pronto. O resumo mostra os canais criados, quem vê cada um e os cargos com acesso.

## Quem vê o quê

| Canal | Quem vê | Quem escreve |
| --- | --- | --- |
| `enviar-confissao` (painel) | Todos, ou só o `cargo-membros` (+ Gestão+) | Ninguém: só o botão envia |
| `analise-confissoes` (Aprovar/Recusar) | **Só Gestão e acima** | Só o bot |
| `logs-confissoes` (decisões e consultas) | **Só Gestão e acima** | Só o bot |
| `confissoes` (aprovadas) | Todos, ou só o `cargo-membros` (+ Gestão+) | Só o bot |

- **Gestão e acima** = o cargo escolhido e todos os cargos acima dele na hierarquia
  (cargos de bots/integrações ficam de fora, para não vazar confissões a outros bots).
  Administradores veem tudo, como sempre.
- Os canais privados são criados **já privados** (as permissões vão junto com a criação).
- Criou um cargo novo acima da Gestão? Rode `/configurar-confissoes` de novo para ele ver os canais.
- Rodar de novo **não duplica nada**: reaproveita os canais, reaplica as permissões e atualiza o
  painel existente. Isso redefine ajustes manuais de permissão feitos nesses 4 canais.
- Sem a opção `cargo-membros`, o comando **mantém** a restrição anterior (nunca abre o acesso sem
  você pedir). Para voltar a liberar para todos, escolha `@everyone` nessa opção.
- Prefere usar canais que já existem? Informe `canal-painel`, `canal-analise`, `canal-publico`
  e/ou `canal-logs`. Eles recebem as mesmas permissões (os privados ficam privados).

## Comandos

| Comando | Quem usa | Para que serve |
| --- | --- | --- |
| `/configurar-confissoes` | Administrador | Cria/configura canais e permissões e posta o painel |
| `/setup-confissao` | Administrador | Reenvia o painel no canal atual |
| `/confissao` | Todos | Abre o formulário de confissão |
| `/minhas-confissoes` | Todos | Mostra códigos e status (só você vê) |
| `/autor-confissao` | Gestão ou acima | Identifica o autor de um código (fica registrado) |

## Configuração (.env)

Copie `.env.example` para `.env`. Só `DISCORD_TOKEN` e `CLIENT_ID` são obrigatórios; canais e
cargo são definidos pelo comando `/configurar-confissoes`.

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Token do bot (obrigatório) |
| `CLIENT_ID` | — | Application ID (obrigatório) |
| `GUILD_ID` | — | ID do servidor; registra os comandos na hora |
| `GESTAO_ROLE_ID` | — | Reserva do cargo Gestão (útil em host sem disco persistente) |
| `GESTAO_ROLE` | `gestão` | Nome do cargo, se não houver ID salvo |
| `ANALISE_CHANNEL_ID` / `PUBLIC_CHANNEL_ID` / `LOGS_CHANNEL_ID` | — | Reserva dos canais |
| `AUTO_DEPLOY` | `true` | `false` desativa o registro automático dos comandos |
| `COOLDOWN_CONFISSAO` | `120` | Segundos entre duas confissões do mesmo usuário |
| `LIMITE_DIARIO` | `10` | Máximo de confissões por usuário em 24h |
| `DATA_DIR` | `./data` | Pasta do banco |
| `DB_MAX_REGISTROS` | `20000` | Acima disso, apaga as mais antigas já decididas |

Prioridade para achar canais e cargo: **configuração do comando → variável do .env → nome padrão**
(`analise-confissoes`, `confissoes`, `logs-confissoes`, `enviar-confissao`, cargo `gestão`).

## Otimizado para 250k membros

- **Só o intent `Guilds`**: sem intents privilegiados, sem receber mensagens nem eventos de membros.
- **Cache mínimo**: mensagens, presenças, reações e threads nem entram na memória; membros e
  usuários ficam limitados aos 100 mais recentes (cargos e canais, que são poucos, ficam em cache).
- **Banco append-only**: cada mudança é uma linha anexada ao arquivo (microssegundos), com índice
  por usuário e contadores em memória. Nada de regravar o arquivo inteiro a cada confissão.
  Compacta sozinho e migra o arquivo da v1.4 automaticamente.
- **Anti-spam**: cooldown e limite diário por usuário, reservados antes de qualquer espera
  (envios simultâneos não furam o limite); o cooldown em memória é limpo periodicamente.
- **Sem ping**: nenhuma confissão consegue marcar `@everyone`, cargo ou usuário.
- **Sem registro fantasma**: se o envio ao canal de análise falhar, a confissão é desfeita.
- Sharding só é exigido a partir de 2.500 servidores; um servidor de 250k roda em 1 shard.

## Rodar localmente

```bash
npm install
npm start
```

Os slash commands são registrados automaticamente quando o bot conecta
(também dá para forçar com `npm run deploy`).

## Deploy no Render

O bot já sobe um servidor HTTP na porta `PORT` para o Web Service ficar de pé e para servir os links de monitoramento (veja a seção seguinte).

1. Suba a pasta para um repositório no GitHub (o `.zip` já vem sem `node_modules`).
2. No Render: **New → Web Service** e conecte o repositório.
3. Preencha:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Em **Environment**, adicione `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` (e as demais que quiser).
   Não suba o `.env` para o Git.
5. **Create Web Service**. Nos logs deve aparecer `[BOT] Conectado como ...` e
   `[DEPLOY] Slash commands registrados neste servidor.`
6. No Discord, rode `/configurar-confissoes`.

### Importante: dados e plano free

O Web Service free do Render **não tem disco persistente**: a pasta `data/` (confissões e
configuração salva) é apagada a cada deploy/reinício, e o serviço **dorme após ~15 min sem
requisições** (quando dorme, o bot cai do Discord). Para uso sério:

- **Plano com disco**: adicione um Disk montado em `/var/data` e defina `DATA_DIR=/var/data`.
- **Sempre ativo**: plano pago, ou um monitor externo (UptimeRobot) batendo na URL a cada
  5–10 min para o serviço não dormir.
- **Sem disco**: o resumo do `/configurar-confissoes` mostra `GESTAO_ROLE_ID` e os IDs dos canais;
  cole em **Environment** para o bot continuar achando tudo depois de reiniciar. As **permissões
  dos canais ficam no Discord**, então não se perdem. O histórico de confissões, porém, é perdido.

## Link de monitoramento (keep-alive)

Depois do deploy, seu endereço base é `https://SEU-SERVICO.onrender.com`. Endpoints disponíveis:

| Link | Resposta | Para que serve |
| --- | --- | --- |
| `https://SEU-SERVICO.onrender.com/ping` | `pong` (texto, 200) | Colar no monitor de uptime — é o mais leve |
| `https://SEU-SERVICO.onrender.com/health` | JSON (online, ping, servidores, confissões) | Consumir via `fetch` no seu site |
| `https://SEU-SERVICO.onrender.com/` | Página de status que se atualiza sozinha | Abrir no navegador ou em um `iframe` |

No UptimeRobot: **Add New Monitor → HTTP(s)** → URL `https://SEU-SERVICO.onrender.com/ping`,
intervalo de **5 minutos**. Isso impede o plano free de dormir (ele desliga após ~15 min parado).
O endpoint sempre responde `200` e informa `online: false` enquanto o bot ainda está conectando,
para não gerar alarme falso no restart.

## Arquivos

- `index.js` — bot: interações, análise, aprovação/recusa, logs, cliente enxuto.
- `configurar.js` — `/configurar-confissoes`: cria canais, aplica permissões, posta o painel.
- `permissoes.js` — regra "Gestão ou acima" e lista de cargos com acesso.
- `ui.js` — painel e formulário.
- `db.js` — banco append-only com códigos de rastreio e configuração por servidor.
- `servidor.js` — HTTP: `/ping`, `/health` e página de status.
- `commands.js` — definição dos slash commands (fonte única).
- `deploy-commands.js` — registro manual dos comandos (`npm run deploy`).

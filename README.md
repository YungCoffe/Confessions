# Bot de Confissões

Bot de confissões anônimas em Node.js (discord.js v14), feito para servidores enormes
(250k+ membros): só comandos slash, cache no mínimo, banco rápido e aprovação pela Gestão.

## Como funciona

1. Um Administrador roda `/configurar-confissoes` e **escolhe**: o canal do painel, o canal de
   análise, o canal das confissões aprovadas e o **cargo Gestão**. O bot não cria nem adivinha nada.
2. O bot posta o painel e deixa a análise visível **só para a Gestão e todos os cargos acima dela**.
3. Qualquer membro clica em **Enviar Confissão** (ou usa `/confissao`) e escreve o texto.
4. O bot gera um **código de rastreio** (ex.: `4K7P2M`) e manda para o canal de análise apenas
   o texto e o código — **o autor não aparece no Discord**.
5. Quem é **Gestão ou acima** (ou Administrador) clica em **Aprovar** ou **Recusar**.
6. O autor recebe **aviso no PV**:
   - aprovada: `✅ Sua confissão foi aprovada em #canal!` (com link da publicação);
   - recusada: `❌ Sua confissão foi recusada pela Gestão.`

   Se o PV do autor estiver fechado, a decisão vale do mesmo jeito e o canal de logs (se houver)
   registra o aviso, sem revelar quem é. O autor também pode usar `/minhas-confissoes`.
7. O vínculo `código → autor` fica **somente no banco**. A Gestão+ identifica o autor com
   `/autor-confissao codigo` (a consulta é registrada no canal de logs, sem revelar o autor).

## Primeiros passos

1. **Convide o bot** com este link (troque `SEU_CLIENT_ID`):

   ```
   https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&scope=bot%20applications.commands&permissions=268520448
   ```

   Permissões: Ver Canais, Enviar Mensagens, Inserir Links, Ver Histórico de Mensagens e
   **Gerenciar Cargos** (usado só para deixar a análise privada).
2. O bot precisa conseguir **ver e escrever** nos canais do painel e das aprovadas. Nos canais de
   análise e logs ele recebe o acesso sozinho.
3. Rode **`/configurar-confissoes`** e preencha:

   | Opção | Obrigatória | O que é |
   | --- | --- | --- |
   | `canal-painel` | Sim | Onde o painel com o botão será postado |
   | `canal-analise` | Sim | Onde as confissões chegam para Aprovar/Recusar |
   | `canal-aprovadas` | Sim | Onde as aprovadas são publicadas |
   | `cargo-gestao` | Sim | Cargo Gestão: ele e todos acima veem a análise e decidem |
   | `canal-logs` | Não | Registro privado de decisões e consultas de autor |

4. O resumo mostra tudo o que foi configurado e os cargos que têm acesso.

## Quem vê o quê

- **Análise e logs** (`canal-analise`, `canal-logs`): só **Gestão e acima**. O bot aplica isso
  sozinho e **substitui as permissões desses canais** (é o que garante que ninguém mais veja).
- **Painel e aprovadas** (`canal-painel`, `canal-aprovadas`): o bot **não mexe** nas permissões.
  Você decide quem vê e quem escreve (o normal é todos verem e ninguém escrever, só o bot).
- **Gestão e acima** = o cargo escolhido e todos os cargos acima dele na hierarquia. Vale para ver
  a análise e para aprovar/recusar/consultar autor. Cargos de bots/integrações ficam de fora.
  Administradores veem tudo, como sempre.
- Criou um cargo novo acima da Gestão? Rode `/configurar-confissoes` de novo para ele ver a análise.
- Rodar de novo não duplica nada: reaplica as permissões e atualiza o painel existente. Sem
  `canal-logs`, mantém o canal de logs anterior.

## Comandos

| Comando | Quem usa | Para que serve |
| --- | --- | --- |
| `/configurar-confissoes` | Administrador | Escolhe canais e cargo Gestão, posta o painel |
| `/setup-confissao` | Administrador | Reenvia o painel no canal atual |
| `/confissao` | Todos | Abre o formulário de confissão |
| `/minhas-confissoes` | Todos | Mostra códigos e status (só você vê) |
| `/autor-confissao` | Gestão ou acima | Identifica o autor de um código (fica registrado) |

## Configuração (.env)

Copie `.env.example` para `.env`. Só `DISCORD_TOKEN` e `CLIENT_ID` são obrigatórios; canais e
cargo são escolhidos no Discord com `/configurar-confissoes`.

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Token do bot (obrigatório) |
| `CLIENT_ID` | — | Application ID (obrigatório) |
| `GUILD_ID` | — | ID do servidor; registra os comandos na hora |
| `GESTAO_ROLE_ID` | — | Reserva do cargo Gestão (útil em host sem disco persistente) |
| `ANALISE_CHANNEL_ID` / `PUBLIC_CHANNEL_ID` / `LOGS_CHANNEL_ID` | — | Reserva dos canais |
| `GESTAO_ROLE` | `gestão` | Último recurso: procura o cargo por este nome |
| `AUTO_DEPLOY` | `true` | `false` desativa o registro automático dos comandos |
| `COOLDOWN_CONFISSAO` | `120` | Segundos entre duas confissões do mesmo usuário |
| `LIMITE_DIARIO` | `10` | Máximo de confissões por usuário em 24h |
| `DATA_DIR` | `./data` | Pasta do banco |
| `DB_MAX_REGISTROS` | `20000` | Acima disso, apaga as mais antigas já decididas |

Prioridade para achar canais e cargo: **configuração salva pelo comando → variável do .env**.
Os canais nunca são procurados pelo nome.

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
- **Aviso no PV** sem travar a Gestão: a decisão é salva antes, e PV fechado não atrapalha nada.
- Sharding só é exigido a partir de 2.500 servidores; um servidor de 250k roda em 1 shard.

## Problemas comuns

Quando algo falha, o bot responde com o motivo (Gestão+ vê também o detalhe técnico) e o log
(`[ERRO] Falha na interação (...)`) mostra qual comando ou botão causou.

| Mensagem | O que fazer |
| --- | --- |
| "Não consegui publicar em #canal..." | O bot precisa de **Ver Canal, Enviar Mensagens e Inserir Links** no canal de aprovadas |
| "O bot não tem permissão para fazer isso neste canal" | Confira as permissões do bot no canal em questão |
| "O bot não está como membro deste servidor" | Convide o bot de novo pelo link do README (precisa do escopo **bot**, não só `applications.commands`) e confira o `GUILD_ID` |
| "O sistema ainda não foi configurado" | Um administrador precisa rodar `/configurar-confissoes` |
| "Confissão ... não encontrada no banco" | O banco foi apagado (host sem disco): use `DATA_DIR` com disco persistente |

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
6. No Discord, rode `/configurar-confissoes` e escolha canais e cargo.

### Importante: dados e plano free

O Web Service free do Render **não tem disco persistente**: a pasta `data/` (confissões e
configuração salva) é apagada a cada deploy/reinício, e o serviço **dorme após ~15 min sem
requisições** (quando dorme, o bot cai do Discord). Para uso sério:

- **Plano com disco**: adicione um Disk montado em `/var/data` e defina `DATA_DIR=/var/data`.
- **Sempre ativo**: plano pago, ou um monitor externo (UptimeRobot) batendo na URL a cada
  5–10 min para o serviço não dormir.
- **Sem disco**: o resumo do `/configurar-confissoes` mostra `GESTAO_ROLE_ID` e os IDs dos canais;
  cole em **Environment** para o bot continuar achando tudo depois de reiniciar (sem isso, ele pede
  para rodar o comando de novo). As **permissões dos canais ficam no Discord**, então não se
  perdem. O histórico de confissões, porém, é perdido.

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
- `configurar.js` — `/configurar-confissoes`: valida a escolha, deixa a análise privada para Gestão+, posta o painel.
- `permissoes.js` — regra "Gestão ou acima" e lista de cargos com acesso.
- `ui.js` — painel e formulário.
- `db.js` — banco append-only com códigos de rastreio e configuração por servidor.
- `servidor.js` — HTTP: `/ping`, `/health` e página de status.
- `commands.js` — definição dos slash commands (fonte única).
- `deploy-commands.js` — registro manual dos comandos (`npm run deploy`).

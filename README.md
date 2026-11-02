# Bot de Confissões

Bot de confissões anônimas em Node.js (discord.js v14), feito para servidores grandes
(250k+ membros): só comandos slash, cache no mínimo, aprovação pela Gestão.

## Como funciona

1. Um Administrador roda `/setup-confissao` no canal onde o painel deve ficar.
2. Qualquer membro clica em **Enviar Confissão** (ou usa `/confissao`) e escreve o texto.
3. O bot gera um **código de rastreio** (ex.: `4K7P2M`) e manda para `analise-confissoes`
   apenas o texto e o código — **o autor não aparece no Discord**.
4. O vínculo `código → autor` fica **somente no banco** (`data/confissoes.json`).
   A Gestão+ pode identificar o autor com `/autor-confissao codigo` (consulta fica em log).
5. Quem tem o cargo **Gestão ou acima** (ou Administrador) clica em **Aprovar** ou **Recusar**.
6. Aprovada → publica anônima em `confissoes`, com o código no rodapé. O autor acompanha
   o status com `/minhas-confissoes`.

## Comandos

| Comando | Quem usa | Para que serve |
| --- | --- | --- |
| `/setup-confissao` | Administrador | Envia o painel de confissões no canal |
| `/confissao` | Todos | Abre o formulário de confissão |
| `/minhas-confissoes` | Todos | Mostra códigos e status (só você vê) |
| `/autor-confissao` | Gestão ou acima | Identifica o autor de um código |

## Configuração (.env)

Copie `.env.example` para `.env` e preencha:

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Token do bot (obrigatório) |
| `CLIENT_ID` | — | Application ID (obrigatório) |
| `GUILD_ID` | — | ID do servidor; registra os comandos na hora |
| `GESTAO_ROLE` | `gestão` | Nome do cargo de referência |
| `ANALISE_CHANNEL_ID` | — | ID do canal de análise (senão busca por nome) |
| `PUBLIC_CHANNEL_ID` | — | ID do canal público (senão busca por nome) |
| `AUTO_DEPLOY` | `true` | `false` desativa o registro automático dos comandos |
| `COOLDOWN_CONFISSAO` | `120` | Segundos entre duas confissões do mesmo usuário |
| `LIMITE_DIARIO` | `10` | Máximo de confissões por usuário em 24h |
| `DATA_DIR` | `./data` | Pasta do banco JSON |
| `DB_MAX_REGISTROS` | `20000` | Acima disso, apaga as mais antigas já decididas |

Canais esperados (por nome): `analise-confissoes` (privado) e `confissoes` (público).

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

### Importante: dados e plano free

O Web Service free do Render **não tem disco persistente**: o arquivo `data/confissoes.json`
é apagado a cada deploy/reinício, e o serviço **dorme após ~15 min sem requisições**
(quando dorme, o bot cai do Discord). Para uso sério:

- **Plano com disco**: adicione um Disk montado em `/var/data` e defina `DATA_DIR=/var/data`.
- **Sempre ativo**: plano pago, ou um monitor externo (UptimeRobot) batendo na URL a cada
  5–10 min para o serviço não dormir.

## Link de monitoramento (keep-alive)

Depois do deploy, seu endereço base é `https://SEU-SERVICO.onrender.com`. Endpoints disponíveis:

| Link | Resposta | Para que serve |
| --- | --- | --- |
| `https://SEU-SERVICO.onrender.com/ping` | `pong` (texto, 200) | Colar no monitor de uptime — é o mais leve |
| `https://SEU-SERVICO.onrender.com/health` | JSON (online, ping, servidores, confissões) | Consumir via `fetch` no seu site |
| `https://SEU-SERVICO.onrender.com/` | Página de status que se atualiza sozinha | Abrir no navegador ou em um `iframe` |

Como usar no seu site:

```html
<iframe src="https://SEU-SERVICO.onrender.com/" width="340" height="300" style="border:0"></iframe>

<script>
  setInterval(() => {
    fetch('https://SEU-SERVICO.onrender.com/ping', { cache: 'no-store' })
      .then(r => r.text())
      .then(t => console.log('bot:', t));
  }, 5 * 60 * 1000); // a cada 5 minutos
</script>
```

No UptimeRobot: **Add New Monitor → HTTP(s)** → URL `https://SEU-SERVICO.onrender.com/ping`,
intervalo de **5 minutos**. Isso impede o plano free de dormir (ele desliga após ~15 min parado).
O endpoint sempre responde `200` e informa `online: false` enquanto o bot ainda está conectando,
para não gerar alarme falso no restart.

## Requisitos no servidor

- Bot com escopos `applications.commands` + `bot` e permissões: Ver Canais, Enviar
  Mensagens, Inserir Links/Embeds, Ler Histórico, Gerenciar Mensagens.
- O canal `analise-confissoes` deve ser privado — é onde as confissões aparecem para análise.

## Arquivos

- `index.js` — bot: painel, modal, análise, aprovação/recusa.
- `servidor.js` — HTTP: `/ping`, `/health` e página de status.
- `db.js` — banco JSON com códigos de rastreio (gravação atômica + debounce).
- `permissoes.js` — regra "Gestão ou acima".
- `commands.js` — definição dos slash commands (fonte única).
- `deploy-commands.js` — registro manual dos comandos (`npm run deploy`).

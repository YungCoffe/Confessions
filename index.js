const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
  REST,
  Routes
} = require('discord.js');
require('dotenv').config();
const { iniciarServidor } = require('./servidor');
const commands = require('./commands');
const db = require('./db');
const { podeAprovar } = require('./permissoes');

if (!process.env.DISCORD_TOKEN) {
  console.error('ERRO: variável DISCORD_TOKEN não definida no .env');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Cliente otimizado para servidores grandes (250k membros)
// - Só o intent Guilds: o bot não lê mensagens, então não faz cache delas.
//   Isso dispensa partials e sweepers e reduz muito RAM e tráfego de gateway.
// ---------------------------------------------------------------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Nenhuma confissão consegue disparar ping (@everyone, @cargo, @usuário)
const MENTIONS_NULAS = { parse: [] };

// Evita que duas pessoas tratem a mesma confissão ao mesmo tempo
const emAndamento = new Set();

// Cooldown em memória: custo zero e reinício limpo não é problema
const ultimoEnvio = new Map();

const NOME_CANAL_ANALISE = 'analise-confissoes';
const NOME_CANAL_PUBLICO = 'confissoes';
const COOLDOWN_SEGUNDOS = Math.max(
  0,
  Number.parseInt(process.env.COOLDOWN_CONFISSAO ?? '120', 10) || 0
);
const LIMITE_DIARIO = Math.max(0, Number.parseInt(process.env.LIMITE_DIARIO ?? '10', 10) || 0);

const EMOJI_STATUS = { pendente: '⏳', aprovada: '✅', recusada: '❌' };
const EPHEMERAL = MessageFlags.Ephemeral;

// ---------------------------------------------------------------------------
// Servidor HTTP: mantém o Web Service vivo e entrega os links de monitoramento
// (o Render injeta a porta em PORT; a URL fica https://SEU-SERVICO.onrender.com)
// ---------------------------------------------------------------------------
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const INICIADO_EM = Date.now();

function statusAtual() {
  return {
    status: client.isReady() ? 'ok' : 'iniciando',
    online: client.isReady(),
    bot: client.user ? client.user.tag : null,
    pingMs: client.ws ? Math.round(client.ws.ping) : -1,
    servidores: client.guilds.cache.size,
    confissoes: db.estatisticas(),
    uptimeSegundos: Math.floor((Date.now() - INICIADO_EM) / 1000)
  };
}

iniciarServidor({ porta: PORT, status: statusAtual });

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function resolverCanal(guild, idOpcional, nomePadrao) {
  if (idOpcional) {
    const canal = guild.channels.cache.get(idOpcional);
    if (canal && canal.isTextBased()) return canal;
  }
  return guild.channels.cache.find(c => c.name === nomePadrao && c.isTextBased()) || null;
}

async function obterMember(interaction) {
  if (interaction.member && interaction.member.roles && interaction.member.roles.cache) {
    return interaction.member;
  }
  // Fallback raro: membro não veio resolvido no payload da interação
  return await interaction.guild.members.fetch(interaction.user.id);
}

function citarCodigo(codigo) {
  return `\`${codigo}\``;
}

function checarLimites(userId) {
  const agora = Date.now();

  if (COOLDOWN_SEGUNDOS > 0) {
    const anterior = ultimoEnvio.get(userId) || 0;
    const esperar = COOLDOWN_SEGUNDOS * 1000 - (agora - anterior);
    if (esperar > 0) {
      return `Calma! Espere mais **${Math.ceil(esperar / 1000)}s** para enviar outra confissão.`;
    }
  }

  if (LIMITE_DIARIO > 0) {
    const enviadas = db.contarDoUsuarioDesde(userId, agora - 24 * 60 * 60 * 1000);
    if (enviadas >= LIMITE_DIARIO) {
      return `Você atingiu o limite de **${LIMITE_DIARIO} confissões** em 24h. Tente mais tarde.`;
    }
  }

  return null;
}

function painelConfissoes() {
  const embed = new EmbedBuilder()
    .setTitle('🔒 Painel de Confissões')
    .setDescription(
      'Clique no botão abaixo (ou use `/confissao`) para enviar uma confissão de forma anônima.\n' +
      'Ela será analisada pela **Gestão e por cargos acima** antes de ser publicada.\n\n' +
      'Você recebe um **código de rastreio** para consultar o status com `/minhas-confissoes`.'
    )
    .setColor('#5865F2');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('abrir_modal_confissao')
      .setLabel('Enviar Confissão')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📝')
  );

  return { embeds: [embed], components: [row] };
}

function modalConfissao() {
  const inputTexto = new TextInputBuilder()
    .setCustomId('texto_confissao')
    .setLabel('Sua Confissão (até 2000 caracteres)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Escreva aqui...')
    .setRequired(true)
    .setMaxLength(2000);

  return new ModalBuilder()
    .setCustomId('modal_confissao')
    .setTitle('Escreva sua Confissão')
    .addComponents(new ActionRowBuilder().addComponents(inputTexto));
}

// ---------------------------------------------------------------------------
// Interações (apenas slash + botões/modal — nenhum comando de texto)
// ---------------------------------------------------------------------------
client.on('interactionCreate', async interaction => {
  if (!interaction.inGuild()) return;

  try {
    // 1. /setup-confissao — cria o painel
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup-confissao') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
          content: 'Você precisa ser Administrador para usar este comando.',
          flags: EPHEMERAL
        });
      }

      await interaction.deferReply({ flags: EPHEMERAL });
      await interaction.channel.send(painelConfissoes());
      return await interaction.editReply({ content: 'Painel de confissões criado com sucesso!' });
    }

    // 2. /confissao — abre o modal direto pelo slash
    if (interaction.isChatInputCommand() && interaction.commandName === 'confissao') {
      return await interaction.showModal(modalConfissao());
    }

    // 3. /minhas-confissoes — o autor acompanha seus códigos e status
    if (interaction.isChatInputCommand() && interaction.commandName === 'minhas-confissoes') {
      const registros = db.listarDoUsuario(interaction.user.id, 10);

      if (!registros.length) {
        return await interaction.reply({
          content: 'Você ainda não enviou nenhuma confissão. Use `/confissao`.',
          flags: EPHEMERAL
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('📨 Suas Confissões')
        .setColor('#5865F2')
        .setDescription(
          registros
            .map(
              r =>
                `${EMOJI_STATUS[r.status] || '❔'} ${citarCodigo(r.codigo)} — **${r.status}** • <t:${Math.floor(
                  r.criadoEm / 1000
                )}:R>`
            )
            .join('\n')
        )
        .setFooter({ text: 'Esta mensagem é visível apenas para você.' });

      return await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    }

    // 4. /autor-confissao — Gestão+ descobre o autor pelo código de rastreio
    if (interaction.isChatInputCommand() && interaction.commandName === 'autor-confissao') {
      const member = await obterMember(interaction);
      if (!podeAprovar(member, interaction.guild)) {
        return await interaction.reply({
          content: 'Apenas a **Gestão, cargos acima dela** (ou Administradores) podem consultar autores.',
          flags: EPHEMERAL
        });
      }

      const codigo = interaction.options.getString('codigo', true);
      const registro = db.buscar(codigo);
      if (!registro) {
        return await interaction.reply({
          content: `Nenhuma confissão encontrada com o código ${citarCodigo(codigo)}.`,
          flags: EPHEMERAL
        });
      }

      console.log(
        `[AUDITORIA] ${interaction.user.tag} (${interaction.user.id}) consultou o autor da confissão ${registro.codigo}`
      );

      const embed = new EmbedBuilder()
        .setTitle(`🔎 Confissão ${registro.codigo}`)
        .setColor('#EB459E')
        .addFields(
          { name: 'Autor', value: `${registro.autorTag}\n\`${registro.userId}\``, inline: true },
          {
            name: 'Status',
            value: `${EMOJI_STATUS[registro.status] || '❔'} ${registro.status}`,
            inline: true
          },
          { name: 'Enviada', value: `<t:${Math.floor(registro.criadoEm / 1000)}:f>`, inline: true }
        )
        .setFooter({ text: `Consulta registrada em log — por ${interaction.user.tag}` });

      if (registro.decididoPor) {
        embed.addFields({
          name: 'Decidido por',
          value: `${registro.decididoPor} • <t:${Math.floor(registro.decididoEm / 1000)}:R>`
        });
      }

      return await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    }

    // 5. Botão do painel — abre o modal
    if (interaction.isButton() && interaction.customId === 'abrir_modal_confissao') {
      return await interaction.showModal(modalConfissao());
    }

    // 6. Modal enviado — cria o registro e encaminha para o canal de análise
    if (interaction.isModalSubmit() && interaction.customId === 'modal_confissao') {
      await interaction.deferReply({ flags: EPHEMERAL });

      const texto = interaction.fields.getTextInputValue('texto_confissao').trim();
      if (!texto) {
        return await interaction.editReply({ content: 'A confissão não pode ficar vazia.' });
      }

      const bloqueio = checarLimites(interaction.user.id);
      if (bloqueio) {
        return await interaction.editReply({ content: bloqueio });
      }

      const canalAnalise = resolverCanal(
        interaction.guild,
        process.env.ANALISE_CHANNEL_ID,
        NOME_CANAL_ANALISE
      );

      if (!canalAnalise) {
        return await interaction.editReply({
          content:
            'Erro: crie um canal de texto chamado `analise-confissoes` (ou defina ANALISE_CHANNEL_ID no .env).'
        });
      }

      const registro = db.criarConfissao({
        userId: interaction.user.id,
        autorTag: interaction.user.tag,
        guildId: interaction.guild.id,
        texto
      });

      // A descrição comporta 4096 caracteres (o campo "value" de embed só aguenta 1024).
      // O autor NÃO aparece aqui: só o código de rastreio, que remete ao banco.
      const embedAnalise = new EmbedBuilder()
        .setTitle('📩 Nova Confissão para Análise')
        .setDescription(texto)
        .setColor('#FEE75C')
        .setTimestamp()
        .addFields(
          { name: 'Código de rastreio', value: citarCodigo(registro.codigo), inline: true },
          {
            name: 'Enviada em',
            value: `<t:${Math.floor(registro.criadoEm / 1000)}:f>`,
            inline: true
          }
        )
        .setFooter({ text: 'Autor oculto — use /autor-confissao com o código para identificar' });

      const rowAprovacao = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`aprovar_${registro.codigo}`)
          .setLabel('Aprovar')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`recusar_${registro.codigo}`)
          .setLabel('Recusar')
          .setStyle(ButtonStyle.Danger)
      );

      try {
        await canalAnalise.send({
          embeds: [embedAnalise],
          components: [rowAprovacao],
          allowedMentions: MENTIONS_NULAS
        });
      } catch (erro) {
        console.error('[ERRO] Falha ao enviar para o canal de análise:', erro);
        return await interaction.editReply({
          content: 'Erro ao enviar sua confissão para análise. Tente novamente mais tarde.'
        });
      }

      ultimoEnvio.set(interaction.user.id, Date.now());

      return await interaction.editReply({
        content:
          `Sua confissão foi enviada para análise. Guarde o código ${citarCodigo(registro.codigo)} ` +
          'e acompanhe com `/minhas-confissoes`.'
      });
    }

    // 7. Botões de aprovar/recusar — Gestão e cargos acima
    if (
      interaction.isButton() &&
      (interaction.customId.startsWith('aprovar_') || interaction.customId.startsWith('recusar_'))
    ) {
      const aprovando = interaction.customId.startsWith('aprovar_');
      const codigo = interaction.customId
        .slice((aprovando ? 'aprovar_' : 'recusar_').length)
        .trim()
        .toUpperCase();

      const member = await obterMember(interaction);
      if (!podeAprovar(member, interaction.guild)) {
        return await interaction.reply({
          content:
            'Apenas a **Gestão, cargos acima dela** (ou Administradores) podem aprovar ou recusar.',
          flags: EPHEMERAL
        });
      }

      const registro = db.buscar(codigo);
      if (!registro) {
        return await interaction.reply({
          content: `Confissão ${citarCodigo(codigo)} não encontrada no banco.`,
          flags: EPHEMERAL
        });
      }

      if (registro.status !== 'pendente') {
        return await interaction.reply({
          content: `A confissão ${citarCodigo(codigo)} já foi **${registro.status}**.`,
          flags: EPHEMERAL
        });
      }

      if (emAndamento.has(codigo)) {
        return await interaction.reply({
          content: 'Alguém já está processando esta confissão.',
          flags: EPHEMERAL
        });
      }

      emAndamento.add(codigo);
      try {
        await interaction.deferUpdate();

        const embedOriginal = interaction.message.embeds[0];

        if (aprovando) {
          const canalPublico = resolverCanal(
            interaction.guild,
            process.env.PUBLIC_CHANNEL_ID,
            NOME_CANAL_PUBLICO
          );

          if (!canalPublico) {
            return await interaction.followUp({
              content:
                'Erro: canal público `confissoes` não encontrado (ou defina PUBLIC_CHANNEL_ID no .env).',
              flags: EPHEMERAL
            });
          }

          const embedPublico = new EmbedBuilder()
            .setTitle('🗣️ Confissão Anônima')
            .setDescription(registro.texto)
            .setColor('#57F287')
            .setTimestamp()
            .setFooter({ text: `Código ${registro.codigo}` });

          await canalPublico.send({
            embeds: [embedPublico],
            allowedMentions: MENTIONS_NULAS
          });

          db.atualizar(codigo, {
            status: 'aprovada',
            decididoEm: Date.now(),
            decididoPor: interaction.user.tag,
            decididoPorId: interaction.user.id
          });

          const embedAtualizado = EmbedBuilder.from(embedOriginal)
            .setTitle('✅ Confissão Aprovada')
            .setColor('#57F287')
            .addFields({ name: 'Aprovada por', value: `${interaction.user.tag}` });

          await interaction.message.edit({ embeds: [embedAtualizado], components: [] });
        } else {
          db.atualizar(codigo, {
            status: 'recusada',
            decididoEm: Date.now(),
            decididoPor: interaction.user.tag,
            decididoPorId: interaction.user.id
          });

          const embedAtualizado = EmbedBuilder.from(embedOriginal)
            .setTitle('❌ Confissão Recusada')
            .setColor('#ED4245')
            .addFields({ name: 'Recusada por', value: `${interaction.user.tag}` });

          await interaction.message.edit({ embeds: [embedAtualizado], components: [] });
        }
      } finally {
        emAndamento.delete(codigo);
      }
    }
  } catch (error) {
    console.error('[ERRO] Falha na interação:', error);
    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Ocorreu um erro ao processar. Tente novamente.',
          flags: EPHEMERAL
        });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.followUp({
          content: 'Ocorreu um erro ao processar. Tente novamente.',
          flags: EPHEMERAL
        });
      }
    } catch (_) {
      // interação já expirou; nada a fazer
    }
  }
});

// Registro automático dos slash commands ao iniciar — no Render não há shell,
// então isso dispensa rodar `npm run deploy` manualmente. AUTO_DEPLOY=false desativa.
client.once('clientReady', async () => {
  console.log(`[BOT] Conectado como ${client.user.tag}`);

  const stats = db.estatisticas();
  console.log(
    `[DB] ${stats.total} confissões — ${stats.pendente} pendentes, ${stats.aprovada} aprovadas, ${stats.recusada} recusadas`
  );

  if (process.env.AUTO_DEPLOY === 'false') return;

  const clientId = process.env.CLIENT_ID;
  if (!clientId) {
    return console.warn('[DEPLOY] CLIENT_ID ausente: comandos não registrados.');
  }

  const rota = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(clientId, process.env.GUILD_ID)
    : Routes.applicationCommands(clientId);

  try {
    await new REST({ version: '10' })
      .setToken(process.env.DISCORD_TOKEN)
      .put(rota, { body: commands });
    console.log(
      process.env.GUILD_ID
        ? '[DEPLOY] Slash commands registrados neste servidor.'
        : '[DEPLOY] Slash commands globais registrados.'
    );
  } catch (error) {
    // Falha aqui não impede o bot de rodar; os comandos antigos continuam valendo
    console.error('[DEPLOY] Falha ao registrar comandos:', error);
  }
});

client.on('error', error => console.error('[ERRO] Client:', error));
process.on('unhandledRejection', error => console.error('[ERRO] unhandledRejection:', error));

client.login(process.env.DISCORD_TOKEN);

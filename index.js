const {
  Client,
  GatewayIntentBits,
  Options,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
  REST,
  Routes
} = require('discord.js');
require('dotenv').config(); // precisa vir antes de db/permissoes/configurar (eles leem o .env ao carregar)
const { iniciarServidor } = require('./servidor');
const commands = require('./commands');
const db = require('./db');
const { podeAprovar } = require('./permissoes');
const { painelConfissoes, modalConfissao, EMOJI_STATUS } = require('./ui');
const { configurarCanais, resolverCanal } = require('./configurar');

if (!process.env.DISCORD_TOKEN) {
  console.error('ERRO: variável DISCORD_TOKEN não definida no .env');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Cliente otimizado para servidores enormes (250k+ membros)
// - Só o intent Guilds: o bot não lê mensagens nem membros, então o Discord não
//   envia esse tráfego todo (nada de intents privilegiados).
// - Cache no limite mínimo: mensagens, presenças, reações, threads etc. nem entram.
//   Cargos e canais (poucos) ficam em cache; membros/usuários só os últimos 100,
//   senão cada pessoa que clica num botão ficaria na RAM para sempre.
// - Nenhuma menção dispara ping por padrão.
// ---------------------------------------------------------------------------
const soOMeuBot = item => item.id === item.client.user?.id;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  allowedMentions: { parse: [], repliedUser: false },
  makeCache: Options.cacheWithLimits({
    MessageManager: 0,
    PresenceManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    VoiceStateManager: 0,
    StageInstanceManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    GuildScheduledEventManager: 0,
    GuildInviteManager: 0,
    GuildBanManager: 0,
    GuildStickerManager: 0,
    GuildEmojiManager: 0,
    AutoModerationRuleManager: 0,
    GuildMemberManager: { maxSize: 100, keepOverLimit: soOMeuBot },
    UserManager: { maxSize: 100, keepOverLimit: soOMeuBot }
  })
});

// Nenhuma confissão consegue disparar ping (@everyone, @cargo, @usuário)
const MENTIONS_NULAS = { parse: [] };

// Evita que duas pessoas tratem a mesma confissão ao mesmo tempo
const emAndamento = new Set();

// Cooldown em memória: custo zero; reinício limpo não é problema
const ultimoEnvio = new Map();

const COOLDOWN_SEGUNDOS = Math.max(
  0,
  Number.parseInt(process.env.COOLDOWN_CONFISSAO ?? '120', 10) || 0
);
const LIMITE_DIARIO = Math.max(0, Number.parseInt(process.env.LIMITE_DIARIO ?? '10', 10) || 0);
const EPHEMERAL = MessageFlags.Ephemeral;

// Sem isso o Map cresceria com cada pessoa que já enviou algo
setInterval(() => {
  const limite = Date.now() - COOLDOWN_SEGUNDOS * 1000;
  for (const [userId, quando] of ultimoEnvio) {
    if (quando < limite) ultimoEnvio.delete(userId);
  }
}, 10 * 60 * 1000).unref();

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

const servidorHttp = iniciarServidor({ porta: PORT, status: statusAtual });

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
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

// Registro de decisões e consultas de autor (canal privado da Gestão+). Nunca derruba o fluxo.
async function registrarLog(guild, conteudo) {
  try {
    const canal = resolverCanal(guild, 'logs');
    if (!canal) return;
    await canal.send({ content: conteudo, allowedMentions: MENTIONS_NULAS });
  } catch (erro) {
    console.error('[LOG] Não consegui escrever no canal de logs:', erro.message);
  }
}

// Avisa o autor no PV. Se o PV estiver fechado, a decisão continua valendo e a Gestão é avisada no log
// (o aviso do log traz só o código, nunca o autor).
async function avisarAutor({ guild, registro, aprovada, canalPublico, mensagemPublica }) {
  const codigo = citarCodigo(registro.codigo);
  let conteudo;
  if (aprovada) {
    conteudo = `✅ Sua confissão foi aprovada em <#${canalPublico.id}>!\nCódigo: ${codigo}`;
    if (mensagemPublica && mensagemPublica.url) conteudo += ` • [ver publicação](${mensagemPublica.url})`;
  } else {
    conteudo = `❌ Sua confissão foi recusada pela Gestão.\nCódigo: ${codigo}`;
  }

  try {
    await client.users.send(registro.userId, { content: conteudo, allowedMentions: MENTIONS_NULAS });
  } catch (erro) {
    console.warn(`[PV] Não consegui avisar o autor da confissão ${registro.codigo}: ${erro.message}`);
    await registrarLog(
      guild,
      `⚠️ Não consegui avisar o autor da confissão ${codigo} no PV (mensagens diretas fechadas?).`
    );
  }
}

const AVISO_SEM_CANAL =
  'O sistema ainda não foi configurado. Peça a um administrador para usar `/configurar-confissoes`.';

// Traduz erros da API do Discord para algo que dê para agir. Quem é Gestão+ vê também o detalhe técnico.
const DICAS_API = {
  50013: 'O bot não tem permissão para fazer isso neste canal.',
  50001: 'O bot não enxerga um dos canais necessários.',
  10003: 'Um dos canais configurados não existe mais (foi apagado?).',
  10008: 'A mensagem não existe mais.',
  10062: 'A interação expirou. Tente de novo.'
};

function mensagemDeErro(error, interaction) {
  const base = DICAS_API[error && error.code] || 'Ocorreu um erro ao processar. Tente novamente.';
  try {
    if (podeAprovar(interaction)) {
      const detalhe = String((error && error.message) || error).slice(0, 200);
      return `${base}\n-# Detalhe (só Gestão+): ${detalhe}${error && error.code ? ` [código ${error.code}]` : ''}`;
    }
  } catch (_) {
    // sem detalhe técnico
  }
  return base;
}

// ---------------------------------------------------------------------------
// Interações (apenas slash + botões/modal — nenhum comando de texto)
// ---------------------------------------------------------------------------
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.inGuild()) return;

  try {
    // 1. /configurar-confissoes — cria canais e define quem vê cada um
    if (interaction.isChatInputCommand() && interaction.commandName === 'configurar-confissoes') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
          content: 'Você precisa ser Administrador para usar este comando.',
          flags: EPHEMERAL
        });
      }
      return await configurarCanais(interaction);
    }

    // 2. /setup-confissao — envia o painel no canal atual
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup-confissao') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
          content: 'Você precisa ser Administrador para usar este comando.',
          flags: EPHEMERAL
        });
      }

      await interaction.deferReply({ flags: EPHEMERAL });
      try {
        await interaction.channel.send(painelConfissoes());
      } catch (erro) {
        console.error('[ERRO] Não consegui enviar o painel:', erro);
        return await interaction.editReply({
          content:
            'Não consegui enviar o painel neste canal. O bot precisa de **Ver Canal, Enviar Mensagens e Inserir Links** aqui.\n' +
            `-# Detalhe: ${String((erro && erro.message) || erro).slice(0, 150)}`
        });
      }
      return await interaction.editReply({ content: 'Painel de confissões criado com sucesso!' });
    }

    // 3. /confissao — abre o modal direto pelo slash
    if (interaction.isChatInputCommand() && interaction.commandName === 'confissao') {
      return await interaction.showModal(modalConfissao());
    }

    // 4. /minhas-confissoes — o autor acompanha seus códigos e status
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

    // 5. /autor-confissao — Gestão+ descobre o autor pelo código de rastreio
    if (interaction.isChatInputCommand() && interaction.commandName === 'autor-confissao') {
      if (!podeAprovar(interaction)) {
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
          {
            name: 'Autor',
            value: `<@${registro.userId}>\n${registro.autorTag}\n\`${registro.userId}\``,
            inline: true
          },
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

      await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      // Só o fato da consulta vai para o canal de logs; o autor nunca aparece lá
      return await registrarLog(
        interaction.guild,
        `🔎 <@${interaction.user.id}> consultou o autor da confissão ${citarCodigo(registro.codigo)}`
      );
    }

    // 6. Botão do painel — abre o modal
    if (interaction.isButton() && interaction.customId === 'abrir_modal_confissao') {
      return await interaction.showModal(modalConfissao());
    }

    // 7. Modal enviado — cria o registro e encaminha para o canal de análise
    if (interaction.isModalSubmit() && interaction.customId === 'modal_confissao') {
      await interaction.deferReply({ flags: EPHEMERAL });

      const texto = interaction.fields.getTextInputValue('texto_confissao').trim();
      if (!texto) {
        return await interaction.editReply({ content: 'A confissão não pode ficar vazia.' });
      }

      const userId = interaction.user.id;
      const bloqueio = checarLimites(userId);
      if (bloqueio) {
        return await interaction.editReply({ content: bloqueio });
      }

      const canalAnalise = resolverCanal(interaction.guild, 'analise');
      if (!canalAnalise) {
        return await interaction.editReply({ content: AVISO_SEM_CANAL });
      }

      // Reserva o cooldown AGORA (antes de qualquer await): dois envios simultâneos não passam juntos
      ultimoEnvio.set(userId, Date.now());

      const registro = db.criarConfissao({
        userId,
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
        // Desfaz: sem mensagem no canal não existe confissão (nada de pendente fantasma contando no limite)
        db.remover(registro.codigo);
        ultimoEnvio.delete(userId);
        return await interaction.editReply({
          content: 'Erro ao enviar sua confissão para análise. Tente novamente mais tarde.'
        });
      }

      return await interaction.editReply({
        content:
          `Sua confissão foi enviada para análise. Guarde o código ${citarCodigo(registro.codigo)}.\n` +
          'Você será avisado no PV quando a Gestão decidir (deixe suas mensagens diretas abertas) ' +
          'ou acompanhe com `/minhas-confissoes`.'
      });
    }

    // 8. Botões de aprovar/recusar — Gestão e cargos acima
    if (
      interaction.isButton() &&
      (interaction.customId.startsWith('aprovar_') || interaction.customId.startsWith('recusar_'))
    ) {
      const aprovando = interaction.customId.startsWith('aprovar_');
      const codigo = interaction.customId
        .slice((aprovando ? 'aprovar_' : 'recusar_').length)
        .trim()
        .toUpperCase();

      if (!podeAprovar(interaction)) {
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
        let canalPublico = null;
        let mensagemPublica = null;

        if (aprovando) {
          canalPublico = resolverCanal(interaction.guild, 'publico');

          if (!canalPublico) {
            return await interaction.followUp({ content: AVISO_SEM_CANAL, flags: EPHEMERAL });
          }

          const embedPublico = new EmbedBuilder()
            .setTitle('🗣️ Confissão Anônima')
            .setDescription(registro.texto)
            .setColor('#57F287')
            .setTimestamp()
            .setFooter({ text: `Código ${registro.codigo}` });

          // Se o envio falhar, a confissão continua pendente (dá para tentar de novo)
          try {
            mensagemPublica = await canalPublico.send({
              embeds: [embedPublico],
              allowedMentions: MENTIONS_NULAS
            });
          } catch (erro) {
            console.error(`[ERRO] Não consegui publicar a confissão ${codigo} em #${canalPublico.name}:`, erro);
            return await interaction.followUp({
              content:
                `Não consegui publicar em <#${canalPublico.id}>. Confira se o bot tem **Ver Canal, Enviar Mensagens ` +
                'e Inserir Links** nesse canal e tente de novo. A confissão continua pendente.\n' +
                `-# Detalhe: ${String((erro && erro.message) || erro).slice(0, 150)}`,
              flags: EPHEMERAL
            });
          }
        }

        db.atualizar(codigo, {
          status: aprovando ? 'aprovada' : 'recusada',
          decididoEm: Date.now(),
          decididoPor: interaction.user.tag,
          decididoPorId: interaction.user.id
        });

        // A decisão já está salva; falha ao atualizar a mensagem não pode virar "erro" para quem clicou
        try {
          const embedAtualizado = EmbedBuilder.from(embedOriginal)
            .setTitle(aprovando ? '✅ Confissão Aprovada' : '❌ Confissão Recusada')
            .setColor(aprovando ? '#57F287' : '#ED4245')
            .addFields({
              name: aprovando ? 'Aprovada por' : 'Recusada por',
              value: `${interaction.user.tag}`
            });
          await interaction.editReply({ embeds: [embedAtualizado], components: [] });
        } catch (erro) {
          console.error('[ERRO] Decisão salva, mas não consegui atualizar a mensagem:', erro.message);
        }

        await registrarLog(
          interaction.guild,
          `${aprovando ? '✅ Aprovada' : '❌ Recusada'} — ${citarCodigo(codigo)} por <@${interaction.user.id}>`
        );

        await avisarAutor({
          guild: interaction.guild,
          registro,
          aprovada: aprovando,
          canalPublico,
          mensagemPublica
        });
      } finally {
        emAndamento.delete(codigo);
      }
    }
  } catch (error) {
    const quem = interaction.isChatInputCommand()
      ? `/${interaction.commandName}`
      : interaction.customId || `tipo ${interaction.type}`;
    console.error(`[ERRO] Falha na interação (${quem}):`, error);

    const texto = mensagemDeErro(error, interaction);
    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: texto, flags: EPHEMERAL });
      } else if (interaction.deferred && !interaction.replied) {
        // Já houve defer e ainda não houve resposta: followUp ocupa o lugar do "pensando..."
        await interaction.followUp({ content: texto, flags: EPHEMERAL });
      }
    } catch (_) {
      // interação já expirou; nada a fazer
    }
  }
});

// Registro automático dos slash commands ao iniciar — no Render não há shell,
// então isso dispensa rodar `npm run deploy` manualmente. AUTO_DEPLOY=false desativa.
client.once(Events.ClientReady, async () => {
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

// ---------------------------------------------------------------------------
// Diagnóstico de conexão e encerramento limpo
// ---------------------------------------------------------------------------
client.on(Events.Error, error => console.error('[ERRO] Client:', error));
client.on(Events.ShardError, error => console.error('[GATEWAY] Erro no shard:', error && error.message));
client.on(Events.ShardDisconnect, (evento, id) =>
  console.warn(`[GATEWAY] Shard ${id} desconectou (código ${evento && evento.code})`)
);
client.on(Events.ShardReconnecting, id => console.warn(`[GATEWAY] Shard ${id} reconectando...`));
client.on(Events.Invalidated, () => {
  console.error('[GATEWAY] Sessão invalidada. Encerrando para o host reiniciar o bot.');
  process.exit(1);
});
process.on('unhandledRejection', error => console.error('[ERRO] unhandledRejection:', error));

async function encerrar(sinal) {
  console.log(`[BOT] ${sinal} recebido, encerrando...`);
  try {
    servidorHttp.close();
    await client.destroy();
  } finally {
    process.exit(0); // o banco grava cada mudança na hora: não há nada pendente para salvar
  }
}
process.once('SIGTERM', () => encerrar('SIGTERM'));
process.once('SIGINT', () => encerrar('SIGINT'));

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('[ERRO] Falha no login (token inválido ou Discord inacessível):', error.message);
  process.exit(1);
});

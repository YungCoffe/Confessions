const {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits: P,
  PermissionsBitField,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const db = require('./db');
const { cargosGestaoMais } = require('./permissoes');
const { painelConfissoes } = require('./ui');

const EPHEMERAL = MessageFlags.Ephemeral;

// Os canais são sempre escolhidos por você em /configurar-confissoes (o bot não cria nem adivinha nada).
// Onde o bot procura cada um: configuração salva pelo comando > variável do .env.
const CANAIS = {
  painel: { cfg: 'canalPainelId', env: null },
  analise: { cfg: 'canalAnaliseId', env: 'ANALISE_CHANNEL_ID' },
  publico: { cfg: 'canalPublicoId', env: 'PUBLIC_CHANNEL_ID' },
  logs: { cfg: 'canalLogsId', env: 'LOGS_CHANNEL_ID' }
};

const LER = [P.ViewChannel, P.ReadMessageHistory];
const PERMISSOES_DO_BOT = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory];
const PERMISSOES_NOS_CANAIS_ABERTOS = [P.ViewChannel, P.SendMessages, P.EmbedLinks];

// Limite do Discord: 100 sobrescritas por canal (reserva espaço para @everyone e para o bot)
const MAX_CARGOS_STAFF = 85;

const NOMES_PT = {
  ManageRoles: 'Gerenciar Cargos',
  ViewChannel: 'Ver Canais',
  SendMessages: 'Enviar Mensagens',
  EmbedLinks: 'Inserir Links',
  ReadMessageHistory: 'Ver Histórico de Mensagens'
};

function nomesPt(flags) {
  return new PermissionsBitField(flags).toArray().map(n => NOMES_PT[n] || n);
}

function ehTexto(canal) {
  return Boolean(
    canal && (canal.type === ChannelType.GuildText || canal.type === ChannelType.GuildAnnouncement)
  );
}

function resolverCanal(guild, chave) {
  const def = CANAIS[chave];
  const ids = [db.obterConfig(guild.id)[def.cfg], def.env ? process.env[def.env] : null].filter(Boolean);
  for (const id of ids) {
    const canal = guild.channels.cache.get(id);
    if (ehTexto(canal)) return canal;
  }
  return null;
}

// Canais privados (análise e logs): só Gestão e acima enxergam; o bot mantém acesso para postar
function sobrescritasPrivadas({ guild, botId, staff }) {
  return [
    { id: guild.id, type: OverwriteType.Role, allow: [], deny: [P.ViewChannel] },
    ...staff.map(cargo => ({ id: cargo.id, type: OverwriteType.Role, allow: LER, deny: [] })),
    { id: botId, type: OverwriteType.Member, allow: PERMISSOES_DO_BOT, deny: [] }
  ];
}

// Reedita o painel existente em vez de empilhar painéis repetidos a cada execução
async function publicarPainel(canal, configAnterior) {
  if (configAnterior.painelMensagemId && configAnterior.canalPainelId === canal.id) {
    try {
      const existente = await canal.messages.fetch(configAnterior.painelMensagemId);
      return await existente.edit(painelConfissoes());
    } catch (_) {
      // mensagem apagada: envia uma nova
    }
  }
  return canal.send(painelConfissoes());
}

function listarCargos(cargos, limite = 700) {
  let texto = '';
  let exibidos = 0;
  for (const cargo of cargos) {
    const parte = `<@&${cargo.id}> `;
    if ((texto + parte).length > limite) break;
    texto += parte;
    exibidos += 1;
  }
  const resto = cargos.length - exibidos;
  return (texto.trim() || '—') + (resto > 0 ? ` …e mais ${resto}` : '');
}

async function configurarCanais(interaction) {
  const { guild, options } = interaction;
  await interaction.deferReply({ flags: EPHEMERAL });

  const motivo = `Configuração das confissões por ${interaction.user.tag}`;
  const configAnterior = db.obterConfig(guild.id);
  const responder = content => interaction.editReply({ content });

  try {
    // 1. Cargo Gestão --------------------------------------------------------
    const escolhido = options.getRole('cargo-gestao', true);
    const gestao = guild.roles.cache.get(escolhido.id);
    if (!gestao) return await responder('Não consegui ler esse cargo. Tente de novo.');
    if (gestao.id === guild.id) {
      return await responder('O cargo @everyone não pode ser a Gestão: todos os membros veriam a análise.');
    }
    if (gestao.managed) {
      return await responder('Esse cargo pertence a um bot ou integração. Escolha o cargo da sua Gestão.');
    }

    // 2. Canais escolhidos ----------------------------------------------------
    const pegar = nome => {
      const opcao = options.getChannel(nome);
      return opcao ? guild.channels.cache.get(opcao.id) || null : null;
    };
    const painel = pegar('canal-painel');
    const analise = pegar('canal-analise');
    const publico = pegar('canal-aprovadas');
    let logs = pegar('canal-logs');

    for (const [nome, canal] of [['painel', painel], ['análise', analise], ['aprovadas', publico]]) {
      if (!ehTexto(canal)) {
        return await responder(`Não consegui acessar o canal de ${nome}. Escolha um canal de texto que o bot enxergue.`);
      }
    }

    // Sem canal-logs na execução, mantém o que já estava salvo (se não colidir com os novos)
    const informouLogs = Boolean(logs);
    if (!logs) {
      logs = resolverCanal(guild, 'logs');
      if (logs && [painel, analise, publico].some(c => c.id === logs.id)) logs = null;
    }

    const escolhidos = [painel, analise, publico, logs].filter(Boolean);
    if (new Set(escolhidos.map(c => c.id)).size !== escolhidos.length) {
      return await responder('Cada função precisa de um canal diferente (painel, análise, aprovadas e logs).');
    }

    // 3. O bot tem o que precisa? ----------------------------------------------
    const eu = await guild.members.fetchMe();
    const faltandoNoServidor = [P.ManageRoles, ...PERMISSOES_DO_BOT].filter(p => !eu.permissions.has(p));
    if (faltandoNoServidor.length) {
      return await responder(
        `Faltam permissões para o bot: **${nomesPt(faltandoNoServidor).join(', ')}**. ` +
          'Ajuste o cargo dele e rode o comando de novo. (Gerenciar Cargos é usado só para deixar a análise privada.)'
      );
    }

    // Nos canais que o bot não vai reconfigurar (painel e aprovadas) ele precisa já ter acesso
    const problemas = [];
    for (const canal of [painel, publico]) {
      const permissoes = canal.permissionsFor(eu);
      const faltando = PERMISSOES_NOS_CANAIS_ABERTOS.filter(p => !permissoes || !permissoes.has(p));
      if (faltando.length) problemas.push(`<#${canal.id}>: ${nomesPt(faltando).join(', ')}`);
    }
    if (problemas.length) {
      return await responder(
        `O bot não tem acesso suficiente nestes canais:\n${problemas.join('\n')}\nLibere e rode o comando de novo.`
      );
    }

    // 4. Gestão e todos acima dela ----------------------------------------------
    const avisos = [];
    let staff = cargosGestaoMais(guild, gestao);
    if (staff.length > MAX_CARGOS_STAFF) {
      avisos.push(
        `Havia ${staff.length} cargos de Gestão ou acima; o Discord limita as permissões de um canal, ` +
          `então ficaram os ${MAX_CARGOS_STAFF} mais próximos da Gestão (os mais altos costumam ser Administradores, que já veem tudo).`
      );
      staff = staff.slice(0, MAX_CARGOS_STAFF);
    }
    if (!staff.some(c => c.id === gestao.id)) staff.unshift(gestao);

    // 5. Deixa análise (e logs) visíveis só para a Gestão+ ---------------------
    // ATENÇÃO: substitui as permissões desses canais (é o que garante que ninguém mais veja).
    const contexto = { guild, botId: interaction.client.user.id, staff };
    await analise.permissionOverwrites.set(sobrescritasPrivadas(contexto), motivo);
    if (logs) await logs.permissionOverwrites.set(sobrescritasPrivadas(contexto), motivo);

    // 6. Painel de envio ---------------------------------------------------------
    const mensagem = await publicarPainel(painel, configAnterior);

    // 7. Salva (só depois que tudo deu certo) -------------------------------------
    db.salvarConfig(guild.id, {
      cargoGestaoId: gestao.id,
      canalPainelId: painel.id,
      canalAnaliseId: analise.id,
      canalPublicoId: publico.id,
      canalLogsId: logs ? logs.id : null,
      painelMensagemId: mensagem.id
    });

    // 8. Resumo -----------------------------------------------------------------------
    const linhasEnv = [
      `GESTAO_ROLE_ID=${gestao.id}`,
      `ANALISE_CHANNEL_ID=${analise.id}`,
      `PUBLIC_CHANNEL_ID=${publico.id}`,
      logs ? `LOGS_CHANNEL_ID=${logs.id}` : null
    ].filter(Boolean);

    const embed = new EmbedBuilder()
      .setTitle('✅ Confissões configuradas')
      .setColor('#57F287')
      .addFields(
        { name: '📝 Painel de envio', value: `<#${painel.id}> — painel postado` },
        {
          name: '🔒 Análise (Aprovar / Recusar)',
          value: `<#${analise.id}>\nPrivado: só Gestão e acima veem e decidem`
        },
        { name: '📢 Confissões aprovadas', value: `<#${publico.id}>` },
        {
          name: '🧾 Registro de decisões',
          value: logs
            ? `<#${logs.id}>${informouLogs ? '' : ' (mantido da configuração anterior)'}\nPrivado: só Gestão e acima`
            : 'Não configurado (opcional: use `canal-logs`)'
        },
        {
          name: `👥 Gestão e acima (${staff.length})`,
          value: `Cargo escolhido: <@&${gestao.id}>\n${listarCargos(staff)}`
        },
        {
          name: 'Host sem disco persistente (ex.: Render free)?',
          value:
            'Cole nas variáveis de ambiente para o bot não perder a configuração ao reiniciar:\n```\n' +
            `${linhasEnv.join('\n')}\n` +
            '```'
        }
      )
      .setFooter({
        text: 'Criou um cargo novo acima da Gestão? Rode /configurar-confissoes de novo para ele ver a análise.'
      });

    if (avisos.length) embed.addFields({ name: '⚠️ Atenção', value: avisos.join('\n').slice(0, 1000) });

    return await interaction.editReply({ embeds: [embed] });
  } catch (erro) {
    console.error('[CONFIGURAR] Falha:', erro);
    const semPermissao = erro && (erro.code === 50013 || erro.code === 50001);
    const dica = semPermissao
      ? 'Faltou permissão. Confira se o bot tem **Gerenciar Cargos** e acesso aos canais escolhidos e, se continuar, suba o cargo do bot na lista de cargos.'
      : `Erro: ${String((erro && erro.message) || erro).slice(0, 300)}`;
    try {
      await interaction.editReply({ content: `Não consegui terminar a configuração. ${dica}` });
    } catch (_) {
      // interação expirou
    }
  }
}

module.exports = { configurarCanais, resolverCanal, publicarPainel, CANAIS };

const {
  ChannelType,
  PermissionFlagsBits: P,
  PermissionsBitField,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const db = require('./db');
const { painelConfissoes, TEMA_NATAL } = require('./ui');

const EPHEMERAL = MessageFlags.Ephemeral;

// Os canais são sempre escolhidos por você em /configurar-confissoes (o bot não cria nem adivinha nada).
// Onde o bot procura cada um: configuração salva pelo comando > variável do .env.
const CANAIS = {
  painel: { cfg: 'canalPainelId', env: null },
  analise: { cfg: 'canalAnaliseId', env: 'ANALISE_CHANNEL_ID' },
  publico: { cfg: 'canalPublicoId', env: 'PUBLIC_CHANNEL_ID' },
  logs: { cfg: 'canalLogsId', env: 'LOGS_CHANNEL_ID' }
};

// O bot NÃO altera permissões nem configurações de canal nenhum: quem vê e quem escreve em cada canal
// é decisão sua. O comando só confere se o bot consegue fazer o que precisa em cada canal.
const BASE = [P.ViewChannel, P.SendMessages, P.EmbedLinks];
const PERMISSOES_POR_CANAL = {
  painel: { nome: 'painel', precisa: [...BASE, P.ReadMessageHistory] }, // histórico: para editar o painel já postado
  analise: { nome: 'análise', precisa: [...BASE, P.AttachFiles] }, // anexar: foto da confissão
  publico: { nome: 'aprovadas', precisa: [...BASE, P.AttachFiles] },
  logs: { nome: 'logs', precisa: [P.ViewChannel, P.SendMessages] }
};

const NOMES_PT = {
  ViewChannel: 'Ver Canais',
  SendMessages: 'Enviar Mensagens',
  EmbedLinks: 'Inserir Links',
  AttachFiles: 'Anexar Arquivos',
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

async function configurarCanais(interaction) {
  const { guild, options } = interaction;
  await interaction.deferReply({ flags: EPHEMERAL });
  const responder = content => interaction.editReply({ content });

  try {
    const configAnterior = db.obterConfig(guild.id);

    // 1. Cargo Gestão --------------------------------------------------------
    const escolhido = options.getRole('cargo-gestao', true);
    const gestao = guild.roles.cache.get(escolhido.id);
    if (!gestao) return await responder('Não consegui ler esse cargo. Tente de novo.');
    if (gestao.id === guild.id) {
      return await responder('O cargo @everyone não pode ser a Gestão: todos os membros poderiam aprovar e ver autores.');
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

    // 3. O bot consegue trabalhar em cada canal? (só confere; não altera nada) -------------
    const eu = await guild.members.fetchMe();
    const bloqueios = [];
    const avisos = [];
    const porCanal = [
      ['painel', painel],
      ['analise', analise],
      ['publico', publico],
      ['logs', logs]
    ];
    for (const [chave, canal] of porCanal) {
      if (!canal) continue;
      const permissoes = canal.permissionsFor(eu);
      const faltando = PERMISSOES_POR_CANAL[chave].precisa.filter(p => !permissoes || !permissoes.has(p));
      if (!faltando.length) continue;
      const linha = `<#${canal.id}>: ${nomesPt(faltando).join(', ')}`;
      // Um canal de logs antigo (não escolhido agora) não deve impedir a configuração nova
      if (chave === 'logs' && !informouLogs) avisos.push(`O bot não tem acesso ao canal de logs salvo — ${linha}`);
      else bloqueios.push(linha);
    }
    if (bloqueios.length) {
      return await responder(
        `O bot não tem acesso suficiente nestes canais:\n${bloqueios.join('\n')}\n` +
          'Libere nas permissões do canal e rode o comando de novo. (O bot não altera permissões sozinho.)'
      );
    }

    // 4. Avisos de leitura: algo que provavelmente não é o que você quer --------------------
    const paraTodos = guild.roles.everyone;
    for (const [nome, canal] of [['análise', analise], ['logs', logs]]) {
      if (!canal || !paraTodos) continue;
      const permissoes = canal.permissionsFor(paraTodos);
      if (permissoes && permissoes.has(P.ViewChannel)) {
        avisos.push(`O canal de ${nome} (<#${canal.id}>) está visível para @everyone: qualquer membro poderia ler as confissões antes da aprovação.`);
      }
    }
    const gestaoNaAnalise = analise.permissionsFor(gestao);
    if (gestaoNaAnalise && !gestaoNaAnalise.has(P.ViewChannel)) {
      avisos.push(`O cargo <@&${gestao.id}> ainda não enxerga <#${analise.id}>: libere nas permissões do canal para a Gestão conseguir aprovar.`);
    }

    // 5. Painel de envio ---------------------------------------------------------------
    const mensagem = await publicarPainel(painel, configAnterior);

    // 6. Salva (só depois que tudo deu certo) -------------------------------------------
    db.salvarConfig(guild.id, {
      cargoGestaoId: gestao.id,
      canalPainelId: painel.id,
      canalAnaliseId: analise.id,
      canalPublicoId: publico.id,
      canalLogsId: logs ? logs.id : null,
      painelMensagemId: mensagem.id
    });

    // 7. Resumo -----------------------------------------------------------------------------
    const linhasEnv = [
      `GESTAO_ROLE_ID=${gestao.id}`,
      `ANALISE_CHANNEL_ID=${analise.id}`,
      `PUBLIC_CHANNEL_ID=${publico.id}`,
      logs ? `LOGS_CHANNEL_ID=${logs.id}` : null
    ].filter(Boolean);

    const embed = new EmbedBuilder()
      .setTitle('🎄 Confissões configuradas ❄️')
      .setColor(TEMA_NATAL.verde)
      .addFields(
        { name: '🎁 Painel de envio', value: `<#${painel.id}> — painel postado` },
        { name: '🔍 Análise (Aprovar / Recusar)', value: `<#${analise.id}>` },
        { name: '📢 Confissões aprovadas', value: `<#${publico.id}>` },
        {
          name: '🧾 Registro de decisões',
          value: logs
            ? `<#${logs.id}>${informouLogs ? '' : ' (mantido da configuração anterior)'}`
            : 'Não configurado (opcional: use `canal-logs`)'
        },
        {
          name: '👥 Quem aprova, recusa e consulta autor',
          value: `<@&${gestao.id}> e todos os cargos acima dele (e Administradores)`
        },
        {
          name: '🔧 Permissões dos canais',
          value:
            'O bot **não alterou** permissões nem configurações de nenhum canal. Você controla quem vê e quem ' +
            'escreve em cada um: o bot só precisa conseguir enviar mensagens (e anexar arquivos) neles.'
        },
        {
          name: 'Host sem disco persistente (ex.: Render free)?',
          value:
            'Cole nas variáveis de ambiente para o bot não perder a configuração ao reiniciar:\n```\n' +
            `${linhasEnv.join('\n')}\n` +
            '```'
        }
      )
      .setFooter({ text: '🎅 Tudo pronto para o Correio de Natal • Ho Ho Ho!' });

    if (avisos.length) embed.addFields({ name: '⚠️ Atenção', value: avisos.join('\n').slice(0, 1000) });

    return await interaction.editReply({ embeds: [embed] });
  } catch (erro) {
    console.error('[CONFIGURAR] Falha:', erro);
    const semPermissao = erro && (erro.code === 50013 || erro.code === 50001);
    const dica = semPermissao
      ? 'Faltou permissão. Confira se o bot tem acesso aos canais escolhidos (Ver Canais, Enviar Mensagens, Inserir Links e Anexar Arquivos).'
      : `Erro: ${String((erro && erro.message) || erro).slice(0, 300)}`;
    try {
      await interaction.editReply({ content: `Não consegui terminar a configuração. ${dica}` });
    } catch (_) {
      // interação expirou
    }
  }
}

module.exports = { configurarCanais, resolverCanal, publicarPainel, CANAIS };

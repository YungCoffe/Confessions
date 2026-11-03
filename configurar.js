const {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits: P,
  PermissionsBitField,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const db = require('./db');
const { cargoReferencia, cargosGestaoMais } = require('./permissoes');
const { painelConfissoes } = require('./ui');

const EPHEMERAL = MessageFlags.Ephemeral;

// Nomes padrão (sem emoji de propósito: se a configuração salva se perder, o bot ainda acha pelo nome)
const NOME_CATEGORIA = 'CONFISSÕES';
const CANAIS = {
  painel: {
    nome: 'enviar-confissao',
    cfg: 'canalPainelId',
    env: null,
    topico: 'Clique no botão para enviar uma confissão anônima.'
  },
  analise: {
    nome: 'analise-confissoes',
    cfg: 'canalAnaliseId',
    env: 'ANALISE_CHANNEL_ID',
    topico: 'Privado: a Gestão aprova ou recusa as confissões pendentes.'
  },
  publico: {
    nome: 'confissoes',
    cfg: 'canalPublicoId',
    env: 'PUBLIC_CHANNEL_ID',
    topico: 'Confissões anônimas aprovadas pela Gestão.'
  },
  logs: {
    nome: 'logs-confissoes',
    cfg: 'canalLogsId',
    env: 'LOGS_CHANNEL_ID',
    topico: 'Privado: registro de aprovações, recusas e consultas de autor.'
  }
};

const LER = [P.ViewChannel, P.ReadMessageHistory];
const ESCRITA = [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads];
const PERMISSOES_DO_BOT = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory];

// Limite do Discord: 100 sobrescritas por canal (reserva espaço para @everyone, bot e cargo de membros)
const MAX_CARGOS_STAFF = 85;

const NOMES_PT = {
  ManageChannels: 'Gerenciar Canais',
  ManageRoles: 'Gerenciar Cargos',
  ViewChannel: 'Ver Canais',
  SendMessages: 'Enviar Mensagens',
  EmbedLinks: 'Inserir Links',
  ReadMessageHistory: 'Ver Histórico de Mensagens'
};

function ehTexto(canal) {
  return Boolean(
    canal && (canal.type === ChannelType.GuildText || canal.type === ChannelType.GuildAnnouncement)
  );
}

// Ordem: configuração salva por /configurar-confissoes > ID no .env > nome padrão
function resolverCanal(guild, chave) {
  const def = CANAIS[chave];
  const ids = [db.obterConfig(guild.id)[def.cfg], def.env ? process.env[def.env] : null].filter(Boolean);

  for (const id of ids) {
    const canal = guild.channels.cache.get(id);
    if (ehTexto(canal)) return canal;
  }
  return guild.channels.cache.find(c => c.name === def.nome && ehTexto(c)) || null;
}

// Quem vê / quem escreve em cada canal
function montarSobrescritas(chave, { guild, botId, staff, cargoMembros }) {
  const mapa = new Map();
  const cargo = (id, allow = [], deny = []) => mapa.set(id, { id, type: OverwriteType.Role, allow, deny });
  const privado = chave === 'analise' || chave === 'logs';

  if (privado) {
    // Só Gestão e acima enxergam
    cargo(guild.id, [], [P.ViewChannel]);
    for (const c of staff) cargo(c.id, LER);
  } else if (cargoMembros) {
    // Painel e público restritos a um cargo (a Gestão sempre vê)
    cargo(guild.id, [], [P.ViewChannel, ...ESCRITA]);
    for (const c of staff) cargo(c.id, LER);
    cargo(cargoMembros.id, [...LER, P.UseApplicationCommands], ESCRITA);
  } else {
    // Todos veem, ninguém escreve (o envio é pelo botão / slash command)
    cargo(guild.id, [...LER, P.UseApplicationCommands], ESCRITA);
  }

  mapa.set(botId, { id: botId, type: OverwriteType.Member, allow: PERMISSOES_DO_BOT, deny: [] });
  return Array.from(mapa.values());
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

function listarCargos(cargos, limite = 900) {
  let texto = '';
  let exibidos = 0;
  for (const c of cargos) {
    const parte = `<@&${c.id}> `;
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
  const salvo = {}; // salvo no finally: se algo falhar no meio, o que já foi criado não se perde

  try {
    // 1. Cargo Gestão -------------------------------------------------------
    const escolhidoGestao = options.getRole('cargo-gestao');
    let gestao = null;
    if (escolhidoGestao) {
      gestao = guild.roles.cache.get(escolhidoGestao.id) || null;
      if (gestao && gestao.id === guild.id) {
        return await interaction.editReply({
          content: 'O cargo @everyone não pode ser a Gestão: todos os membros veriam os canais privados.'
        });
      }
      if (gestao && gestao.managed) {
        return await interaction.editReply({
          content: 'Esse cargo pertence a um bot ou integração. Escolha o cargo da sua Gestão.'
        });
      }
    } else {
      gestao = cargoReferencia(guild);
    }

    if (!gestao) {
      return await interaction.editReply({
        content:
          'Não encontrei o cargo **Gestão**. Rode `/configurar-confissoes` de novo e escolha o cargo na opção `cargo-gestao`.'
      });
    }
    salvo.cargoGestaoId = gestao.id;

    // 2. Cargo que pode ver painel/público ----------------------------------
    // Sem a opção, mantém o que já estava salvo (nunca abre o acesso sem você pedir).
    // Para voltar a liberar a todos, escolha @everyone na opção.
    const escolhidoMembros = options.getRole('cargo-membros');
    let cargoMembros = null;
    if (escolhidoMembros) {
      cargoMembros = escolhidoMembros.id === guild.id ? null : guild.roles.cache.get(escolhidoMembros.id) || null;
      salvo.cargoMembrosId = cargoMembros ? cargoMembros.id : null;
    } else if (configAnterior.cargoMembrosId) {
      cargoMembros = guild.roles.cache.get(configAnterior.cargoMembrosId) || null;
    }

    // 3. O bot tem o que precisa? -------------------------------------------
    const eu = await guild.members.fetchMe();
    const faltando = [P.ManageChannels, P.ManageRoles, ...PERMISSOES_DO_BOT].filter(p => !eu.permissions.has(p));
    if (faltando.length) {
      const nomes = new PermissionsBitField(faltando).toArray().map(n => NOMES_PT[n] || n);
      return await interaction.editReply({
        content: `Faltam permissões para o bot: **${nomes.join(', ')}**. Ajuste o cargo dele e rode o comando de novo.`
      });
    }

    // 4. Quem enxerga os canais privados ------------------------------------
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

    // 5. Canais: reaproveita os existentes, cria os que faltam --------------
    const existentes = {};
    const usados = new Set();
    for (const chave of Object.keys(CANAIS)) {
      const escolhido = options.getChannel(`canal-${chave}`);
      const canal = escolhido ? guild.channels.cache.get(escolhido.id) || null : resolverCanal(guild, chave);
      if (canal) {
        if (usados.has(canal.id)) {
          return await interaction.editReply({
            content: `O canal <#${canal.id}> foi escolhido para duas funções. Cada função precisa de um canal diferente.`
          });
        }
        usados.add(canal.id);
      }
      existentes[chave] = canal;
    }

    let categoria = null;
    const garantirCategoria = async () => {
      if (categoria) return categoria;
      categoria =
        guild.channels.cache.get(configAnterior.categoriaId || '') ||
        guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === NOME_CATEGORIA) ||
        (await guild.channels.create({ name: NOME_CATEGORIA, type: ChannelType.GuildCategory, reason: motivo }));
      salvo.categoriaId = categoria.id;
      return categoria;
    };

    const contexto = { guild, botId: interaction.client.user.id, staff, cargoMembros };
    const resultado = {};

    // Privados primeiro: nenhum canal sensível fica público nem por um instante
    for (const chave of ['analise', 'logs', 'publico', 'painel']) {
      const def = CANAIS[chave];
      const permissoes = montarSobrescritas(chave, contexto);
      let canal = existentes[chave];
      let criado = false;

      if (canal) {
        await canal.permissionOverwrites.set(permissoes, motivo);
      } else {
        const pai = await garantirCategoria();
        canal = await guild.channels.create({
          name: def.nome,
          type: ChannelType.GuildText,
          parent: pai.id,
          topic: def.topico,
          permissionOverwrites: permissoes,
          reason: motivo
        });
        criado = true;
      }

      salvo[def.cfg] = canal.id;
      resultado[chave] = { canal, criado };
    }

    // 6. Painel de envio ----------------------------------------------------
    const mensagem = await publicarPainel(resultado.painel.canal, configAnterior);
    salvo.painelMensagemId = mensagem.id;

    // 7. Resumo -------------------------------------------------------------
    const status = chave => (resultado[chave].criado ? 'criado' : 'já existia, permissões reaplicadas');
    const quemVePublico = cargoMembros
      ? `só <@&${cargoMembros.id}> e a Gestão+ • somente leitura`
      : 'todos veem • somente leitura';

    const embed = new EmbedBuilder()
      .setTitle('✅ Confissões configuradas')
      .setColor('#57F287')
      .addFields(
        {
          name: '📝 Painel de envio',
          value: `<#${resultado.painel.canal.id}> (${status('painel')})\n${quemVePublico}, só o botão envia`
        },
        {
          name: '🔒 Análise — Aprovar / Recusar',
          value: `<#${resultado.analise.canal.id}> (${status('analise')})\nSó Gestão e acima`
        },
        {
          name: '🧾 Registro de decisões',
          value: `<#${resultado.logs.canal.id}> (${status('logs')})\nSó Gestão e acima`
        },
        {
          name: '📢 Confissões aprovadas',
          value: `<#${resultado.publico.canal.id}> (${status('publico')})\n${quemVePublico}`
        },
        {
          name: `Cargos que veem os canais privados (${staff.length})`,
          value: listarCargos(staff)
        },
        {
          name: 'Host sem disco persistente (ex.: Render free)?',
          value:
            'Cole nas variáveis de ambiente para o bot não perder a configuração ao reiniciar:\n```\n' +
            `GESTAO_ROLE_ID=${gestao.id}\n` +
            `ANALISE_CHANNEL_ID=${resultado.analise.canal.id}\n` +
            `PUBLIC_CHANNEL_ID=${resultado.publico.canal.id}\n` +
            `LOGS_CHANNEL_ID=${resultado.logs.canal.id}\n` +
            '```'
        }
      )
      .setFooter({
        text: 'Criou um cargo novo acima da Gestão? Rode /configurar-confissoes de novo para ele ver os canais.'
      });

    if (avisos.length) embed.addFields({ name: '⚠️ Atenção', value: avisos.join('\n').slice(0, 1000) });

    return await interaction.editReply({ embeds: [embed] });
  } catch (erro) {
    console.error('[CONFIGURAR] Falha:', erro);
    const semPermissao = erro && (erro.code === 50013 || erro.code === 50001);
    const dica = semPermissao
      ? 'Faltou permissão. Confira se o bot tem **Gerenciar Canais** e **Gerenciar Cargos** e, se continuar, suba o cargo do bot na lista de cargos.'
      : `Erro: ${String((erro && erro.message) || erro).slice(0, 300)}`;
    try {
      await interaction.editReply({
        content: `Não consegui terminar a configuração. ${dica}\nO que já foi criado fica salvo; é só rodar o comando de novo.`
      });
    } catch (_) {
      // interação expirou
    }
  } finally {
    if (Object.keys(salvo).length) db.salvarConfig(guild.id, salvo);
  }
}

module.exports = { configurarCanais, resolverCanal, publicarPainel, CANAIS };

const {
  Client,
  GatewayIntentBits,
  Options,
  Events,
  ActivityType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
  REST,
  Routes
} = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // precisa vir antes de db/permissoes/configurar (eles leem o .env ao carregar)
const { iniciarServidor } = require('./servidor');
const commands = require('./commands');
const db = require('./db');
const { podeAprovar } = require('./permissoes');
const {
  TEMA_NATAL,
  modalConfissao,
  painelConfissoes,
  textoContagemNatal,
  textoContagemAnoNovo,
  mensagemDeNatal,
  ehHoraDoRecadoDeNatal,
  dataNoBrasil,
  EMOJI_STATUS,
  ID_BOTAO_ENVIAR,
  ID_BOTAO_MINHAS,
  ID_MODAL,
  ID_CAMPO_TEXTO,
  ID_CAMPO_FOTO,
  IDS_CAMPO_FIGURINHA,
  MAX_FIGURINHAS
} = require('./ui');
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

// ---------------------------------------------------------------------------
// Cartão do mural: cada confissão publicada sai com um enfeite natalino diferente
// (a cor e a saudação são sempre as mesmas para o mesmo código)
// ---------------------------------------------------------------------------
const CORES_MURAL = [TEMA_NATAL.verde, TEMA_NATAL.vermelho, TEMA_NATAL.dourado];
const SAUDACOES_MURAL = [
  '🎅 Mais uma carta entregue pelo Correio de Natal!',
  '🔔 Os sinos tocaram: confissão nova no mural!',
  '🕯️ Uma nova confissão iluminou o mural.',
  '⭐ O Papai Noel deixou esta carta por aqui.'
];
const ENFEITE_TOPO = '❄️ ─────────── ✦ ─────────── ❄️';
const ENFEITE_BASE = '❄️ ─────────── 🎄 ─────────── ❄️';

function somaDoCodigo(codigo) {
  const texto = String(codigo || '');
  let soma = 0;
  for (let i = 0; i < texto.length; i++) soma += texto.charCodeAt(i);
  return soma;
}

function enfeiteDoCodigo(codigo) {
  const soma = somaDoCodigo(codigo);
  return {
    cor: CORES_MURAL[soma % CORES_MURAL.length],
    saudacao: SAUDACOES_MURAL[soma % SAUDACOES_MURAL.length]
  };
}

// Capas de Natal: ficam na pasta imagens/, ao lado do index.js.
// A capa é sorteada pelo código da confissão (sempre a mesma para a mesma carta).
const PASTA_CAPAS = path.join(__dirname, 'imagens');
const NOMES_CAPAS = ['capa-natal-1.png', 'capa-natal-2.png', 'capa-natal-3.png', 'capa-natal-4.png'];
const CAPAS_DISPONIVEIS = NOMES_CAPAS.map(nome => ({ nome, caminho: path.join(PASTA_CAPAS, nome) }))
  .filter(capa => fs.existsSync(capa.caminho));
const bufferCapas = new Map();

if (CAPAS_DISPONIVEIS.length === 0) {
  console.warn(
    '[CAPAS] Nenhuma capa encontrada em imagens/. O mural continua funcionando, só não terá a faixa de Natal no topo.'
  );
}

// Devolve o arquivo da capa pronto para anexar (ou null se a pasta não existir)
function capaDoMural(codigo) {
  if (CAPAS_DISPONIVEIS.length === 0) return null;
  const capa = CAPAS_DISPONIVEIS[somaDoCodigo(codigo) % CAPAS_DISPONIVEIS.length];
  if (!bufferCapas.has(capa.nome)) {
    try {
      bufferCapas.set(capa.nome, fs.readFileSync(capa.caminho));
    } catch (erro) {
      console.warn(`[CAPAS] Não consegui ler ${capa.nome}:`, erro.message);
      return null;
    }
  }
  return { attachment: bufferCapas.get(capa.nome), name: capa.nome };
}

// ---------------------------------------------------------------------------
// Contagem regressiva: reedita o painel de cada servidor só quando o número de
// dias muda (uma edição por dia, no máximo — nada de ficar editando à toa)
// ---------------------------------------------------------------------------
const ultimaContagemDoPainel = new Map();

async function atualizarPaineisDeNatal(client) {
  // a chave inclui as duas contagens (Natal e Ano Novo), para o painel ser
  // reeditado também quando o campo do Ano Novo entra ou sai
  const texto = `${textoContagemNatal()}|${textoContagemAnoNovo() ?? ''}`;

  for (const guild of client.guilds.cache.values()) {
    try {
      const config = db.obterConfig(guild.id);
      if (!config || !config.canalPainelId || !config.painelMensagemId) continue;
      if (ultimaContagemDoPainel.get(guild.id) === texto) continue;

      const canal =
        guild.channels.cache.get(config.canalPainelId) ||
        (await guild.channels.fetch(config.canalPainelId).catch(() => null));
      if (!canal) continue;

      const mensagem = await canal.messages.fetch(config.painelMensagemId).catch(() => null);
      if (!mensagem) continue;

      await mensagem.edit(painelConfissoes());
      ultimaContagemDoPainel.set(guild.id, texto);
      console.log(`[NATAL] Painel de ${guild.name} atualizado: ${texto.replace('|', ' • ')}`);
    } catch (erro) {
      console.warn(`[NATAL] Não consegui atualizar a contagem em ${guild.name}:`, erro.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Recado de Feliz Natal no canal de aprovadas: sai uma vez por servidor, no dia
// 25 (a partir das 9h de Brasília). O ano do último recado fica salvo na
// configuração do servidor, então reiniciar o bot no dia 25 não repete a mensagem.
// ---------------------------------------------------------------------------
const servidoresComRecadoDeNatal = new Set();

async function enviarRecadoDeNatal(client, agora = new Date()) {
  if (!ehHoraDoRecadoDeNatal(agora)) return;
  const ano = dataNoBrasil(agora).ano;

  for (const guild of client.guilds.cache.values()) {
    if (servidoresComRecadoDeNatal.has(guild.id)) continue;

    try {
      const config = db.obterConfig(guild.id) || {};
      if (config.recadoNatalAno === ano) {
        servidoresComRecadoDeNatal.add(guild.id);
        continue;
      }

      const canal = resolverCanal(guild, 'publico');
      if (!canal) continue;

      await canal.send({ ...mensagemDeNatal(agora), allowedMentions: MENTIONS_NULAS });
      db.salvarConfig(guild.id, { ...config, recadoNatalAno: ano });
      servidoresComRecadoDeNatal.add(guild.id);
      console.log(`[NATAL] Recado de Feliz Natal enviado em ${guild.name} (#${canal.name}).`);
    } catch (erro) {
      console.warn(`[NATAL] Não consegui enviar o recado de Natal em ${guild.name}:`, erro.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Foto e figurinha (opcionais, enviadas junto da confissão)
// ---------------------------------------------------------------------------
const FOTO_MAX_BYTES = (Number.parseFloat(process.env.FOTO_MAX_MB ?? '8') || 8) * 1024 * 1024;
const TETO_DOWNLOAD_BYTES = Math.max(FOTO_MAX_BYTES, 25 * 1024 * 1024); // ao reaproveitar a foto da análise
const TIPOS_FOTO = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const CACHE_FIGURINHAS_MS = 5 * 60 * 1000;
const cacheFigurinhas = new Map(); // guildId -> { em, lista }

function lerSeguro(fn, padrao = null) {
  try {
    const valor = fn();
    return valor === undefined ? padrao : valor;
  } catch (_) {
    return padrao;
  }
}

// Figurinhas do servidor para o menu do formulário. O Discord só dá 3 s para abrir o formulário:
// por isso há cache de 5 min e um limite de 1,5 s (se a busca demorar, abre sem o menu desta vez).
async function figurinhasDoServidor(guild) {
  const guardado = cacheFigurinhas.get(guild.id);
  if (guardado && Date.now() - guardado.em < CACHE_FIGURINHAS_MS) return guardado.lista;

  const busca = guild.stickers.fetch().then(colecao => {
    const lista = [...colecao.values()]
      .filter(figurinha => figurinha.available !== false)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .slice(0, MAX_FIGURINHAS)
      .map(figurinha => ({ id: figurinha.id, name: figurinha.name, description: figurinha.description || '' }));
    cacheFigurinhas.set(guild.id, { em: Date.now(), lista });
    return lista;
  });

  let temporizador;
  const limite = new Promise(resolve => {
    temporizador = setTimeout(() => resolve(null), 1500);
  });
  try {
    const lista = await Promise.race([busca, limite]);
    return lista || (guardado ? guardado.lista : []);
  } catch (erro) {
    console.warn('[FIGURINHAS] Não consegui listar as figurinhas do servidor:', erro.message);
    return guardado ? guardado.lista : [];
  } finally {
    clearTimeout(temporizador);
  }
}

// Lê a foto escolhida no formulário e confere tipo e tamanho (o Discord não valida isso antes).
// Devolve { anexo: null } sem foto, { anexo, extensao } com foto válida ou { erro } para avisar a pessoa.
function lerFoto(interaction) {
  const arquivos = lerSeguro(() => interaction.fields.getUploadedFiles(ID_CAMPO_FOTO));
  let anexo = null;
  if (arquivos && typeof arquivos.first === 'function') anexo = arquivos.first() || null;
  else if (Array.isArray(arquivos)) anexo = arquivos[0] || null;
  if (!anexo) return { anexo: null };

  const tipo = String(anexo.contentType || '').split(';')[0].trim().toLowerCase();
  const extensao = TIPOS_FOTO[tipo];
  if (!extensao) {
    return { erro: 'A foto precisa ser uma imagem **PNG, JPG, GIF ou WEBP**. Tente de novo com outro arquivo.' };
  }
  if (anexo.size > FOTO_MAX_BYTES) {
    const maximo = Number((FOTO_MAX_BYTES / 1048576).toFixed(1));
    return { erro: `A foto é grande demais (máximo de **${maximo} MB**). Tente com uma menor.` };
  }
  return { anexo, extensao };
}

// Figurinha escolhida num dos menus (o Discord só deixa escolher entre as opções que o bot ofereceu)
function lerFigurinhaEscolhida(interaction) {
  for (const id of IDS_CAMPO_FIGURINHA) {
    const valores = lerSeguro(() => interaction.fields.getStringSelectValues(id), []);
    if (valores && valores.length) return valores[0];
  }
  return null;
}

async function baixarImagem(url, limiteBytes) {
  const resposta = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!resposta.ok) throw new Error(`download da imagem falhou (HTTP ${resposta.status})`);
  const buffer = Buffer.from(await resposta.arrayBuffer());
  if (buffer.length > limiteBytes) throw new Error('a imagem passou do tamanho máximo');
  return buffer;
}

// Se o envio com a figurinha falhar (ex.: ela foi apagada do servidor), tenta de novo sem ela:
// a confissão não pode ficar travada por causa de um enfeite.
async function enviarComFallback(canal, payload) {
  try {
    return { mensagem: await canal.send(payload), semFigurinha: false };
  } catch (erro) {
    if (!payload.stickers || !payload.stickers.length) throw erro;
    console.warn('[FIGURINHA] Envio com figurinha falhou, tentando sem ela:', erro.message);
    const { stickers, ...semFigurinha } = payload;
    return { mensagem: await canal.send(semFigurinha), semFigurinha: true };
  }
}

function checarLimites(userId) {
  const agora = Date.now();

  if (COOLDOWN_SEGUNDOS > 0) {
    const anterior = ultimoEnvio.get(userId) || 0;
    const esperar = COOLDOWN_SEGUNDOS * 1000 - (agora - anterior);
    if (esperar > 0) {
      return `❄️ Calma! Espere mais **${Math.ceil(esperar / 1000)}s** para enviar outra confissão.`;
    }
  }

  if (LIMITE_DIARIO > 0) {
    const enviadas = db.contarDoUsuarioDesde(userId, agora - 24 * 60 * 60 * 1000);
    if (enviadas >= LIMITE_DIARIO) {
      return `🎁 Você atingiu o limite de **${LIMITE_DIARIO} confissões** em 24h. Tente mais tarde.`;
    }
  }

  return null;
}

// Registro de decisões e consultas de autor (canal de logs escolhido por você). Nunca derruba o fluxo.
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
    conteudo = `🎁 Sua confissão foi aprovada em <#${canalPublico.id}>! Feliz Natal! 🎄\nCódigo: ${codigo}`;
    if (mensagemPublica && mensagemPublica.url) conteudo += ` • [ver publicação](${mensagemPublica.url})`;
  } else {
    conteudo = `🚫 Sua confissão foi recusada pela Gestão.\nCódigo: ${codigo}`;
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
// Interações: 2 slash commands (/configurar-confissoes e /autor-confissao) + botões/modal do painel
// ---------------------------------------------------------------------------
const AVISO_BOT_FORA_DO_SERVIDOR =
  'O bot não está como **membro** deste servidor, então não consegue funcionar aqui. ' +
  'Peça a um administrador para convidar o bot de novo com o escopo **bot** (o link está no README).';

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.inGuild()) return;

  // O Discord entrega o comando se o app foi autorizado só com "applications.commands",
  // mas sem o escopo "bot" o servidor não existe para o bot (interaction.guild fica null).
  if (!interaction.guild) {
    console.error(
      `[ERRO] O bot não está no servidor ${interaction.guildId}: convide com o escopo "bot" (e confira o GUILD_ID).`
    );
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: AVISO_BOT_FORA_DO_SERVIDOR, flags: EPHEMERAL });
      }
    } catch (_) {
      // interação expirou
    }
    return;
  }

  try {
    // 1. /configurar-confissoes — guarda os canais e o cargo Gestão e posta o painel (NÃO altera permissões de canais)
    if (interaction.isChatInputCommand() && interaction.commandName === 'configurar-confissoes') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
          content: 'Você precisa ser Administrador para usar este comando.',
          flags: EPHEMERAL
        });
      }
      return await configurarCanais(interaction);
    }

    // 2. Botão "Minhas Confissões" do painel — o autor acompanha seus códigos e status (só ele vê)
    if (interaction.isButton() && interaction.customId === ID_BOTAO_MINHAS) {
      const registros = db.listarDoUsuario(interaction.user.id, 10);

      if (!registros.length) {
        return await interaction.reply({
          content: '❄️ Você ainda não enviou nenhuma confissão. Clique em **Enviar Confissão** no painel. 🎁',
          flags: EPHEMERAL
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('🎁 Suas Confissões')
        .setColor(TEMA_NATAL.vermelho)
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
        .setFooter({ text: '❄️ Só você vê esta mensagem • Feliz Natal!' });

      return await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    }

    // 3. /autor-confissao — Gestão+ descobre o autor pelo código de rastreio
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
        .setColor(TEMA_NATAL.dourado)
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

    // 4. Botão "Enviar Confissão" do painel — abre o formulário
    if (interaction.isButton() && interaction.customId === ID_BOTAO_ENVIAR) {
      const figurinhas = await figurinhasDoServidor(interaction.guild);
      return await interaction.showModal(modalConfissao(figurinhas));
    }

    // 5. Formulário enviado — cria o registro e encaminha para o canal de análise
    if (interaction.isModalSubmit() && interaction.customId === ID_MODAL) {
      await interaction.deferReply({ flags: EPHEMERAL });

      const texto = interaction.fields.getTextInputValue(ID_CAMPO_TEXTO).trim();
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

      // Foto opcional: confere tipo e tamanho ANTES de gastar o cooldown da pessoa
      const foto = lerFoto(interaction);
      if (foto.erro) {
        return await interaction.editReply({ content: foto.erro });
      }
      const figurinhaEscolhida = lerFigurinhaEscolhida(interaction);

      // Reserva o cooldown AGORA (antes de qualquer await): dois envios simultâneos não passam juntos
      ultimoEnvio.set(userId, Date.now());

      // Baixa a foto (o Discord não entrega o arquivo no formulário). Falhou? Libera o cooldown.
      let bufferFoto = null;
      if (foto.anexo) {
        try {
          bufferFoto = await baixarImagem(foto.anexo.url, FOTO_MAX_BYTES);
        } catch (erro) {
          console.error('[ERRO] Não consegui baixar a foto da confissão:', erro.message);
          ultimoEnvio.delete(userId);
          return await interaction.editReply({
            content: 'Não consegui receber a sua foto. Tente de novo ou envie a confissão sem a foto.'
          });
        }
      }

      const registro = db.criarConfissao({
        userId,
        autorTag: interaction.user.tag,
        guildId: interaction.guild.id,
        texto,
        temFoto: Boolean(bufferFoto),
        figurinhaId: figurinhaEscolhida
      });

      // A descrição comporta 4096 caracteres (o campo "value" de embed só aguenta 1024).
      // O autor NÃO aparece aqui: só o código de rastreio, que remete ao banco.
      const embedAnalise = new EmbedBuilder()
        .setTitle('🎁 Nova Confissão para Análise ❄️')
        .setDescription(texto)
        .setColor(TEMA_NATAL.dourado)
        .setTimestamp()
        .addFields(
          { name: 'Código de rastreio', value: citarCodigo(registro.codigo), inline: true },
          {
            name: 'Enviada em',
            value: `<t:${Math.floor(registro.criadoEm / 1000)}:f>`,
            inline: true
          }
        )
        .setFooter({ text: '🎄 Autor oculto — use /autor-confissao com o código para identificar' });

      const rowAprovacao = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`aprovar_${registro.codigo}`)
          .setLabel('Aprovar')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🎁'),
        new ButtonBuilder()
          .setCustomId(`recusar_${registro.codigo}`)
          .setLabel('Recusar')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🚫')
      );

      const payloadAnalise = {
        embeds: [embedAnalise],
        components: [rowAprovacao],
        allowedMentions: MENTIONS_NULAS
      };
      if (bufferFoto) {
        // Nome neutro: o nome original do arquivo poderia entregar quem enviou
        const nomeFoto = `foto-${registro.codigo}.${foto.extensao}`;
        embedAnalise.setImage(`attachment://${nomeFoto}`);
        payloadAnalise.files = [{ attachment: bufferFoto, name: nomeFoto }];
      }
      if (figurinhaEscolhida) payloadAnalise.stickers = [figurinhaEscolhida];

      let semFigurinha = false;
      try {
        ({ semFigurinha } = await enviarComFallback(canalAnalise, payloadAnalise));
      } catch (erro) {
        console.error('[ERRO] Falha ao enviar para o canal de análise:', erro);
        // Desfaz: sem mensagem no canal não existe confissão (nada de pendente fantasma contando no limite)
        db.remover(registro.codigo);
        ultimoEnvio.delete(userId);
        return await interaction.editReply({
          content: 'Erro ao enviar sua confissão para análise. Tente novamente mais tarde.'
        });
      }
      if (semFigurinha) db.atualizar(registro.codigo, { figurinhaId: null });

      return await interaction.editReply({
        content:
          `🎄 Sua confissão foi enviada para análise. Guarde o código ${citarCodigo(registro.codigo)}.\n` +
          (semFigurinha ? 'A figurinha escolhida não está disponível, então ela foi enviada sem a figurinha.\n' : '') +
          'Você será avisado no PV quando a Gestão decidir (deixe suas mensagens diretas abertas) ' +
          'ou acompanhe pelo botão **Minhas Confissões** do painel. ❄️'
      });
    }

    // 6. Botões de aprovar/recusar — Gestão e cargos acima
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

          // Foto: pega de novo a que está na mensagem de análise (os links do Discord expiram)
          let arquivoFoto = null;
          if (registro.temFoto) {
            const anexo = interaction.message.attachments && interaction.message.attachments.first();
            try {
              if (!anexo) throw new Error('a foto não está mais na mensagem de análise');
              arquivoFoto = {
                attachment: await baixarImagem(anexo.url, TETO_DOWNLOAD_BYTES),
                name: anexo.name || `foto-${registro.codigo}.png`
              };
            } catch (erro) {
              console.error(`[ERRO] Não consegui carregar a foto da confissão ${codigo}:`, erro.message);
              return await interaction.followUp({
                content:
                  'Não consegui carregar a foto desta confissão, então ela **continua pendente**. ' +
                  'Tente aprovar de novo; se não funcionar, recuse.\n' +
                  `-# Detalhe: ${String((erro && erro.message) || erro).slice(0, 150)}`,
                flags: EPHEMERAL
              });
            }
          }

          // Cartão do mural: bem decorado, mas o texto da pessoa fica no centro das atenções
          const enfeite = enfeiteDoCodigo(registro.codigo);
          const embedPublico = new EmbedBuilder()
            .setAuthor({ name: '🎄 Correio de Natal — carta anônima' })
            .setTitle('🎁 Confissão Anônima')
            .setDescription(
              `${ENFEITE_TOPO}\n\n${registro.texto}\n\n${ENFEITE_BASE}\n-# ${enfeite.saudacao}`
            )
            .setColor(enfeite.cor)
            .addFields(
              {
                name: '🕯️ Publicada',
                value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                inline: true
              },
              {
                name: '🎄 Contagem de Natal',
                value: textoContagemNatal(),
                inline: true
              }
            )
            .setTimestamp()
            .setFooter({ text: `🎁 Código ${registro.codigo} • Feliz Natal!` });

          const payloadPublico = { embeds: [embedPublico], allowedMentions: MENTIONS_NULAS };
          if (arquivoFoto) {
            embedPublico.setImage(`attachment://${arquivoFoto.name}`);
            payloadPublico.files = [arquivoFoto];
          }
          if (registro.figurinhaId) payloadPublico.stickers = [registro.figurinhaId];

          // Faixa de Natal: vai numa mensagem logo acima do cartão (o Discord só desenha a imagem
          // do embed depois do texto, então a capa precisa de uma mensagem própria para ficar "no topo")
          let mensagemCapa = null;
          const capa = capaDoMural(codigo);
          if (capa) {
            try {
              mensagemCapa = await canalPublico.send({ files: [capa], allowedMentions: MENTIONS_NULAS });
            } catch (erro) {
              console.warn(`[CAPAS] Não consegui enviar a capa da confissão ${codigo}:`, erro.message);
            }
          }


          // Se o envio falhar, a confissão continua pendente (dá para tentar de novo)
          try {
            ({ mensagem: mensagemPublica } = await enviarComFallback(canalPublico, payloadPublico));
          } catch (erro) {
            console.error(`[ERRO] Não consegui publicar a confissão ${codigo} em #${canalPublico.name}:`, erro);
            // Não deixa a faixa de Natal sozinha no canal se o cartão não foi publicado
            if (mensagemCapa) {
              try {
                await mensagemCapa.delete();
              } catch (erroCapa) {
                console.warn('[CAPAS] Não consegui remover a capa órfã:', erroCapa.message);
              }
            }
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
            .setTitle(aprovando ? '🎁 Confissão Aprovada' : '🚫 Confissão Recusada')
            .setColor(aprovando ? TEMA_NATAL.verde : TEMA_NATAL.vermelho)
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
          `${aprovando ? '🎁 Aprovada' : '🚫 Recusada'} — ${citarCodigo(codigo)} por <@${interaction.user.id}>`
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

  // Contagem regressiva: mantém o painel com o número de dias certo
  // e manda o recado de Feliz Natal no dia 25 (uma vez só)
  await atualizarPaineisDeNatal(client);
  await enviarRecadoDeNatal(client);
  const relogioNatal = setInterval(() => {
    atualizarPaineisDeNatal(client);
    enviarRecadoDeNatal(client);
  }, 30 * 60 * 1000);
  relogioNatal.unref();

  // Presença com tema natalino (puro enfeite, não consome gateway: sem intent de presença)
  try {
    client.user.setPresence({
      status: 'online',
      activities: [{ name: '🎄 confissões de Natal', type: ActivityType.Watching }]
    });
  } catch (erro) {
    console.warn('[BOT] Não consegui definir a presença:', erro.message);
  }

  // Os nomes chegam um instante depois do READY; este log mostra em quais servidores o bot realmente está
  setTimeout(() => {
    const lista = client.guilds.cache.map(g => `${g.name} (${g.id})`).join(', ') || 'nenhum';
    console.log(`[BOT] Está em ${client.guilds.cache.size} servidor(es): ${lista}`);
    if (process.env.GUILD_ID && !client.guilds.cache.has(process.env.GUILD_ID)) {
      console.warn(
        `[AVISO] O bot NÃO está no servidor GUILD_ID=${process.env.GUILD_ID}. ` +
          'Convide o bot com o escopo "bot" (link no README) ou corrija o GUILD_ID.'
      );
    }
  }, 5000).unref();

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

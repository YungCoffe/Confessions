const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  FileUploadBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');

// ---------------------------------------------------------------------------
// Contagem regressiva de Natal (sempre pelo horário de Brasília, UTC-3,
// para o número não virar um dia antes/no meio da madrugada)
// ---------------------------------------------------------------------------
const FUSO_BRASILIA_MS = 3 * 60 * 60 * 1000;
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const NATAL_MES = 12;
const NATAL_DIA = 25;

// Hoje no horário de Brasília (mes: 1 = janeiro … 12 = dezembro)
function dataNoBrasil(agora = new Date()) {
  const brasilia = new Date(agora.getTime() - FUSO_BRASILIA_MS);
  return {
    ano: brasilia.getUTCFullYear(),
    mes: brasilia.getUTCMonth() + 1,
    dia: brasilia.getUTCDate(),
    hora: brasilia.getUTCHours()
  };
}

function diasParaNatal(agora = new Date()) {
  const { ano, mes, dia } = dataNoBrasil(agora);
  const hoje = Date.UTC(ano, mes - 1, dia);
  let natal = Date.UTC(ano, NATAL_MES - 1, NATAL_DIA);
  if (hoje > natal) natal = Date.UTC(ano + 1, NATAL_MES - 1, NATAL_DIA);
  return Math.round((natal - hoje) / UM_DIA_MS);
}

// Frase usada no painel e no cartão do mural
function textoContagemNatal(agora = new Date()) {
  const dias = diasParaNatal(agora);
  if (dias === 0) return '🎄 É hoje! Feliz Natal!';
  if (dias === 1) return '🎅 Falta 1 dia para o Natal!';
  return `🎅 Faltam ${dias} dias para o Natal!`;
}

// Contagem para o Ano Novo: só aparece em dezembro, junto com a do Natal.
// Fora de dezembro o campo nem entra no painel.
function textoContagemAnoNovo(agora = new Date()) {
  const { ano, mes, dia } = dataNoBrasil(agora);
  if (mes !== NATAL_MES) return null;

  const hoje = Date.UTC(ano, NATAL_MES - 1, dia);
  const anoNovo = Date.UTC(ano + 1, 0, 1);
  const dias = Math.round((anoNovo - hoje) / UM_DIA_MS);

  if (dias === 1) return '🎆 Falta 1 dia para o Ano Novo!';
  return `🎆 Faltam ${dias} dias para o Ano Novo!`;
}

// Recado de Feliz Natal: sai só no dia 25, a partir das 9h de Brasília,
// para não chegar de madrugada no canal de aprovadas
const HORA_DO_RECADO_DE_NATAL = 9;
const TITULO_RECADO_NATAL = '🎄 Feliz Natal! ❄️';

function ehHoraDoRecadoDeNatal(agora = new Date()) {
  const { mes, dia, hora } = dataNoBrasil(agora);
  return mes === NATAL_MES && dia === NATAL_DIA && hora >= HORA_DO_RECADO_DE_NATAL;
}

function mensagemDeNatal(agora = new Date()) {
  const embed = new EmbedBuilder()
    .setTitle(TITULO_RECADO_NATAL)
    .setDescription(
      '❄️ ─────────── ✦ ─────────── ❄️\n\n' +
        '**Hoje é 25 de dezembro — e o Correio de Natal veio desejar um Feliz Natal para todo o servidor!** 🎅\n\n' +
        '🎁 Que o seu dia tenha luz nas janelas, comida boa na mesa, música no fundo e aquela companhia ' +
        'que deixa o peito quentinho.\n' +
        '🕯️ Se este ano foi difícil, que hoje seja uma pausa gostosa. Se foi bom, que seja ainda melhor.\n' +
        '✨ Obrigado por estar aqui: cada confissão, cada palavra e cada figurinha deixou este cantinho mais bonito.\n\n' +
        '❄️ ─────────── 🎄 ─────────── ❄️\n' +
        '-# 🎅 Feliz Natal do Correio de Natal — e que venha um ano novo cheio de histórias para contar.'
    )
    .addFields({ name: '🎄 Contagem regressiva', value: textoContagemNatal(agora), inline: true })
    .setColor(TEMA_NATAL.dourado)
    .setFooter({ text: `🎁 Correio de Natal • 25 de dezembro de ${dataNoBrasil(agora).ano}` });

  return { embeds: [embed] };
}

// Paleta de Natal usada em todos os embeds do bot
const TEMA_NATAL = {
  vermelho: '#C62828',
  verde: '#1E7A46',
  dourado: '#F2C14E',
  gelo: '#8FD3E8'
};

const EMOJI_STATUS = { pendente: '⏳', aprovada: '🎁', recusada: '🚫' };

// IDs dos componentes (o botão antigo do painel continua funcionando com o mesmo ID)
const ID_BOTAO_ENVIAR = 'abrir_modal_confissao';
const ID_BOTAO_MINHAS = 'minhas_confissoes';
const ID_MODAL = 'modal_confissao';
const ID_CAMPO_TEXTO = 'texto_confissao';
const ID_CAMPO_FOTO = 'foto_confissao';
// Um menu aceita no máximo 25 opções; com mais figurinhas o formulário ganha um 2º menu (até 50 no total)
const IDS_CAMPO_FIGURINHA = ['figurinha_confissao', 'figurinha_confissao_2'];

const LIMITE_TEXTO = 2000;
const POR_MENU = 25;
const MAX_FIGURINHAS = POR_MENU * IDS_CAMPO_FIGURINHA.length;

function cortar(texto, limite) {
  const t = String(texto || '');
  return t.length > limite ? `${t.slice(0, limite - 1)}…` : t;
}

function painelConfissoes(agora = new Date()) {
  const contagemAnoNovo = textoContagemAnoNovo(agora);

  const embed = new EmbedBuilder()
    .setTitle('🎄 Painel de Confissões ❄️')
    .setDescription(
      '**Bem-vindo ao Correio de Natal do servidor!** 🎅\n\n' +
        '🎁 Clique em **Enviar Confissão** e escreva o que está guardado no peito — tudo de forma **100% anônima**.\n' +
        '📷 Quer caprichar? Você pode anexar uma **foto** ou escolher uma **figurinha do servidor** (é opcional).\n' +
        '🕵️ Toda confissão passa pela **Gestão e pelos cargos acima** antes de aparecer no mural.\n' +
        '🔔 Você recebe um **código de rastreio** e um aviso no **PV** quando ela for aprovada ou recusada ' +
        '(deixe suas mensagens diretas abertas).\n\n' +
        '❄️ Para consultar seus códigos e o status, clique em **Minhas Confissões**.'
    )
    .addFields(
      { name: '🎄 Contagem regressiva', value: textoContagemNatal(agora), inline: true },
      // em dezembro o painel ganha também a contagem para o Ano Novo
      ...(contagemAnoNovo ? [{ name: '🎆 Ano Novo', value: contagemAnoNovo, inline: true }] : [])
    )
    .setColor(TEMA_NATAL.vermelho)
    .setFooter({ text: '🎄 Anônimo, seguro e revisado pela Gestão • Feliz Natal!' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ID_BOTAO_ENVIAR)
      .setLabel('Enviar Confissão')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎁'),
    new ButtonBuilder()
      .setCustomId(ID_BOTAO_MINHAS)
      .setLabel('Minhas Confissões')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❄️')
  );

  return { embeds: [embed], components: [row] };
}

// figurinhas: [{ id, name, description }] do servidor (pode vir vazio: o formulário fica sem o menu)
function modalConfissao(figurinhas = []) {
  const inputTexto = new TextInputBuilder()
    .setCustomId(ID_CAMPO_TEXTO)
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Escreva aqui, com calma...')
    .setRequired(true)
    .setMaxLength(LIMITE_TEXTO);

  const modal = new ModalBuilder().setCustomId(ID_MODAL).setTitle('Sua Confissão de Natal');

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel(`Sua Confissão (até ${LIMITE_TEXTO} caracteres)`)
      .setTextInputComponent(inputTexto)
  );

  // Opcional: uma imagem que vai junto da confissão
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Foto (opcional)')
      .setDescription('Se quiser, mande uma imagem junto: PNG, JPG, GIF ou WEBP')
      .setFileUploadComponent(
        new FileUploadBuilder()
          .setCustomId(ID_CAMPO_FOTO)
          .setMinValues(0)
          .setMaxValues(1)
          .setRequired(false)
      )
  );

  // Opcional: uma figurinha do próprio servidor
  const lista = figurinhas.slice(0, MAX_FIGURINHAS);
  for (let i = 0; i * POR_MENU < lista.length; i++) {
    const grupo = lista.slice(i * POR_MENU, (i + 1) * POR_MENU);

    const menu = new StringSelectMenuBuilder()
      .setCustomId(IDS_CAMPO_FIGURINHA[i])
      .setPlaceholder('Escolher figurinha (ou deixe em branco)')
      .setRequired(false)
      .setMinValues(0)
      .setMaxValues(1)
      .addOptions(
        grupo.map(f => {
          const opcao = new StringSelectMenuOptionBuilder().setLabel(cortar(f.name, 100)).setValue(f.id);
          return f.description ? opcao.setDescription(cortar(f.description, 100)) : opcao;
        })
      );

    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel(i === 0 ? 'Figurinha do servidor (opcional)' : 'Mais figurinhas (opcional)')
        .setDescription(
          i === 0
            ? 'Se quiser, escolha uma figurinha para ir junto da confissão'
            : 'Mais figurinhas do servidor (escolha só uma no total)'
        )
        .setStringSelectMenuComponent(menu)
    );
  }

  return modal;
}

module.exports = {
  TEMA_NATAL,
  EMOJI_STATUS,
  ID_BOTAO_ENVIAR,
  ID_BOTAO_MINHAS,
  ID_MODAL,
  ID_CAMPO_TEXTO,
  ID_CAMPO_FOTO,
  IDS_CAMPO_FIGURINHA,
  MAX_FIGURINHAS,
  painelConfissoes,
  modalConfissao,
  textoContagemNatal,
  textoContagemAnoNovo,
  diasParaNatal,
  dataNoBrasil,
  ehHoraDoRecadoDeNatal,
  mensagemDeNatal,
  TITULO_RECADO_NATAL
};

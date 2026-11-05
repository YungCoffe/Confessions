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

const EMOJI_STATUS = { pendente: '⏳', aprovada: '✅', recusada: '❌' };

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

function painelConfissoes() {
  const embed = new EmbedBuilder()
    .setTitle('🔒 Painel de Confissões')
    .setDescription(
      'Clique em **Enviar Confissão** para mandar uma confissão de forma anônima.\n' +
        'Se quiser, você pode mandar uma **foto** ou uma **figurinha do servidor** junto (é opcional).\n' +
        'Tudo é analisado pela **Gestão e por cargos acima** antes de ser publicado.\n\n' +
        'Você recebe um **código de rastreio** e será avisado no **PV** quando ela for aprovada ou recusada ' +
        '(deixe suas mensagens diretas abertas). Para consultar seus códigos e o status, clique em ' +
        '**Minhas Confissões**.'
    )
    .setColor('#5865F2');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ID_BOTAO_ENVIAR)
      .setLabel('Enviar Confissão')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📝'),
    new ButtonBuilder()
      .setCustomId(ID_BOTAO_MINHAS)
      .setLabel('Minhas Confissões')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📨')
  );

  return { embeds: [embed], components: [row] };
}

// figurinhas: [{ id, name, description }] do servidor (pode vir vazio: o formulário fica sem o menu)
function modalConfissao(figurinhas = []) {
  const inputTexto = new TextInputBuilder()
    .setCustomId(ID_CAMPO_TEXTO)
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Escreva aqui...')
    .setRequired(true)
    .setMaxLength(LIMITE_TEXTO);

  const modal = new ModalBuilder().setCustomId(ID_MODAL).setTitle('Escreva sua Confissão');

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
  EMOJI_STATUS,
  ID_BOTAO_ENVIAR,
  ID_BOTAO_MINHAS,
  ID_MODAL,
  ID_CAMPO_TEXTO,
  ID_CAMPO_FOTO,
  IDS_CAMPO_FIGURINHA,
  MAX_FIGURINHAS,
  painelConfissoes,
  modalConfissao
};

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const EMOJI_STATUS = { pendente: '⏳', aprovada: '✅', recusada: '❌' };

// IDs dos componentes (o botão antigo do painel continua funcionando com o mesmo ID)
const ID_BOTAO_ENVIAR = 'abrir_modal_confissao';
const ID_BOTAO_MINHAS = 'minhas_confissoes';
const ID_MODAL = 'modal_confissao';
const ID_CAMPO_TEXTO = 'texto_confissao';
const ID_CAMPO_MENSAGEM = 'mensagem_confissao';

const LIMITE_TEXTO = 2000;
const LIMITE_MENSAGEM = 1000; // cabe no campo de embed (máx. 1024)

function painelConfissoes() {
  const embed = new EmbedBuilder()
    .setTitle('🔒 Painel de Confissões')
    .setDescription(
      'Clique em **Enviar Confissão** para mandar uma confissão de forma anônima.\n' +
        'Se quiser, você pode mandar uma **mensagem junto** da confissão (é opcional).\n' +
        'Ela será analisada pela **Gestão e por cargos acima** antes de ser publicada.\n\n' +
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

function modalConfissao() {
  const inputTexto = new TextInputBuilder()
    .setCustomId(ID_CAMPO_TEXTO)
    .setLabel(`Sua Confissão (até ${LIMITE_TEXTO} caracteres)`)
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Escreva aqui...')
    .setRequired(true)
    .setMaxLength(LIMITE_TEXTO);

  // Opcional: a pessoa só preenche se quiser mandar um recado junto da confissão
  const inputMensagem = new TextInputBuilder()
    .setCustomId(ID_CAMPO_MENSAGEM)
    .setLabel('Mensagem junto da confissão (opcional)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Quer mandar um recado junto? Escreva aqui (pode deixar em branco)')
    .setRequired(false)
    .setMaxLength(LIMITE_MENSAGEM);

  return new ModalBuilder()
    .setCustomId(ID_MODAL)
    .setTitle('Escreva sua Confissão')
    .addComponents(
      new ActionRowBuilder().addComponents(inputTexto),
      new ActionRowBuilder().addComponents(inputMensagem)
    );
}

module.exports = {
  EMOJI_STATUS,
  ID_BOTAO_ENVIAR,
  ID_BOTAO_MINHAS,
  ID_MODAL,
  ID_CAMPO_TEXTO,
  ID_CAMPO_MENSAGEM,
  painelConfissoes,
  modalConfissao
};

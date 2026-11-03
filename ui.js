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

module.exports = { EMOJI_STATUS, painelConfissoes, modalConfissao };

const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle 
} = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.guild) return;

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setup-confissao') {
      const embed = new EmbedBuilder()
        .setTitle('🔒 Painel de Confissões')
        .setDescription('Clique no botão abaixo para enviar uma confissão de forma anônima.\nSua confissão passará por análise antes de ser publicada.')
        .setColor('#5865F2');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_modal_confissao')
          .setLabel('Enviar Confissão')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📝')
      );

      await interaction.reply({ content: 'Painel criado!', ephemeral: true });
      await interaction.channel.send({ embeds: [embed], components: [row] });
    }
  }

  if (interaction.isButton() && interaction.customId === 'abrir_modal_confissao') {
    const modal = new ModalBuilder()
      .setCustomId('modal_confissao')
      .setTitle('Escreva sua Confissão');

    const inputTexto = new TextInputBuilder()
      .setCustomId('texto_confissao')
      .setLabel('Confissão (aceita nomes, @, #, etc.)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Escreva aqui tudo o que quiser...')
      .setRequired(true)
      .setMaxLength(2000);

    const row = new ActionRowBuilder().addComponents(inputTexto);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_confissao') {
    const texto = interaction.fields.getTextInputValue('texto_confissao');
    const canalAprovacao = interaction.guild.channels.cache.find(c => c.name === 'analise-confissoes' && c.isTextBased());

    if (!canalAprovacao) {
      return interaction.reply({ content: 'Erro: Crie um canal de texto chamado `analise-confissoes` neste servidor para enviar as análises.', ephemeral: true });
    }

    const embedAnalise = new EmbedBuilder()
      .setTitle('📩 Nova Confissão para Análise')
      .addFields(
        { name: 'Conteúdo', value: texto },
        { name: 'Autor (Visível apenas para a Gestão)', value: `${interaction.user.tag} (${interaction.user.id})` }
      )
      .setColor('#FEE75C')
      .setTimestamp();

    const rowAprovacao = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`aprovar_${interaction.user.id}`)
        .setLabel('Aprovar')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`recusar_${interaction.user.id}`)
        .setLabel('Recusar')
        .setStyle(ButtonStyle.Danger)
    );

    await canalAprovacao.send({ embeds: [embedAnalise], components: [rowAprovacao] });
    await interaction.reply({ content: 'Sua confissão foi enviada para a equipe de gestão e passará por análise.', ephemeral: true });
  }

  if (interaction.isButton() && (interaction.customId.startsWith('aprovar_') || interaction.customId.startsWith('recusar_'))) {
    const cargoGestao = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'gestão' || r.name.toLowerCase() === 'gestao');

    if (!cargoGestao || !interaction.member.roles.cache.has(cargoGestao.id)) {
      return interaction.reply({ content: 'Você não tem o cargo **Gestão** necessário para gerenciar confissões.', ephemeral: true });
    }

    const embedOriginal = interaction.message.embeds[0];
    const textoConfissao = embedOriginal.fields[0].value;

    if (interaction.customId.startsWith('aprovar_')) {
      const canalPublico = interaction.guild.channels.cache.find(c => c.name === 'confissoes' && c.isTextBased());

      if (!canalPublico) {
        return interaction.reply({ content: 'Erro: Canal público `confissoes` não encontrado neste servidor.', ephemeral: true });
      }

      const embedPublico = new EmbedBuilder()
        .setTitle('🗣️ Confissão Anônima')
        .setDescription(textoConfissao)
        .setColor('#57F287')
        .setTimestamp();

      await canalPublico.send({ embeds: [embedPublico] });

      const embedAtualizado = EmbedBuilder.from(embedOriginal)
        .setTitle('✅ Confissão Aprovada')
        .setColor('#57F287')
        .addFields({ name: 'Aprovado por', value: `${interaction.user.tag}` });

      await interaction.update({ embeds: [embedAtualizado], components: [] });
    } else if (interaction.customId.startsWith('recusar_')) {
      const embedAtualizado = EmbedBuilder.from(embedOriginal)
        .setTitle('❌ Confissão Recusada')
        .setColor('#ED4245')
        .addFields({ name: 'Recusado por', value: `${interaction.user.tag}` });

      await interaction.update({ embeds: [embedAtualizado], components: [] });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

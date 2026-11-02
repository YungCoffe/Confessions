const { 
  Client, 
  GatewayIntentBits, 
  Partials,
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle 
} = require('discord.js');
const http = require('http');
require('dotenv').config();

// Servidor HTTP leve para manter o Web Service ativo no Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot de Confissoes Ativo e Otimizado!\n');
}).listen(PORT);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel, Partials.Message],
  sweepers: {
    messages: {
      interval: 3600, // Limpa o cache de mensagens a cada 1 hora para poupar RAM
      lifetime: 1800
    }
  }
});

client.once('ready', () => {
  console.log(`[BOT ONLINE] Logado como ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.guild) return;

  try {
    // 1. Comando Slash: /setup-confissao
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-confissao') {
        if (!interaction.member.permissions.has('Administrator')) {
          return await interaction.reply({ content: 'Você precisa ser Administrador para usar este comando.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const embed = new EmbedBuilder()
          .setTitle('🔒 Painel de Confissões')
          .setDescription('Clique no botão abaixo para enviar uma confissão de forma anônima.\nSua confissão passará por análise da gestão antes de ser publicada.')
          .setColor('#5865F2');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('abrir_modal_confissao')
            .setLabel('Enviar Confissão')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📝')
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        return await interaction.editReply({ content: 'Painel de confissões criado com sucesso!' });
      }
    }

    // 2. Abertura do Modal de Confissão
    if (interaction.isButton() && interaction.customId === 'abrir_modal_confissao') {
      const modal = new ModalBuilder()
        .setCustomId('modal_confissao')
        .setTitle('Escreva sua Confissão');

      const inputTexto = new TextInputBuilder()
        .setCustomId('texto_confissao')
        .setLabel('Sua Confissão (nomes, @, # permitidos)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Escreva aqui...')
        .setRequired(true)
        .setMaxLength(2000);

      modal.addComponents(new ActionRowBuilder().addComponents(inputTexto));
      return await interaction.showModal(modal);
    }

    // 3. Submissão do Modal (Vai para o canal de análise)
    if (interaction.isModalSubmit() && interaction.customId === 'modal_confissao') {
      await interaction.deferReply({ ephemeral: true });

      const texto = interaction.fields.getTextInputValue('texto_confissao');
      const canalAprovacao = interaction.guild.channels.cache.find(c => c.name === 'analise-confissoes' && c.isTextBased());

      if (!canalAprovacao) {
        return await interaction.editReply({ content: 'Erro: Crie um canal de texto chamado `analise-confissoes` neste servidor.' });
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
        new ButtonBuilder().setCustomId(`aprovar_${interaction.user.id}`).setLabel('Aprovar').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`recusar_${interaction.user.id}`).setLabel('Recusar').setStyle(ButtonStyle.Danger)
      );

      await canalAprovacao.send({ embeds: [embedAnalise], components: [rowAprovacao] });
      return await interaction.editReply({ content: 'Sua confissão foi enviada para análise da gestão.' });
    }

    // 4. Botões de Aprovação/Recusa (Apenas cargo Gestão)
    if (interaction.isButton() && (interaction.customId.startsWith('aprovar_') || interaction.customId.startsWith('recusar_'))) {
      const cargoGestao = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'gestão' || r.name.toLowerCase() === 'gestao');

      if (!cargoGestao || !interaction.member.roles.cache.has(cargoGestao.id)) {
        return await interaction.reply({ content: 'Você não tem permissão do cargo **Gestão**.', ephemeral: true });
      }

      await interaction.deferUpdate();

      const embedOriginal = interaction.message.embeds[0];
      const textoConfissao = embedOriginal.fields[0].value;

      if (interaction.customId.startsWith('aprovar_')) {
        const canalPublico = interaction.guild.channels.cache.find(c => c.name === 'confissoes' && c.isTextBased());

        if (!canalPublico) {
          return await interaction.followUp({ content: 'Erro: Canal público `confissoes` não encontrado.', ephemeral: true });
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

        await interaction.message.edit({ embeds: [embedAtualizado], components: [] });
      } else {
        const embedAtualizado = EmbedBuilder.from(embedOriginal)
          .setTitle('❌ Confissão Recusada')
          .setColor('#ED4245')
          .addFields({ name: 'Recusado por', value: `${interaction.user.tag}` });

        await interaction.message.edit({ embeds: [embedAtualizado], components: [] });
      }
    }

  } catch (error) {
    console.error('Erro na interação:', error);
  }
});

client.login(process.env.DISCORD_TOKEN);

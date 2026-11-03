const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

// Fonte única dos slash commands (usada pelo bot e pelo script de deploy)
module.exports = [
  new SlashCommandBuilder()
    .setName('configurar-confissoes')
    .setDescription('Escolha os canais e o cargo Gestão do sistema de confissões')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addChannelOption(option =>
      option
        .setName('canal-painel')
        .setDescription('Canal onde o painel com o botão de enviar confissão será postado')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName('canal-analise')
        .setDescription('Canal onde as confissões chegam para Aprovar/Recusar (ficará privado)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName('canal-aprovadas')
        .setDescription('Canal onde as confissões aprovadas serão publicadas')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('cargo-gestao')
        .setDescription('Cargo Gestão: ele e todos acima veem a análise e aprovam/recusam')
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName('canal-logs')
        .setDescription('Opcional: canal privado com o registro de decisões e consultas de autor')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    ),
  new SlashCommandBuilder()
    .setName('setup-confissao')
    .setDescription('Envia o painel de confissões para este canal')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('confissao')
    .setDescription('Envia uma confissão anônima para a gestão analisar')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('minhas-confissoes')
    .setDescription('Mostra o código e o status das suas últimas confissões (só você vê)')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('autor-confissao')
    .setDescription('Mostra quem enviou uma confissão pelo código (Gestão ou acima)')
    .addStringOption(option =>
      option
        .setName('codigo')
        .setDescription('Código de rastreio, ex.: 4K7P2M')
        .setRequired(true)
        .setMaxLength(20)
    )
    .setDMPermission(false)
].map(command => command.toJSON());

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// Fonte única dos slash commands (usada pelo bot e pelo script de deploy)
module.exports = [
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

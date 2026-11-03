const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

// Fonte única dos slash commands (usada pelo bot e pelo script de deploy)
module.exports = [
  new SlashCommandBuilder()
    .setName('configurar-confissoes')
    .setDescription('Cria e configura os canais e as permissões do sistema de confissões')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addRoleOption(option =>
      option
        .setName('cargo-gestao')
        .setDescription('Cargo Gestão: ele e os cargos acima aprovam/recusam e veem os canais privados')
    )
    .addRoleOption(option =>
      option
        .setName('cargo-membros')
        .setDescription('Opcional: só este cargo vê painel e canal público (@everyone = todos veem)')
    )
    .addChannelOption(option =>
      option
        .setName('canal-painel')
        .setDescription('Opcional: usar um canal já existente para o painel de envio')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addChannelOption(option =>
      option
        .setName('canal-analise')
        .setDescription('Opcional: usar um canal já existente para aprovar/recusar (ficará privado)')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addChannelOption(option =>
      option
        .setName('canal-publico')
        .setDescription('Opcional: usar um canal já existente para as confissões aprovadas')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addChannelOption(option =>
      option
        .setName('canal-logs')
        .setDescription('Opcional: usar um canal já existente para o registro de decisões (ficará privado)')
        .addChannelTypes(ChannelType.GuildText)
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

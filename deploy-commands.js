const { REST, Routes } = require('discord.js');
require('dotenv').config();
const commands = require('./commands');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('ERRO: defina DISCORD_TOKEN e CLIENT_ID no .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    // Com GUILD_ID os comandos aparecem na hora; sem ele, viram globais (até ~1h)
    const rota = GUILD_ID
      ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      : Routes.applicationCommands(CLIENT_ID);

    console.log(GUILD_ID ? 'Registrando comandos neste servidor...' : 'Registrando comandos globais...');
    await rest.put(rota, { body: commands });
    console.log('Comandos registrados com sucesso!');
  } catch (error) {
    console.error('Erro ao registrar comandos:', error);
    process.exitCode = 1;
  }
})();

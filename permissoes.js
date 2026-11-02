const { PermissionFlagsBits } = require('discord.js');

// Aceita "gestão", "gestao" e o nome definido em GESTAO_ROLE, com ou sem acento
function nomesAceitos() {
  const configurado = (process.env.GESTAO_ROLE || 'gestão').trim().toLowerCase();
  return new Set([configurado, 'gestão', 'gestao', configurado.normalize('NFD').replace(/[\u0300-\u036f]/g, '')]);
}

function cargoReferencia(guild) {
  const aceitos = nomesAceitos();
  return (
    guild.roles.cache.find(role => {
      const nome = role.name.trim().toLowerCase();
      return aceitos.has(nome) || aceitos.has(nome.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    }) || null
  );
}

// Aprova quem é Administrador ou tem o cargo Gestão (ou qualquer cargo acima dele)
function podeAprovar(member, guild) {
  if (!member) return false;

  if (member.permissions && typeof member.permissions.has === 'function') {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  }

  const referencia = cargoReferencia(guild);
  // Sem o cargo de referência, só Administrador aprova (evita liberar geral)
  if (!referencia) return false;

  return member.roles.cache.some(role => role.position >= referencia.position);
}

module.exports = { podeAprovar, cargoReferencia };

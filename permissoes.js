const { PermissionFlagsBits } = require('discord.js');
const db = require('./db');

function semAcento(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function nomeNormalizado(texto) {
  return semAcento(String(texto || '').trim().toLowerCase());
}

// Cargo "régua". Ordem de busca:
//   1) cargo salvo por /configurar-confissoes
//   2) GESTAO_ROLE_ID no .env
//   3) cargo pelo nome (GESTAO_ROLE, padrão "gestão"; aceita com ou sem acento)
function cargoReferencia(guild) {
  const configurado = db.obterConfig(guild.id).cargoGestaoId || process.env.GESTAO_ROLE_ID;
  if (configurado) {
    const cargo = guild.roles.cache.get(configurado);
    if (cargo && cargo.id !== guild.id) return cargo;
  }

  const aceitos = new Set([nomeNormalizado(process.env.GESTAO_ROLE || 'gestão'), 'gestao']);
  const candidatos = guild.roles.cache.filter(
    cargo => cargo.id !== guild.id && aceitos.has(nomeNormalizado(cargo.name))
  );
  // Se houver dois cargos com o mesmo nome, vale o mais alto (o mais restritivo)
  return candidatos.sort((a, b) => b.position - a.position).first() || null;
}

function posicoesDosCargos(member, guild) {
  const cargos = member.roles;
  if (cargos && cargos.cache) return cargos.cache.map(cargo => cargo.position);
  if (Array.isArray(cargos)) {
    return cargos.map(id => {
      const cargo = guild.roles.cache.get(id);
      return cargo ? cargo.position : -1;
    });
  }
  return [];
}

// Aprova/recusa e consulta autor: Administrador, Gestão ou qualquer cargo acima dela
function podeAprovar(interaction) {
  const { guild, member, memberPermissions } = interaction;

  if (memberPermissions && memberPermissions.has(PermissionFlagsBits.Administrator)) return true;
  if (!member) return false;

  const referencia = cargoReferencia(guild);
  // Sem o cargo de referência, só Administrador aprova (evita liberar geral)
  if (!referencia) return false;

  return posicoesDosCargos(member, guild).some(posicao => posicao >= referencia.position);
}

module.exports = { podeAprovar, cargoReferencia };

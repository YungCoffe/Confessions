const fs = require('fs');
const path = require('path');

// Banco em arquivo JSON: sem dependência nativa, funciona em qualquer host.
// Sustenta dezenas de milhares de confissões com gravação atômica e debounce.
const DIR_DADOS = process.env.DATA_DIR || path.join(__dirname, 'data');
const ARQUIVO = path.join(DIR_DADOS, 'confissoes.json');

const LIMITE_REGISTROS = Number.parseInt(process.env.DB_MAX_REGISTROS ?? '20000', 10) || 20000;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0, 1 (evita confusão)
const TAMANHO_CODIGO = 6;

let estado = { seq: 0, confissoes: {} };
let timerGravacao = null;

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------
function carregar() {
  try {
    fs.mkdirSync(DIR_DADOS, { recursive: true });
    const bruto = fs.readFileSync(ARQUIVO, 'utf8');
    const dados = JSON.parse(bruto);
    if (dados && typeof dados === 'object' && dados.confissoes) {
      estado = {
        seq: Number(dados.seq) || 0,
        confissoes: dados.confissoes
      };
    }
    console.log(`[DB] ${Object.keys(estado.confissoes).length} confissão(ões) carregada(s)`);
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      console.error('[DB] Arquivo ilegível, começando vazio:', erro.message);
      try {
        fs.renameSync(ARQUIVO, `${ARQUIVO}.corrompido-${Date.now()}`);
      } catch (_) {
        // sem permissão para renomear: segue sem dados antigos
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Gravação (debounce + arquivo temporário para não corromper em queda)
// ---------------------------------------------------------------------------
function gravarAgora() {
  try {
    fs.mkdirSync(DIR_DADOS, { recursive: true });
    const temporario = `${ARQUIVO}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(estado), 'utf8');
    fs.renameSync(temporario, ARQUIVO);
  } catch (erro) {
    console.error('[DB] Falha ao gravar banco:', erro.message);
  }
}

function agendarGravacao() {
  if (timerGravacao) return;
  timerGravacao = setTimeout(() => {
    timerGravacao = null;
    gravarAgora();
  }, 250);
  if (typeof timerGravacao.unref === 'function') timerGravacao.unref();
}

for (const sinal of ['SIGTERM', 'SIGINT', 'exit']) {
  process.on(sinal, () => {
    if (timerGravacao) {
      clearTimeout(timerGravacao);
      timerGravacao = null;
    }
    gravarAgora();
  });
}

// ---------------------------------------------------------------------------
// Códigos
// ---------------------------------------------------------------------------
function gerarCodigo() {
  for (let tentativa = 0; tentativa < 25; tentativa++) {
    let codigo = '';
    for (let i = 0; i < TAMANHO_CODIGO; i++) {
      codigo += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
    }
    if (!estado.confissoes[codigo]) return codigo;
  }
  throw new Error('Não foi possível gerar um código único');
}

function normalizar(codigo) {
  return String(codigo || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------
function criarConfissao({ userId, autorTag, guildId, texto }) {
  const codigo = gerarCodigo();
  estado.seq += 1;
  const registro = {
    codigo,
    seq: estado.seq,
    userId,
    autorTag, // vínculo com o autor: existe SOMENTE aqui, nunca no Discord
    guildId,
    texto,
    status: 'pendente', // pendente | aprovada | recusada
    criadoEm: Date.now(),
    decididoEm: null,
    decididoPor: null,
    decididoPorId: null
  };
  estado.confissoes[codigo] = registro;
  agendarGravacao();
  podar();
  return registro;
}

function buscar(codigo) {
  return estado.confissoes[normalizar(codigo)] || null;
}

function atualizar(codigo, patch) {
  const registro = buscar(codigo);
  if (!registro) return null;
  Object.assign(registro, patch);
  agendarGravacao();
  return registro;
}

function listarDoUsuario(userId, limite = 10) {
  return Object.values(estado.confissoes)
    .filter(r => r.userId === userId)
    .sort((a, b) => b.criadoEm - a.criadoEm)
    .slice(0, limite);
}

function contarDoUsuarioDesde(userId, desde) {
  let total = 0;
  for (const r of Object.values(estado.confissoes)) {
    if (r.userId === userId && r.criadoEm >= desde) total += 1;
  }
  return total;
}

function estatisticas() {
  const total = { pendente: 0, aprovada: 0, recusada: 0 };
  for (const r of Object.values(estado.confissoes)) {
    if (total[r.status] !== undefined) total[r.status] += 1;
  }
  return { total: Object.keys(estado.confissoes).length, ...total };
}

// Remove as mais antigas já decididas quando o banco passa do limite
function podar() {
  const codigos = Object.keys(estado.confissoes);
  if (codigos.length <= LIMITE_REGISTROS) return;

  const descartaveis = codigos
    .map(c => estado.confissoes[c])
    .filter(r => r.status !== 'pendente')
    .sort((a, b) => a.criadoEm - b.criadoEm);

  let excedente = codigos.length - LIMITE_REGISTROS;
  for (const registro of descartaveis) {
    if (excedente <= 0) break;
    delete estado.confissoes[registro.codigo];
    excedente -= 1;
  }
}

carregar();

module.exports = {
  criarConfissao,
  buscar,
  atualizar,
  listarDoUsuario,
  contarDoUsuarioDesde,
  estatisticas,
  gravarAgora,
  normalizar,
  ARQUIVO
};

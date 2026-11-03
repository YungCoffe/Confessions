const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Banco em arquivo, sem dependência nativa (funciona em qualquer host).
//
// Formato "append-only" (JSON Lines): cada mudança vira UMA linha anexada ao
// final do arquivo. Isso custa microssegundos por operação, não importa quantas
// confissões existam. O modelo anterior regravava o arquivo inteiro a cada
// mudança, bloqueando o bot em momentos de pico (e 250k membros geram pico).
//
// O arquivo é compactado sozinho quando acumula linhas demais.
// ---------------------------------------------------------------------------
const DIR_DADOS = process.env.DATA_DIR || path.join(__dirname, 'data');
const ARQUIVO = path.join(DIR_DADOS, 'confissoes.jsonl');
const ARQUIVO_V14 = path.join(DIR_DADOS, 'confissoes.json'); // formato da versão 1.4

const LIMITE_REGISTROS = Number.parseInt(process.env.DB_MAX_REGISTROS ?? '20000', 10) || 20000;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0, 1 (evita confusão)
const TAMANHO_CODIGO = 6;

const confissoes = new Map(); // codigo -> registro (ordem de inserção = ordem cronológica)
const porUsuario = new Map(); // userId -> Set de códigos (evita varrer tudo a cada envio)
const configs = new Map(); // guildId -> configuração dos canais/cargos
const contagem = { pendente: 0, aprovada: 0, recusada: 0 };

let fd = null;
let linhas = 0;
let avisouSemDisco = false;

// ---------------------------------------------------------------------------
// Índices em memória
// ---------------------------------------------------------------------------
function indexar(registro) {
  confissoes.set(registro.codigo, registro);
  let codigos = porUsuario.get(registro.userId);
  if (!codigos) {
    codigos = new Set();
    porUsuario.set(registro.userId, codigos);
  }
  codigos.add(registro.codigo);
  if (contagem[registro.status] !== undefined) contagem[registro.status] += 1;
}

function desindexar(registro) {
  confissoes.delete(registro.codigo);
  const codigos = porUsuario.get(registro.userId);
  if (codigos) {
    codigos.delete(registro.codigo);
    if (codigos.size === 0) porUsuario.delete(registro.userId);
  }
  if (contagem[registro.status] !== undefined) contagem[registro.status] -= 1;
}

function aplicar(op) {
  switch (op.op) {
    case 'c': {
      if (op.r && op.r.codigo && !confissoes.has(op.r.codigo)) indexar(op.r);
      break;
    }
    case 'u': {
      const registro = confissoes.get(op.k);
      if (!registro) break;
      const statusAntes = registro.status;
      Object.assign(registro, op.p);
      if (registro.status !== statusAntes) {
        if (contagem[statusAntes] !== undefined) contagem[statusAntes] -= 1;
        if (contagem[registro.status] !== undefined) contagem[registro.status] += 1;
      }
      break;
    }
    case 'd': {
      const registro = confissoes.get(op.k);
      if (registro) desindexar(registro);
      break;
    }
    case 'cfg': {
      if (op.g) configs.set(op.g, { ...(configs.get(op.g) || {}), ...op.p });
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------
function carregar() {
  try {
    fs.mkdirSync(DIR_DADOS, { recursive: true });
  } catch (erro) {
    console.error('[DB] Sem acesso à pasta de dados, rodando só em memória:', erro.message);
    return;
  }

  if (fs.existsSync(ARQUIVO)) {
    const bruto = fs.readFileSync(ARQUIVO, 'utf8');
    let invalidas = 0;
    for (const linha of bruto.split('\n')) {
      if (!linha) continue;
      linhas += 1;
      try {
        aplicar(JSON.parse(linha));
      } catch (_) {
        invalidas += 1; // normalmente só a última linha, se o processo caiu no meio da gravação
      }
    }
    if (invalidas) console.warn(`[DB] ${invalidas} linha(s) ilegível(is) ignorada(s)`);
  } else if (fs.existsSync(ARQUIVO_V14)) {
    migrarV14();
  }

  podar();
  console.log(`[DB] ${confissoes.size} confissão(ões) carregada(s)`);

  // Reescreve compactado: remove linhas obsoletas e deixa o arquivo íntegro
  compactar();
}

function migrarV14() {
  try {
    const dados = JSON.parse(fs.readFileSync(ARQUIVO_V14, 'utf8'));
    const lista = Object.values((dados && dados.confissoes) || {}).sort(
      (a, b) => (a.criadoEm || 0) - (b.criadoEm || 0)
    );
    for (const registro of lista) {
      if (registro && registro.codigo && registro.userId) indexar(registro);
    }
    fs.renameSync(ARQUIVO_V14, `${ARQUIVO_V14}.migrado`);
    console.log(`[DB] ${lista.length} confissão(ões) migrada(s) do formato antigo (v1.4)`);
  } catch (erro) {
    console.error('[DB] Não foi possível migrar o arquivo antigo:', erro.message);
  }
}

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------
function abrirArquivo() {
  try {
    fd = fs.openSync(ARQUIVO, 'a');
  } catch (erro) {
    fd = null;
    if (!avisouSemDisco) {
      avisouSemDisco = true;
      console.error('[DB] Não consegui abrir o arquivo de dados; as confissões ficam só em memória:', erro.message);
    }
  }
}

function anexar(op) {
  if (fd === null) return;
  try {
    fs.writeSync(fd, `${JSON.stringify(op)}\n`);
    linhas += 1;
  } catch (erro) {
    console.error('[DB] Falha ao gravar:', erro.message);
    return;
  }
  if (linhas > confissoes.size * 2 + 2000) compactar();
}

function linhasDoEstado() {
  const saida = [];
  for (const [g, p] of configs) saida.push(JSON.stringify({ op: 'cfg', g, p }));
  for (const registro of confissoes.values()) saida.push(JSON.stringify({ op: 'c', r: registro }));
  return saida;
}

// Reescreve o arquivo só com o estado atual (arquivo temporário + rename: não corrompe se cair)
function compactar() {
  const temporario = `${ARQUIVO}.tmp`;
  try {
    const todas = linhasDoEstado();
    const saida = fs.openSync(temporario, 'w');
    try {
      const LOTE = 500;
      for (let i = 0; i < todas.length; i += LOTE) {
        fs.writeSync(saida, `${todas.slice(i, i + LOTE).join('\n')}\n`);
      }
    } finally {
      fs.closeSync(saida);
    }

    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        // já fechado
      }
      fd = null;
    }
    fs.renameSync(temporario, ARQUIVO);
    linhas = todas.length;
  } catch (erro) {
    console.error('[DB] Falha ao compactar:', erro.message);
  } finally {
    if (fd === null) abrirArquivo();
  }
}

// ---------------------------------------------------------------------------
// Códigos
// ---------------------------------------------------------------------------
function gerarCodigo() {
  for (let tentativa = 0; tentativa < 25; tentativa++) {
    let codigo = '';
    for (let i = 0; i < TAMANHO_CODIGO; i++) {
      codigo += ALFABETO[crypto.randomInt(ALFABETO.length)];
    }
    if (!confissoes.has(codigo)) return codigo;
  }
  throw new Error('Não foi possível gerar um código único');
}

function normalizar(codigo) {
  return String(codigo || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// Confissões
// ---------------------------------------------------------------------------
function criarConfissao({ userId, autorTag, guildId, texto }) {
  const registro = {
    codigo: gerarCodigo(),
    userId,
    autorTag, // vínculo com o autor: existe SOMENTE aqui, nunca no canal de análise nem no público
    guildId,
    texto,
    status: 'pendente', // pendente | aprovada | recusada
    criadoEm: Date.now(),
    decididoEm: null,
    decididoPor: null,
    decididoPorId: null
  };
  indexar(registro);
  anexar({ op: 'c', r: registro });
  podar();
  return registro;
}

function buscar(codigo) {
  return confissoes.get(normalizar(codigo)) || null;
}

function atualizar(codigo, patch) {
  const registro = buscar(codigo);
  if (!registro) return null;
  const statusAntes = registro.status;
  Object.assign(registro, patch);
  if (registro.status !== statusAntes) {
    if (contagem[statusAntes] !== undefined) contagem[statusAntes] -= 1;
    if (contagem[registro.status] !== undefined) contagem[registro.status] += 1;
  }
  anexar({ op: 'u', k: registro.codigo, p: patch });
  return registro;
}

// Usado quando o envio ao canal de análise falha: não deixa registro "fantasma" pendente
function remover(codigo) {
  const registro = buscar(codigo);
  if (!registro) return false;
  desindexar(registro);
  anexar({ op: 'd', k: registro.codigo });
  return true;
}

function listarDoUsuario(userId, limite = 10) {
  const codigos = porUsuario.get(userId);
  if (!codigos) return [];
  return Array.from(codigos, c => confissoes.get(c))
    .sort((a, b) => b.criadoEm - a.criadoEm)
    .slice(0, limite);
}

function contarDoUsuarioDesde(userId, desde) {
  const codigos = porUsuario.get(userId);
  if (!codigos) return 0;
  let total = 0;
  for (const c of codigos) {
    if (confissoes.get(c).criadoEm >= desde) total += 1;
  }
  return total;
}

function estatisticas() {
  return { total: confissoes.size, ...contagem };
}

// Passou do limite: descarta as mais antigas já decididas (pendentes nunca saem).
// Não precisa gravar nada: a regra é determinística e roda de novo ao carregar.
function podar() {
  let excedente = confissoes.size - LIMITE_REGISTROS;
  if (excedente <= 0) return;
  for (const registro of confissoes.values()) {
    if (excedente <= 0) break;
    if (registro.status === 'pendente') continue;
    desindexar(registro);
    excedente -= 1;
  }
}

// ---------------------------------------------------------------------------
// Configuração por servidor (canais e cargos definidos por /configurar-confissoes)
// ---------------------------------------------------------------------------
function obterConfig(guildId) {
  return { ...(configs.get(guildId) || {}) };
}

function salvarConfig(guildId, patch) {
  configs.set(guildId, { ...(configs.get(guildId) || {}), ...patch });
  anexar({ op: 'cfg', g: guildId, p: patch });
}

carregar();

module.exports = {
  criarConfissao,
  buscar,
  atualizar,
  remover,
  listarDoUsuario,
  contarDoUsuarioDesde,
  estatisticas,
  obterConfig,
  salvarConfig,
  compactar,
  normalizar,
  ARQUIVO
};

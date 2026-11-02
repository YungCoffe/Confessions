const http = require('http');

// Servidor HTTP leve: mantém o Web Service do Render de pé e serve os links de
// monitoramento que você cola em sites de uptime (UptimeRobot, BetterStack etc.).
const PAGINA_STATUS = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bot de Confissões — Status</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,sans-serif;background:#1e1f22;color:#f2f3f5}
 .card{background:#2b2d31;padding:28px 32px;border-radius:16px;box-shadow:0 10px 30px #0006;min-width:300px}
 h1{font-size:17px;margin:0 0 18px;font-weight:600}
 .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#747f8d;margin-right:8px;vertical-align:middle}
 .dot.on{background:#57f287}
 .dot.off{background:#ed4245}
 dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:0;font-size:14px}
 dt{color:#b5bac1;text-align:right}
 dd{margin:0;text-align:left;font-weight:600;font-variant-numeric:tabular-nums}
 small{display:block;margin-top:16px;color:#949ba4;font-size:12px}
</style>
</head>
<body>
<div class="card">
 <h1><span id="dot" class="dot"></span><span id="estado">Verificando...</span></h1>
 <dl>
  <dt>Bot</dt><dd id="bot">—</dd>
  <dt>Ping</dt><dd id="ping">—</dd>
  <dt>Servidores</dt><dd id="servidores">—</dd>
  <dt>Confissões</dt><dd id="total">—</dd>
  <dt>Pendentes</dt><dd id="pendentes">—</dd>
  <dt>No ar há</dt><dd id="uptime">—</dd>
 </dl>
 <small>Atualiza sozinho a cada 15 segundos</small>
</div>
<script>
function formatar(segundos){
  var h = Math.floor(segundos / 3600);
  var m = Math.floor((segundos % 3600) / 60);
  return h > 0 ? h + "h " + m + "min" : m + "min";
}
async function atualizar(){
  try {
    var resposta = await fetch("/health", { cache: "no-store" });
    var dados = await resposta.json();
    document.getElementById("dot").className = "dot " + (dados.online ? "on" : "off");
    document.getElementById("estado").textContent = dados.online ? "Bot online" : "Bot iniciando";
    document.getElementById("bot").textContent = dados.bot || "—";
    document.getElementById("ping").textContent = dados.pingMs >= 0 ? dados.pingMs + " ms" : "—";
    document.getElementById("servidores").textContent = dados.servidores;
    document.getElementById("total").textContent = dados.confissoes.total;
    document.getElementById("pendentes").textContent = dados.confissoes.pendente;
    document.getElementById("uptime").textContent = formatar(dados.uptimeSegundos);
  } catch (erro) {
    document.getElementById("dot").className = "dot off";
    document.getElementById("estado").textContent = "Sem resposta";
  }
}
atualizar();
setInterval(atualizar, 15000);
</script>
</body>
</html>`;

function responder(res, status, tipo, corpo) {
  res.writeHead(status, {
    'Content-Type': tipo,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'
  });
  res.end(corpo);
}

function normalizarCaminho(url) {
  try {
    const caminho = new URL(url, 'http://localhost').pathname.toLowerCase();
    return caminho.replace(/\/+$/, '') || '/';
  } catch (_) {
    return '/';
  }
}

function iniciarServidor({ porta = 3000, status = () => ({}) } = {}) {
  const servidor = http.createServer((req, res) => {
    const caminho = normalizarCaminho(req.url);

    if (req.method === 'OPTIONS') return responder(res, 204, 'text/plain; charset=utf-8', '');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return responder(res, 405, 'text/plain; charset=utf-8', 'metodo nao permitido');
    }

    // Link mais leve possível para monitor de uptime: 200 + "pong"
    if (caminho === '/ping') return responder(res, 200, 'text/plain; charset=utf-8', 'pong');

    // Dados completos em JSON (usável via fetch no seu site)
    if (caminho === '/health' || caminho === '/status') {
      let dados = { status: 'erro' };
      try {
        dados = status();
      } catch (erro) {
        console.error('[HTTP] Falha ao montar status:', erro.message);
      }
      const corpo = JSON.stringify({ ...dados, horario: new Date().toISOString() });
      return responder(res, 200, 'application/json; charset=utf-8', corpo);
    }

    if (caminho === '/') return responder(res, 200, 'text/html; charset=utf-8', PAGINA_STATUS);

    return responder(res, 404, 'text/plain; charset=utf-8', 'not found');
  });

  servidor.listen(porta, () =>
    console.log(`[HTTP] No ar na porta ${porta} — links de monitoramento: /ping e /health`)
  );

  return servidor;
}

module.exports = { iniciarServidor };

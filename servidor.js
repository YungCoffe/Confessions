const http = require('http');

// Servidor HTTP leve: mantém o Web Service do Render de pé e serve os links de
// monitoramento que você cola em sites de uptime (UptimeRobot, BetterStack etc.).
const PAGINA_STATUS = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0a2417">
<title>Bot de Confissões — Feliz Natal</title>
<style>
 :root{
   color-scheme:dark;
   --vermelho:#c62828;
   --dourado:#f2c14e;
   --neve:#eaf6f0;
   --fraco:#9fbdae;
   --vidro:rgba(9,34,23,.72);
 }
 *{box-sizing:border-box}
 html,body{height:100%}
 body{
   margin:0;min-height:100vh;padding:34px 18px;display:grid;place-items:center;
   font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:var(--neve);
   background:
     radial-gradient(1100px 560px at 50% -18%, rgba(242,193,78,.18), transparent 62%),
     radial-gradient(760px 520px at 88% 112%, rgba(198,40,40,.26), transparent 66%),
     radial-gradient(600px 420px at 4% 96%, rgba(46,150,96,.22), transparent 70%),
     linear-gradient(180deg,#04110b 0%,#0a2417 46%,#061a14 100%);
   background-attachment:fixed;
   overflow-x:hidden;
 }
 .snow{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0}
 .flake{position:absolute;top:-8vh;color:#fff;line-height:1;opacity:.7;animation:fall linear infinite;will-change:transform}
 @keyframes fall{
   from{transform:translate3d(0,-10vh,0) rotate(0deg)}
   to{transform:translate3d(var(--drift,30px),112vh,0) rotate(360deg)}
 }
 .wrap{position:relative;z-index:1;width:100%;max-width:440px}
 .lights{display:flex;justify-content:center;gap:11px;margin:0 0 -7px;position:relative;z-index:2}
 .luz{width:9px;height:9px;border-radius:50%;background:var(--dourado);box-shadow:0 0 12px var(--dourado);animation:pisca 2.6s ease-in-out infinite}
 .luz:nth-child(3n){background:#ff7b6b;box-shadow:0 0 12px #ff7b6b}
 .luz:nth-child(3n+2){background:#7ee2a8;box-shadow:0 0 12px #7ee2a8}
 .luz:nth-child(2n){animation-delay:.7s}
 .luz:nth-child(4n){animation-delay:1.3s}
 @keyframes pisca{0%,100%{opacity:.4;transform:scale(.86)}50%{opacity:1;transform:scale(1.16)}}
 .card{
   position:relative;padding:26px 24px 20px;border-radius:22px;
   background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02)),var(--vidro);
   border:1px solid rgba(242,193,78,.32);
   box-shadow:0 26px 70px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.09);
   backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
 }
 .card:before{
   content:"";position:absolute;inset:6px;border-radius:16px;pointer-events:none;
   border:1px dashed rgba(242,193,78,.18);
 }
 .topo{display:flex;align-items:center;gap:14px;margin-bottom:16px}
 .arvore{
   flex:none;width:52px;height:52px;display:grid;place-items:center;font-size:26px;border-radius:16px;
   background:radial-gradient(circle at 30% 25%,rgba(242,193,78,.35),rgba(198,40,40,.35));
   border:1px solid rgba(242,193,78,.4);box-shadow:0 0 26px rgba(242,193,78,.22)
 }
 .tag{margin:0;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dourado);font-weight:700}
 h1{margin:3px 0 2px;font-size:19px;font-weight:700;letter-spacing:.2px}
 .sub{margin:0;font-size:11.5px;color:var(--fraco)}
 .pill{
   display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:12px;
   background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08);
   font-size:13px;font-weight:600;margin-bottom:16px
 }
 .dot{width:9px;height:9px;border-radius:50%;background:#8b9c93;flex:none;transition:background .3s}
 .dot.on{background:#57f287;box-shadow:0 0 0 4px rgba(87,242,135,.16);animation:brilha 2.2s ease-in-out infinite}
 .dot.off{background:#ed4245;box-shadow:0 0 0 4px rgba(237,66,69,.16)}
 @keyframes brilha{50%{box-shadow:0 0 0 7px rgba(87,242,135,.05)}}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
 .item{
   display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:13px;
   background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06)
 }
 .ico{font-size:15px;line-height:1;flex:none;opacity:.95}
 .rotulo{margin:0;font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--fraco)}
 .valor{margin:2px 0 0;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
 .rodape{
   margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08);
   display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;
   font-size:11px;color:var(--fraco)
 }
 .ho{color:var(--dourado);font-weight:700;letter-spacing:.04em}
 @media (max-width:360px){ .grid{grid-template-columns:1fr} h1{font-size:17px} }
 @media (prefers-reduced-motion:reduce){
   .snow{display:none}
   .luz,.dot.on{animation:none}
 }
</style>
</head>
<body>
<div class="snow" id="snow" aria-hidden="true"></div>
<div class="wrap">
 <div class="lights" aria-hidden="true">
  <span class="luz"></span><span class="luz"></span><span class="luz"></span><span class="luz"></span>
  <span class="luz"></span><span class="luz"></span><span class="luz"></span><span class="luz"></span>
  <span class="luz"></span>
 </div>
 <div class="card">
  <div class="topo">
   <div class="arvore" aria-hidden="true">🎄</div>
   <div>
    <p class="tag">Correio de Natal</p>
    <h1>Bot de Confissões</h1>
    <p class="sub">Confissões anônimas • revisadas pela Gestão</p>
   </div>
  </div>

  <div class="pill"><span id="dot" class="dot"></span><span id="estado">Verificando...</span></div>

  <div class="grid">
   <div class="item"><span class="ico">🤖</span><div><p class="rotulo">Bot</p><p class="valor" id="bot">—</p></div></div>
   <div class="item"><span class="ico">📶</span><div><p class="rotulo">Ping</p><p class="valor" id="ping">—</p></div></div>
   <div class="item"><span class="ico">🏠</span><div><p class="rotulo">Servidores</p><p class="valor" id="servidores">—</p></div></div>
   <div class="item"><span class="ico">🎁</span><div><p class="rotulo">Confissões</p><p class="valor" id="total">—</p></div></div>
   <div class="item"><span class="ico">⏳</span><div><p class="rotulo">Pendentes</p><p class="valor" id="pendentes">—</p></div></div>
   <div class="item"><span class="ico">🕯️</span><div><p class="rotulo">No ar há</p><p class="valor" id="uptime">—</p></div></div>
  </div>

  <div class="rodape">
   <span>❄️ Atualiza sozinho a cada 15 segundos</span>
   <span class="ho">Ho Ho Ho!</span>
  </div>
 </div>
</div>
<script>
(function montarNeve(){
  var ceu = document.getElementById("snow");
  if (!ceu || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var flocos = ["❄","❅","❆","•"];
  var total = window.innerWidth < 520 ? 26 : 46;
  for (var i = 0; i < total; i++) {
    var f = document.createElement("span");
    f.className = "flake";
    f.textContent = flocos[Math.floor(Math.random() * flocos.length)];
    f.style.left = (Math.random() * 100).toFixed(2) + "vw";
    f.style.fontSize = (7 + Math.random() * 11).toFixed(1) + "px";
    f.style.opacity = (0.25 + Math.random() * 0.55).toFixed(2);
    f.style.animationDuration = (9 + Math.random() * 13).toFixed(1) + "s";
    f.style.animationDelay = (-Math.random() * 22).toFixed(1) + "s";
    f.style.setProperty("--drift", (Math.random() * 90 - 45).toFixed(0) + "px");
    ceu.appendChild(f);
  }
})();

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
    document.getElementById("estado").textContent = dados.online ? "Bot online • tudo pronto para as confissões" : "Bot iniciando • acendendo as luzes";
    document.getElementById("bot").textContent = dados.bot || "—";
    document.getElementById("ping").textContent = dados.pingMs >= 0 ? dados.pingMs + " ms" : "—";
    document.getElementById("servidores").textContent = dados.servidores;
    document.getElementById("total").textContent = dados.confissoes.total;
    document.getElementById("pendentes").textContent = dados.confissoes.pendente;
    document.getElementById("uptime").textContent = formatar(dados.uptimeSegundos);
  } catch (erro) {
    document.getElementById("dot").className = "dot off";
    document.getElementById("estado").textContent = "Sem resposta • tentando de novo";
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

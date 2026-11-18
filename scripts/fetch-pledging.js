// Fetch promoter-pledging data for the Jhunjhunwala lens from Stocks Sena
// (https://www.stockssena.com/ — no login needed for the company pages).
// Rulebook v0.2: pledging < 5% OF PROMOTER HOLDING passes. Stocks Sena's
// number is exactly that denominator — verified 18 Nov 2026 against the
// Sep 2026 shareholding-pattern filings: ZEEL 5.38, ADANIENT 0.79,
// HINDZINC 4.12 (all % of promoter holding, not of total equity).
// Fetch method: GET https://www.stockssena.com/stocks/<SYM> with a browser
// User-Agent. The page carries an embedded JSON blob with promoterPct and
// pledgedPct (keys appear backslash-escaped in the HTML, e.g.
// pledgedPct\":5.38) plus visible "Pledged shares <n>" text as a
// cross-check. The /api/report?symbol= endpoint is DEAD without login
// (401) — do not use it.
// Usage: node scripts/fetch-pledging.js [--test] [--limit N]
//   [--stocks-file <path>] [--out <path>] [--partial <path>]
//   --test  : 5 stocks only (parser validation)
//   --limit N: first N stocks
//   --stocks-file <path>: JSON {stocks:[{sym,name}]} (default watchlist.json;
//     the Saturday union run passes union-stocks.json)
//   --out <path>: output JSON (default pledging.json)
//   --partial <path>: resume checkpoint (default pledging.partial.json)
// Resume: results are checkpointed to the partial file after each symbol;
// a re-run skips already-fetched symbols. Non-200 / missing field = missing
// (null), NEVER fail the run; coverage is printed at the end.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const args0 = process.argv.slice(2);
const sfIdx = args0.indexOf('--stocks-file');
const outIdx = args0.indexOf('--out');
const partIdx = args0.indexOf('--partial');
const limIdx = args0.indexOf('--limit');
function resolve(p, def) {
  if (!p) return path.join(DIR, def);
  return path.isAbsolute(p) ? p : path.join(DIR, p);
}
const STOCKS_FILE = resolve(sfIdx >= 0 ? args0[sfIdx + 1] : null, 'watchlist.json');
const OUT = resolve(outIdx >= 0 ? args0[outIdx + 1] : null, 'pledging.json');
const PARTIAL = resolve(partIdx >= 0 ? args0[partIdx + 1] : null, 'pledging.partial.json');
const LIMIT = limIdx >= 0 ? parseInt(args0[limIdx + 1], 10) : null;
const TEST = args0.includes('--test');
const DELAY_MS = 1000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function istNow() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function num(s) {
  if (s === null || s === undefined) return null;
  const v = parseFloat(String(s).replace(/,/g, '').trim());
  return Number.isFinite(v) ? v : null;
}

// Parse promoterPct / pledgedPct out of a Stocks Sena company page.
// Primary: the embedded JSON blob (keys backslash-escaped in the HTML).
// Fallback: the visible "Pledged shares <n>" text (pledgedPct only).
function parsePledging(html) {
  var promoterPct = null, pledgedPct = null;
  var m;
  // Escaped keys: pledgedPct\":5.38 (literal backslash + quote in the HTML).
  m = html.match(/promoterPct\\":\s*([0-9.]+)/);
  if (m) promoterPct = num(m[1]);
  m = html.match(/pledgedPct\\":\s*([0-9.]+)/);
  if (m) pledgedPct = num(m[1]);
  // Unescaped variants, in case the embed format changes.
  if (promoterPct === null) { m = html.match(/promoterPct":\s*([0-9.]+)/); if (m) promoterPct = num(m[1]); }
  if (pledgedPct === null) { m = html.match(/pledgedPct":\s*([0-9.]+)/); if (m) pledgedPct = num(m[1]); }
  // Fallback: visible text "Pledged shares 5.38".
  if (pledgedPct === null) {
    m = html.match(/Pledged shares\s+([0-9.]+)/);
    if (m) pledgedPct = num(m[1]);
  }
  return { promoterPct: promoterPct, pledgedPct: pledgedPct };
}

async function fetchOne(sym) {
  var lastErr = null;
  for (var a = 0; a < 2; a++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 20000);
      const res = await fetch('https://www.stockssena.com/stocks/' + encodeURIComponent(sym), {
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      });
      clearTimeout(timer);
      if (!res.ok) { lastErr = 'HTTP ' + res.status; continue; }
      const html = await res.text();
      return parsePledging(html);
    } catch (e) {
      lastErr = String((e && e.name) || e);
    }
    await sleep(500);
  }
  return { promoterPct: null, pledgedPct: null, error: lastErr };
}

async function main() {
  const all = JSON.parse(fs.readFileSync(STOCKS_FILE, 'utf8')).stocks;
  var todo = all.map(function (s) { return s.sym; });
  if (TEST) todo = todo.slice(0, 5);
  else if (LIMIT) todo = todo.slice(0, LIMIT);
  // Resume from partial checkpoint.
  var done = {};
  try { done = JSON.parse(fs.readFileSync(PARTIAL, 'utf8')).stocks || {}; } catch (e) {}
  var remaining = todo.filter(function (s) { return !(s in done); });
  console.log('pledging: ' + todo.length + ' symbols, ' + Object.keys(done).length + ' already fetched, ' + remaining.length + ' to fetch');
  for (var i = 0; i < remaining.length; i++) {
    var sym = remaining[i];
    var r = await fetchOne(sym);
    done[sym] = { promoterPct: r.promoterPct, pledgedPct: r.pledgedPct };
    if (r.error) console.log('  ' + sym + ': MISSING (' + r.error + ')');
    fs.writeFileSync(PARTIAL, JSON.stringify({ updated: istNow(), stocks: done }, null, 1));
    await sleep(DELAY_MS);
  }
  var out = { fetchedAtIST: istNow(), source: 'stockssena', stocks: {} };
  for (var j = 0; j < todo.length; j++) {
    var s2 = todo[j];
    out.stocks[s2] = done[s2] || { promoterPct: null, pledgedPct: null };
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  try { fs.unlinkSync(PARTIAL); } catch (e) {}
  var withPledge = todo.filter(function (s) { return out.stocks[s].pledgedPct !== null && out.stocks[s].pledgedPct !== undefined; });
  var withPromoter = todo.filter(function (s) { return out.stocks[s].promoterPct !== null && out.stocks[s].promoterPct !== undefined; });
  var missing = todo.filter(function (s) { return out.stocks[s].pledgedPct === null || out.stocks[s].pledgedPct === undefined; });
  console.log('pledging: ' + withPledge.length + '/' + todo.length + ' with pledgedPct, ' + withPromoter.length + '/' + todo.length + ' with promoterPct');
  if (missing.length) console.log('missing pledgedPct: ' + missing.join(', '));
  console.log('wrote ' + OUT);
}

main().catch(function (e) { console.error(e); process.exit(1); });

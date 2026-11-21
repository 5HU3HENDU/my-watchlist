// Fetch promoter-pledging data for the Jhunjhunwala lens from Stocks Sena
// (https://www.stockssena.com/ — no login needed for the company pages).
// Since v20 the SAME page fetch also parses the bulk/block deals array
// (3-month net buy value, for the Sentiment sub-rank) — no extra
// requests, the deals fields ride along in pledging.json.
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

// Parse the bulk/block deals array out of the SAME Stocks Sena page
// (v20, Sentiment sub-rank). The page embeds `bulk\":[{date,
// client_name, buy_sell, quantity, price, trade_value_cr,
// record_type bulk|block}, ...]` — same escaped-JSON blob as the
// pledging fields. Returns the 3-month NET buy value in ₹cr (buys
// minus sells): most large-cap rows are paired transfers (same shares
// bought and sold the same day), so the net is ~0 for many stocks —
// that is a real 0, not missing data. A stock with NO deals in the
// last 3 months returns dealsHas3m: false (N/A in the rank, never 0).
// Insider trades (insider[]) are deliberately NOT parsed — too sparse
// and trivial to score (verified 21 Nov 2026).
function parseBulkDeals(html, fetchDate) {
  var empty = { dealsNet3m: null, dealsN3m: 0, dealsHas3m: false };
  // The page is a Next.js streamed page: a long JSON array (the bulk
  // array) can straddle self.__next_f.push chunk boundaries — the
  // raw-HTML bracket scan then stops at the first chunk's "])" and
  // yields a truncated, unparseable slice. RELIANCE lost its 8-Oct-2026
  // paired block deals exactly this way (its 18-row array spans two
  // chunks; the scan cut it mid-row at "trade_value_cr"). So first
  // reconstruct the flight payload: every push chunk's string payload,
  // JSON-parsed and concatenated in document order — the bulk array is
  // contiguous in the reconstruction. Falls back to the raw HTML scan
  // (short arrays fit in one chunk) if no bulk array is found there.
  var text = html, plain = false;
  try {
    var re = /self\.__next_f\.push\(\[1,("((?:\\.|[^"\\])*)")\]\)/g;
    var parts = [], m;
    while ((m = re.exec(html)) !== null) {
      try { parts.push(JSON.parse(m[1])); } catch (e) { /* skip bad chunk */ }
    }
    if (parts.length > 0) {
      var joined = parts.join('');
      if (joined.indexOf('"bulk":[') >= 0) { text = joined; plain = true; }
    }
  } catch (e) { text = html; plain = false; }
  var idx = text.indexOf(plain ? '"bulk":[' : 'bulk\\":[');
  if (idx < 0) { idx = text.indexOf('bulk":['); if (idx < 0) return empty; }
  var start = text.indexOf('[', idx);
  // Bracket scan (string-aware, \" is an escaped quote) to the matching
  // close bracket — safer than a regex over ~600KB of HTML.
  var depth = 0, inStr = false, esc = false, end = -1;
  for (var i = start; i < text.length; i++) {
    var ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return empty;
  var arr;
  try {
    var slice = text.slice(start, end + 1);
    // Raw-HTML fallback only: unescape \" and \\. The reconstructed
    // payload is already plain JSON — do not touch it.
    if (!plain) slice = slice.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    arr = JSON.parse(slice);
  } catch (e) { return empty; }
  if (!Array.isArray(arr)) return empty;
  var cutoff = new Date(fetchDate);
  cutoff.setMonth(cutoff.getMonth() - 3);
  var net = 0, n = 0;
  arr.forEach(function (r) {
    if (!r || !r.date) return;
    var d = new Date(r.date);
    if (isNaN(d.getTime()) || d < cutoff) return;
    var v = num(r.trade_value_cr);
    if (v === null && r.quantity !== null && r.quantity !== undefined && r.price !== null && r.price !== undefined) {
      v = num(r.quantity) * num(r.price) / 1e7; // ₹cr fallback
    }
    if (v === null) return;
    n++;
    if (String(r.buy_sell).toUpperCase() === 'BUY') net += v;
    else if (String(r.buy_sell).toUpperCase() === 'SELL') net -= v;
  });
  if (n === 0) return empty;
  return { dealsNet3m: Math.round(net * 100) / 100, dealsN3m: n, dealsHas3m: true };
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
      var parsed = parsePledging(html);
      parsed.deals = parseBulkDeals(html, new Date());
      return parsed;
    } catch (e) {
      lastErr = String((e && e.name) || e);
    }
    await sleep(500);
  }
  return { promoterPct: null, pledgedPct: null, deals: { dealsNet3m: null, dealsN3m: 0, dealsHas3m: false }, error: lastErr };
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
    done[sym] = { promoterPct: r.promoterPct, pledgedPct: r.pledgedPct,
      dealsNet3m: r.deals ? r.deals.dealsNet3m : null,
      dealsN3m: r.deals ? r.deals.dealsN3m : 0,
      dealsHas3m: r.deals ? r.deals.dealsHas3m : false };
    if (r.error) console.log('  ' + sym + ': MISSING (' + r.error + ')');
    fs.writeFileSync(PARTIAL, JSON.stringify({ updated: istNow(), stocks: done }, null, 1));
    await sleep(DELAY_MS);
  }
  var out = { fetchedAtIST: istNow(), source: 'stockssena', stocks: {} };
  for (var j = 0; j < todo.length; j++) {
    var s2 = todo[j];
    out.stocks[s2] = done[s2] || { promoterPct: null, pledgedPct: null, dealsNet3m: null, dealsN3m: 0, dealsHas3m: false };
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  try { fs.unlinkSync(PARTIAL); } catch (e) {}
  var withPledge = todo.filter(function (s) { return out.stocks[s].pledgedPct !== null && out.stocks[s].pledgedPct !== undefined; });
  var withPromoter = todo.filter(function (s) { return out.stocks[s].promoterPct !== null && out.stocks[s].promoterPct !== undefined; });
  var missing = todo.filter(function (s) { return out.stocks[s].pledgedPct === null || out.stocks[s].pledgedPct === undefined; });
  var withDeals = todo.filter(function (s) { return out.stocks[s].dealsHas3m; });
  console.log('pledging: ' + withPledge.length + '/' + todo.length + ' with pledgedPct, ' + withPromoter.length + '/' + todo.length + ' with promoterPct');
  console.log('deals: ' + withDeals.length + '/' + todo.length + ' with bulk/block deals in the last 3 months');
  if (missing.length) console.log('missing pledgedPct: ' + missing.join(', '));
  console.log('wrote ' + OUT);
}

main().catch(function (e) { console.error(e); process.exit(1); });

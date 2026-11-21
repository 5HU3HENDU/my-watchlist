// Fetch day delivery % from Trendlyne (v18) — the latest session's
// NSE+BSE delivery percentage per stock, for the Momentum sub-rank.
// Pipeline (verified 21 Nov 2026 with curl):
//   1. Sitemap: https://trendlyne.com/equity-sitemap-stocks.xml
//      lists every stock page (5,931 symbols) as
//      https://trendlyne.com/equity/<numeric-id>/<SYM>/<slug>/
//      — this is the symbol -> numeric-ID map (the ID is NOT
//      derivable from the symbol any other way). Covers 544/554 of
//      the union; the 10 missing (special-character symbols like M&M,
//      renamed ICICIPRULI, JBCHEPHARM, NSE) get no delivery data.
//   2. Delivery page: https://trendlyne.com/equity/delivery-analysis/<id>/<SYM>/<slug>/
//      (~96 KB, free, no login, curl-fetchable with a browser UA).
//      It embeds a Highcharts series "NSE+BSE Delivery Volume %"
//      with 30 daily values, oldest first — the LAST value is the
//      latest session's day delivery % (verified: TCS 26.9% for
//      20 Nov 2026, matching the stock page's "Daily Avg. Delivery
//      Volume %" cell; RELIANCE 49.0%, TATATECH 21.6% same session).
//      The page title carries the as-of date ("as of 21 Nov, 2026").
// Cadence: WEEKLY (Saturday job). The fetch is heavy (554 pages,
// ~15 min) — not cheap enough for the daily 16:45 job, and a weekly
// snapshot behaves like the other slow rank inputs (pledging, FII,
// vs 200-DMA). The rank uses the latest delivery % that exists.
// RATE LIMIT (learned 21 Nov 2026): Trendlyne starts returning HTTP
// 405 after ~130 rapid page fetches — a transient WAF block, not a
// dead endpoint (single curls and Node fetches return 200 again
// minutes later). So the pace is 2.5s between symbols, and a 405/429
// sleeps 30s before one retry instead of hammering 3 quick attempts.
// A symbol that still fails stores null and is retried on the next
// run (the partial skips only symbols already in it, so strip the
// error nulls from the partial before re-running).
// Usage: node scripts/fetch-delivery.js [--test] [--limit N]
//   [--symbols A,B,C] [--stocks-file <path>] [--out <path>]
//   [--partial <path>]
// Resume: results are checkpointed to the partial file after each
// symbol; a re-run skips already-fetched symbols. A symbol with no
// sitemap entry or no parseable series stores null — N/A, never
// invented.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const args0 = process.argv.slice(2);
const sfIdx = args0.indexOf('--stocks-file');
const outIdx = args0.indexOf('--out');
const partIdx = args0.indexOf('--partial');
const limIdx = args0.indexOf('--limit');
const symIdx = args0.indexOf('--symbols');
function resolve(p, def) {
  if (!p) return path.join(DIR, def);
  return path.isAbsolute(p) ? p : path.join(DIR, p);
}
const STOCKS_FILE = resolve(sfIdx >= 0 ? args0[sfIdx + 1] : null, 'union-stocks.json');
const OUT = resolve(outIdx >= 0 ? args0[outIdx + 1] : null, 'delivery.json');
const PARTIAL = resolve(partIdx >= 0 ? args0[partIdx + 1] : null, 'delivery.partial.json');
const LIMIT = limIdx >= 0 ? parseInt(args0[limIdx + 1], 10) : null;
const SYMBOLS = symIdx >= 0 ? args0[symIdx + 1].split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean) : null;
const TEST = args0.includes('--test');
const DELAY_MS = 2500;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const SITEMAP_URL = 'https://trendlyne.com/equity-sitemap-stocks.xml';

function istNow() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchText(url) {
  var lastErr = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 25000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' } });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = 'HTTP ' + res.status;
        // 405/429/403 = Trendlyne's transient rate-limit block: back
        // off 30s and retry once; hammering 3 quick attempts only
        // extends the block. Other statuses keep the short retry.
        if (res.status === 405 || res.status === 429 || res.status === 403) {
          if (attempt === 0) { await sleep(30000); continue; }
          break;
        }
        await sleep(1500); continue;
      }
      const txt = await res.text();
      if (!txt || txt.length < 100) { lastErr = 'empty body'; await sleep(1500); continue; }
      return txt;
    } catch (e) {
      lastErr = String((e && e.name) || e);
      await sleep(1500);
    }
  }
  throw new Error(lastErr || 'fetch failed');
}

// Sitemap -> {SYM: delivery-analysis URL}. The sitemap <loc> is the
// stock page; the delivery page inserts "delivery-analysis/" after
// "/equity/".
function parseSitemap(xml) {
  var map = {};
  var re = /<loc>(https:\/\/trendlyne\.com\/equity\/\d+\/[A-Z0-9]+\/[^<]+)<\/loc>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var url = m[1];
    var parts = url.split('/').filter(Boolean);
    var sym = parts[parts.length - 2];
    map[sym] = url.replace('/equity/', '/equity/delivery-analysis/');
  }
  return map;
}

// Delivery page -> {deliveryPct, asOf}. The "NSE+BSE Delivery Volume %"
// series has 30 daily values oldest first; the last is the latest
// session's day delivery %. asOf comes from the page title.
function parseDelivery(html) {
  var sm = html.match(/NSE\+BSE Delivery Volume %&quot;, &quot;data&quot;: \[([0-9., ]+)\]/);
  if (!sm) return { deliveryPct: null, asOf: null };
  var vals = sm[1].split(',').map(function (s) { return parseFloat(s.trim()); }).filter(function (v) { return !isNaN(v); });
  if (!vals.length) return { deliveryPct: null, asOf: null };
  var pct = vals[vals.length - 1];
  if (pct < 0 || pct > 100) return { deliveryPct: null, asOf: null };
  var am = html.match(/as of (\d{1,2} [A-Za-z]{3}, \d{4})/);
  return { deliveryPct: Math.round(pct * 10) / 10, asOf: am ? am[1] : null };
}

async function fetchOne(url) {
  try {
    var html = await fetchText(url);
    return { rec: parseDelivery(html), error: null };
  } catch (e) {
    return { rec: { deliveryPct: null, asOf: null }, error: String((e && e.message) || e) };
  }
}

async function main() {
  var all = JSON.parse(fs.readFileSync(STOCKS_FILE, 'utf8')).stocks;
  var todo = all.map(function (s) { return s.sym; });
  if (SYMBOLS) todo = SYMBOLS.filter(function (s) { return todo.indexOf(s) >= 0; });
  if (TEST) todo = todo.slice(0, 5);
  else if (LIMIT) todo = todo.slice(0, LIMIT);
  console.log('delivery: fetching sitemap...');
  var sitemap = await fetchText(SITEMAP_URL);
  var urlMap = parseSitemap(sitemap);
  console.log('delivery: sitemap has ' + Object.keys(urlMap).length + ' symbols');
  var done = {};
  try { done = JSON.parse(fs.readFileSync(PARTIAL, 'utf8')).stocks || {}; } catch (e) {}
  var remaining = todo.filter(function (s) { return !(s in done); });
  console.log('delivery: ' + todo.length + ' symbols, ' + Object.keys(done).length + ' already fetched, ' + remaining.length + ' to fetch');
  var nErr = 0, nNoMap = 0;
  for (var i = 0; i < remaining.length; i++) {
    var sym = remaining[i];
    var url = urlMap[sym];
    if (!url) { done[sym] = { deliveryPct: null, asOf: null }; nNoMap++; console.log('  ' + sym + ': no sitemap entry'); continue; }
    var r = await fetchOne(url);
    done[sym] = r.rec;
    if (r.error) { nErr++; console.log('  ' + sym + ': ERROR (' + r.error + ')'); }
    else if (r.rec.deliveryPct === null) console.log('  ' + sym + ': no delivery series');
    fs.writeFileSync(PARTIAL, JSON.stringify({ updated: istNow(), stocks: done }, null, 1));
    await sleep(DELAY_MS);
  }
  var out = { fetchedAtIST: istNow(), source: 'trendlyne', stocks: {} };
  for (var j = 0; j < todo.length; j++) out.stocks[todo[j]] = done[todo[j]] || { deliveryPct: null, asOf: null };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  try { fs.unlinkSync(PARTIAL); } catch (e) {}
  var withDel = todo.filter(function (s) { return out.stocks[s].deliveryPct !== null; });
  console.log('delivery: ' + withDel.length + '/' + todo.length + ' with day delivery %, ' + nNoMap + ' no sitemap entry, ' + nErr + ' errors');
  console.log('wrote ' + OUT);
}

main().catch(function (e) { console.error(e); process.exit(1); });

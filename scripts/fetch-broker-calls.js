// Fetch per-firm broker calls from Moneycontrol's brokerage-reports
// archive (v18) — firm + rating + target + date per stock, for the
// popup's Analysts section.
// Pipeline (verified 21 Nov 2026 with curl, TCS + TATATECH):
//   1. Autosuggest: https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?query=<SYM>&type=1
//      (browser UA + Referer; WITHOUT type=1 it returns an empty body.
//      The endpoint is flaky — it sometimes 302s or returns empty —
//      so retry up to 3 times.) Returns an HTML list; the hit whose
//      <span> reads "ISIN, SYM, BSE-code" is the stock. Its href
//      .../stockpricequote/<sector>/<slug>/<sc_id> gives the company
//      slug and Moneycontrol's internal sc_id (NOT the NSE symbol:
//      TCS -> TCS, TATATECH -> TTL01, RELIANCE -> RI).
//   2. Archive: https://www.moneycontrol.com/news/<slug>/brokerage-reports-<sc_id>-6months.html/page-1/
//      — free, no login, curl-fetchable. Page 1 = latest 25 items.
//      Each item's <p> reads e.g. "Geojit Financial Services is
//      bullish on Tata Consultancy Services has recommended buy rating
//      on the stock with a target price of Rs 2530 in its research
//      report dated October 14, 2026." (phrasing varies: "recommended
//      buy rating", "recommended Reduce rating", no "has".)
//   3. Keep ONLY verdicts from the LAST 3 MONTHS (from the fetch
//      date) — older calls are dropped at fetch time.
// Caveats: the archive is slightly thinner than the stock-page Broker
// Research table (e.g. Deven Choksey BUY 2,525 13 Oct 2026 is in the
// table but not the archive). Midcap coverage is thin; small caps
// 404 or come back empty — an empty list is data, never a failure.
// Usage: node scripts/fetch-broker-calls.js [--test] [--limit N]
//   [--symbols A,B,C] [--stocks-file <path>] [--out <path>]
//   [--partial <path>]
// Resume: results are checkpointed to the partial file after each
// symbol; a re-run skips already-fetched symbols.
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
const OUT = resolve(outIdx >= 0 ? args0[outIdx + 1] : null, 'broker-calls.json');
const PARTIAL = resolve(partIdx >= 0 ? args0[partIdx + 1] : null, 'broker-calls.partial.json');
const LIMIT = limIdx >= 0 ? parseInt(args0[limIdx + 1], 10) : null;
const SYMBOLS = symIdx >= 0 ? args0[symIdx + 1].split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean) : null;
const TEST = args0.includes('--test');
const DELAY_MS = 700;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const REF = 'https://www.moneycontrol.com/';

function istNow() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function fetchText(url, mustContain) {
  var lastErr = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 20000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Referer': REF, 'Accept': 'text/html,application/xhtml+xml' } });
      clearTimeout(timer);
      if (!res.ok) { lastErr = 'HTTP ' + res.status; await sleep(1500); continue; }
      const txt = await res.text();
      if (!txt || txt.length < 100) { lastErr = 'empty body'; await sleep(1500); continue; }
      // Moneycontrol is flaky: a 302 to a bot-check page still returns
      // 200 with a plausible body. mustContain rejects those pages so
      // the retry loop gets a real one.
      if (mustContain && txt.indexOf(mustContain) < 0) { lastErr = 'unexpected page (no ' + mustContain + ')'; await sleep(2000); continue; }
      return txt;
    } catch (e) {
      lastErr = String((e && e.name) || e);
      await sleep(1500);
    }
  }
  throw new Error(lastErr || 'fetch failed');
}

// Autosuggest -> {scId, slug} for a symbol. The hit whose <span> reads
// "ISIN, SYM, BSE-code" is the stock; fall back to the first hit.
function parseAutosuggest(html, sym) {
  var items = [];
  var re = /<li><a href="([^"]+)"[^>]*>([^<]*)<span>([^<]*)<\/span>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    items.push({ href: m[1], title: (m[2] || '').trim(), span: (m[3] || '').trim() });
  }
  if (!items.length) return null;
  var pick = null;
  for (var i = 0; i < items.length; i++) {
    var parts = items[i].span.split(',').map(function (s) { return s.trim(); });
    if (parts.length >= 2 && parts[1] === sym) { pick = items[i]; break; }
  }
  if (!pick) pick = items[0];
  var segs = pick.href.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  return { scId: segs[segs.length - 1], slug: segs[segs.length - 2] };
}

function normRating(raw) {
  var r = (raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  var map = {
    'buy': 'BUY', 'sell': 'SELL', 'hold': 'HOLD', 'reduce': 'REDUCE',
    'accumulate': 'ACCUMULATE', 'neutral': 'NEUTRAL',
    'underperform': 'UNDERPERFORM', 'overweight': 'OVERWEIGHT',
    'equal weight': 'EQUAL-WEIGHT', 'equal-weight': 'EQUAL-WEIGHT',
    'outperform': 'OUTPERFORM', 'marketperform': 'MARKETPERFORM',
  };
  return map[r] || r.toUpperCase();
}

function fmtDate(d) {
  return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear();
}

// Parse one archive page's <p> descriptions into calls.
// Returns [{firm, rating, target, date, dateObj}] newest first.
function parseArchive(html) {
  var out = [];
  var re = /<p>([^<]*research report dated[^<]*)<\/p>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var t = m[1].trim();
    var dm = t.match(/dated ([A-Za-z]+) (\d{1,2}), (\d{4})/);
    if (!dm) continue;
    var mi = MONTHS.indexOf(dm[1]);
    if (mi < 0) continue;
    var dateObj = new Date(parseInt(dm[3], 10), mi, parseInt(dm[2], 10));
    if (isNaN(dateObj.getTime())) continue;
    var tm = t.match(/target price of Rs ([0-9,]+)/);
    if (!tm) continue;
    var target = parseInt(tm[1].replace(/,/g, ''), 10);
    if (!target) continue;
    var rm = t.match(/recommended ([A-Za-z\- ]+?) rating/);
    if (!rm) continue;
    var rating = normRating(rm[1]);
    var fm = t.match(/^(.*?) is (?:bullish|bearish|neutral) on /) || t.match(/^(.*?) recommended /);
    if (!fm) continue;
    var firm = fm[1].trim();
    out.push({ firm: firm, rating: rating, target: target, date: fmtDate(dateObj), dateObj: dateObj });
  }
  // Dedupe identical firm+rating+target+date rows, keep first.
  var seen = {};
  out = out.filter(function (c) {
    var k = c.firm + '|' + c.rating + '|' + c.target + '|' + c.date;
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  });
  out.sort(function (a, b) { return b.dateObj - a.dateObj; });
  return out.map(function (c) { return { firm: c.firm, rating: c.rating, target: c.target, date: c.date }; });
}

async function fetchOne(sym, cutoff) {
  // Returns {calls, error}. An empty list is a valid result (no
  // coverage / no recent calls), never an error by itself.
  try {
    var sug = await fetchText('https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?query=' + encodeURIComponent(sym) + '&type=1', '<li');
    var id = parseAutosuggest(sug, sym);
    if (!id) return { calls: [], error: 'no autosuggest hit' };
    var url = 'https://www.moneycontrol.com/news/' + id.slug + '/brokerage-reports-' + id.scId + '-6months.html/page-1/';
    var html = await fetchText(url, 'brokerage');
    var all = parseArchive(html);
    var recent = all.filter(function (c) {
      var parts = c.date.split(' ');
      var d = new Date(parseInt(parts[2], 10), MONTHS_SHORT.indexOf(parts[1]), parseInt(parts[0], 10));
      return d >= cutoff;
    });
    return { calls: recent, error: null };
  } catch (e) {
    return { calls: [], error: String((e && e.message) || e) };
  }
}

async function main() {
  var all = JSON.parse(fs.readFileSync(STOCKS_FILE, 'utf8')).stocks;
  var todo = all.map(function (s) { return s.sym; });
  if (SYMBOLS) todo = SYMBOLS.filter(function (s) { return todo.indexOf(s) >= 0; });
  if (TEST) todo = todo.slice(0, 5);
  else if (LIMIT) todo = todo.slice(0, LIMIT);
  // 3-month cutoff from today (fetch date).
  var now = new Date();
  var cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  console.log('broker-calls: ' + todo.length + ' symbols, cutoff ' + fmtDate(cutoff));
  var done = {};
  try { done = JSON.parse(fs.readFileSync(PARTIAL, 'utf8')).stocks || {}; } catch (e) {}
  var remaining = todo.filter(function (s) { return !(s in done); });
  console.log('broker-calls: ' + Object.keys(done).length + ' already fetched, ' + remaining.length + ' to fetch');
  var nErr = 0;
  for (var i = 0; i < remaining.length; i++) {
    var sym = remaining[i];
    var r = await fetchOne(sym, cutoff);
    done[sym] = r.calls;
    if (r.error) { nErr++; console.log('  ' + sym + ': ERROR (' + r.error + ') — stored empty'); }
    else console.log('  ' + sym + ': ' + r.calls.length + ' recent call(s)');
    fs.writeFileSync(PARTIAL, JSON.stringify({ updated: istNow(), stocks: done }, null, 1));
    await sleep(DELAY_MS);
  }
  var out = { fetchedAtIST: istNow(), source: 'moneycontrol', stocks: {} };
  for (var j = 0; j < todo.length; j++) out.stocks[todo[j]] = done[todo[j]] || [];
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  try { fs.unlinkSync(PARTIAL); } catch (e) {}
  var withCalls = todo.filter(function (s) { return out.stocks[s].length > 0; });
  var total = todo.reduce(function (a, s) { return a + out.stocks[s].length; }, 0);
  console.log('broker-calls: ' + withCalls.length + '/' + todo.length + ' symbols with recent calls, ' + total + ' calls total, ' + nErr + ' errors');
  console.log('wrote ' + OUT);
}

main().catch(function (e) { console.error(e); process.exit(1); });

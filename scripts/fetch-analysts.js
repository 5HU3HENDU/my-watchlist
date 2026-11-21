// Fetch Yahoo analyst consensus for the Analysts View (v13) —
// recommendationTrend (buy/hold/sell counts per period) + financialData
// (mean rating, verdict key, average target) per symbol, via the
// quoteSummary API.
// THIS API NEEDS A CRUMB (verified 21 Nov 2026): GET https://fc.yahoo.com
// with a browser UA to set cookies, then GET
// https://query2.finance.yahoo.com/v1/test/getcrumb with the same cookies
// to get the crumb, then call quoteSummary with &crumb=<CRUMB>.
// Without a crumb the API returns {"error":{"code":"Unauthorized",
// "description":"Invalid Crumb"}}. A crumb can go stale mid-run — on
// "Invalid Crumb" the fetcher re-crumbs once and retries the symbol.
// Usage: node scripts/fetch-analysts.js [--test] [--limit N]
//   [--stocks-file <path>] [--out <path>] [--partial <path>]
//   --test  : 5 stocks only (crumb-flow validation)
//   --limit N: first N stocks
//   --stocks-file <path>: JSON {stocks:[{sym,name,exch}]} (default
//     union-stocks.json; exch NS -> .NS, BO -> .BO)
//   --out <path>: output JSON (default analysts.json)
//   --partial <path>: resume checkpoint (default analysts.partial.json)
// Resume: results are checkpointed to the partial file after each symbol;
// a re-run skips already-fetched symbols. A symbol with no consensus
// (empty result) stores nulls — N/A, never invented. A failed symbol
// logs and continues; the run still writes analysts.json with whatever
// was fetched. Coverage is printed at the end.
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
const STOCKS_FILE = resolve(sfIdx >= 0 ? args0[sfIdx + 1] : null, 'union-stocks.json');
const OUT = resolve(outIdx >= 0 ? args0[outIdx + 1] : null, 'analysts.json');
const PARTIAL = resolve(partIdx >= 0 ? args0[partIdx + 1] : null, 'analysts.partial.json');
const LIMIT = limIdx >= 0 ? parseInt(args0[limIdx + 1], 10) : null;
const TEST = args0.includes('--test');
const DELAY_MS = 700;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function istNow() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function raw(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return (v.raw !== null && v.raw !== undefined) ? v.raw : null;
  return v;
}

// Cookie jar: fc.yahoo.com sets cookies (notably the B cookie) that the
// crumb is tied to. Node's fetch has no jar, so collect set-cookie
// headers and send them back as a Cookie header.
var cookieHeader = '';
async function getCrumb() {
  const r1 = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
  });
  await r1.text();
  var cookies = [];
  if (typeof r1.headers.getSetCookie === 'function') cookies = r1.headers.getSetCookie();
  else { const sc = r1.headers.get('set-cookie'); if (sc) cookies = [sc]; }
  cookieHeader = cookies.map(function (c) { return c.split(';')[0]; }).join('; ');
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookieHeader },
  });
  if (!r2.ok) throw new Error('getcrumb HTTP ' + r2.status);
  const crumb = (await r2.text()).trim();
  if (!crumb) throw new Error('empty crumb');
  return crumb;
}

var CRUMB = null;
async function ensureCrumb() {
  if (!CRUMB) CRUMB = await getCrumb();
  return CRUMB;
}

// Parse one quoteSummary result into the analysts record. Nulls where
// Yahoo has nothing — never invented.
function parseConsensus(result) {
  var rec = {
    currentPrice: null, targetMeanPrice: null, targetHighPrice: null,
    targetLowPrice: null, recommendationMean: null, recommendationKey: null,
    numberOfAnalystOpinions: null, trend: [],
  };
  if (!result) return rec;
  var fd = result.financialData || {};
  rec.currentPrice = raw(fd.currentPrice);
  rec.targetMeanPrice = raw(fd.targetMeanPrice);
  rec.targetHighPrice = raw(fd.targetHighPrice);
  rec.targetLowPrice = raw(fd.targetLowPrice);
  rec.recommendationMean = raw(fd.recommendationMean);
  rec.recommendationKey = (typeof fd.recommendationKey === 'string') ? fd.recommendationKey : null;
  rec.numberOfAnalystOpinions = raw(fd.numberOfAnalystOpinions);
  var trend = (result.recommendationTrend && result.recommendationTrend.trend) || [];
  rec.trend = trend.map(function (t) {
    return {
      period: t.period || null,
      strongBuy: (t.strongBuy !== null && t.strongBuy !== undefined) ? t.strongBuy : null,
      buy: (t.buy !== null && t.buy !== undefined) ? t.buy : null,
      hold: (t.hold !== null && t.hold !== undefined) ? t.hold : null,
      sell: (t.sell !== null && t.sell !== undefined) ? t.sell : null,
      strongSell: (t.strongSell !== null && t.strongSell !== undefined) ? t.strongSell : null,
    };
  });
  return rec;
}

function hasAny(rec) {
  return rec.currentPrice !== null || rec.targetMeanPrice !== null ||
    rec.recommendationMean !== null || rec.numberOfAnalystOpinions !== null ||
    (rec.trend && rec.trend.length > 0);
}

async function fetchOne(yahooSym) {
  var lastErr = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      await ensureCrumb();
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 20000);
      const url = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/' +
        encodeURIComponent(yahooSym) + '?modules=recommendationTrend,financialData&crumb=' + encodeURIComponent(CRUMB);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Cookie': cookieHeader, 'Accept': 'application/json' },
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = 'HTTP ' + res.status;
        if (res.status === 429) await sleep(5000);
        continue;
      }
      const j = await res.json();
      var qs = j && j.quoteSummary;
      if (qs && qs.error) {
        var desc = String((qs.error && qs.error.description) || '');
        if (desc.indexOf('Invalid Crumb') >= 0 && attempt < 2) {
          // Crumb went stale mid-run — re-crumb and retry the symbol.
          CRUMB = null;
          await sleep(1000);
          continue;
        }
        lastErr = 'Yahoo error: ' + desc;
        continue;
      }
      var result = (qs && qs.result && qs.result[0]) || null;
      return { rec: parseConsensus(result), error: null };
    } catch (e) {
      lastErr = String((e && e.name) || e);
      await sleep(1000);
    }
  }
  return { rec: parseConsensus(null), error: lastErr };
}

async function main() {
  const all = JSON.parse(fs.readFileSync(STOCKS_FILE, 'utf8')).stocks;
  var todo = all.map(function (s) { return { sym: s.sym, exch: s.exch || 'NS' }; });
  if (TEST) todo = todo.slice(0, 5);
  else if (LIMIT) todo = todo.slice(0, LIMIT);
  // Resume from partial checkpoint.
  var done = {};
  try { done = JSON.parse(fs.readFileSync(PARTIAL, 'utf8')).stocks || {}; } catch (e) {}
  var remaining = todo.filter(function (s) { return !(s.sym in done); });
  console.log('analysts: ' + todo.length + ' symbols, ' + Object.keys(done).length + ' already fetched, ' + remaining.length + ' to fetch');
  for (var i = 0; i < remaining.length; i++) {
    var sym = remaining[i].sym;
    var yahooSym = sym + '.' + (remaining[i].exch === 'BO' ? 'BO' : 'NS');
    var r = await fetchOne(yahooSym);
    done[sym] = r.rec;
    if (r.error) console.log('  ' + sym + ': MISSING (' + r.error + ')');
    else if (!hasAny(r.rec)) console.log('  ' + sym + ': no consensus');
    fs.writeFileSync(PARTIAL, JSON.stringify({ updated: istNow(), stocks: done }, null, 1));
    await sleep(DELAY_MS);
  }
  var out = { fetchedAtIST: istNow(), source: 'yahoo', stocks: {} };
  for (var j = 0; j < todo.length; j++) {
    var s2 = todo[j].sym;
    out.stocks[s2] = done[s2] || parseConsensus(null);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  try { fs.unlinkSync(PARTIAL); } catch (e) {}
  var withConsensus = todo.filter(function (s) { return hasAny(out.stocks[s.sym]); });
  var with3plus = todo.filter(function (s) {
    var n = out.stocks[s.sym].numberOfAnalystOpinions;
    return n !== null && n !== undefined && n >= 3;
  });
  var none = todo.filter(function (s) { return !hasAny(out.stocks[s.sym]); });
  console.log('analysts: ' + withConsensus.length + '/' + todo.length + ' with consensus, ' + with3plus.length + ' with >=3 analysts, ' + none.length + ' with none');
  console.log('wrote ' + OUT);
}

main().catch(function (e) { console.error(e); process.exit(1); });

// Fetch Yahoo analyst consensus for the Analysts View (v13) —
// recommendationTrend (buy/hold/sell counts per period) + financialData
// (mean rating, verdict key, average target) per symbol, via the
// quoteSummary API. Since v20 the SAME call also fetches the
// `earnings` + `earningsTrend` modules — earnings surprise (actual vs
// estimate per quarter) and estimate revisions (up/down counts, 30d)
// for the Sentiment sub-rank — and writes them to sentiment.json
// alongside analysts.json. Same request, same run, ~zero marginal cost.
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
const OUT_SENT = resolve(null, 'sentiment.json');
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

// Parse the Sentiment inputs (v20) out of the same quoteSummary result:
// earnings surprise + estimate revisions. Yahoo does NOT return a
// surprisePct field (verified live 21 Nov 2026 — the field is absent),
// so surprisePct is computed here as (actual - estimate) / |estimate|
// x 100 per quarter; the samples match the source-check values exactly
// (TCS +1.1/-0.5/+2.5/+0.8%, TATATECH -66.45% in 4Q2025). A quarter
// with a missing actual/estimate or a zero estimate is skipped, never
// invented. Revisions use the 30-DAY window only — downLast90days is
// an empty object {} on every sample, so the 90d window is unusable.
function parseSentiment(result) {
  var out = {
    surpriseAvg: null, surpriseN: 0, surpriseLast: null,
    revNet30: null, revUp30: null, revDown30: null, estDrift30: null,
  };
  if (!result) return out;
  var quarterly = (result.earnings && result.earnings.earningsChart && result.earnings.earningsChart.quarterly) || [];
  var surprises = [];
  quarterly.forEach(function (q) {
    var actual = raw(q.actual), est = raw(q.estimate);
    var sp = null;
    if (q.surprisePct !== null && q.surprisePct !== undefined) {
      // Yahoo sends surprisePct as a STRING ("1.1"), not an object —
      // raw() returns the string, so parseFloat it (Number.isFinite
      // does not coerce strings, so a bare isFinite check would drop
      // every value — verified live 21 Nov 2026).
      var spRaw = raw(q.surprisePct);
      var spNum = (typeof spRaw === 'number') ? spRaw : parseFloat(spRaw);
      if (Number.isFinite(spNum)) sp = spNum;
    }
    if (sp === null && actual !== null && est !== null && est !== 0) sp = (actual - est) / Math.abs(est) * 100;
    // v21: cap each quarter's surprise at ±100% before averaging — a
    // near-zero estimate blows (actual − estimate) / |estimate| into
    // the thousands of percent (MFSL had one quarter at +232,900%,
    // DELTACORP averaged −6,803%). The cap is per quarter, so a
    // genuinely huge beat still reads as a large positive, just not a
    // nonsense one. The browser logic also caps the stored average as
    // a stopgap until this fetcher regenerates sentiment.json.
    if (sp !== null && Number.isFinite(sp)) surprises.push(Math.max(-100, Math.min(100, sp)));
  });
  if (surprises.length) {
    out.surpriseN = surprises.length;
    out.surpriseAvg = surprises.reduce(function (a, b) { return a + b; }, 0) / surprises.length;
    out.surpriseLast = surprises[surprises.length - 1];
  }
  var trend = (result.earningsTrend && result.earningsTrend.trend && result.earningsTrend.trend[0]) || null;
  if (trend) {
    var rev = trend.epsRevisions || {};
    var up = raw(rev.upLast30days), down = raw(rev.downLast30days);
    if (up !== null) out.revUp30 = up;
    if (down !== null) out.revDown30 = down;
    if (up !== null && down !== null) out.revNet30 = up - down;
    var et = trend.epsTrend || {};
    var cur = raw(et.current), ago30 = raw(et['30daysAgo']);
    if (cur !== null && ago30 !== null && ago30 !== 0) out.estDrift30 = (cur - ago30) / Math.abs(ago30) * 100;
  }
  return out;
}

function hasSentiment(s) {
  return s && (s.surpriseN > 0 || s.revNet30 !== null);
}

async function fetchOne(yahooSym) {
  var lastErr = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      await ensureCrumb();
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 20000);
      const url = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/' +
        encodeURIComponent(yahooSym) + '?modules=recommendationTrend,financialData,earnings,earningsTrend&crumb=' + encodeURIComponent(CRUMB);
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
      return { rec: parseConsensus(result), sent: parseSentiment(result), error: null };
    } catch (e) {
      lastErr = String((e && e.name) || e);
      await sleep(1000);
    }
  }
  return { rec: parseConsensus(null), sent: parseSentiment(null), error: lastErr };
}

async function main() {
  const all = JSON.parse(fs.readFileSync(STOCKS_FILE, 'utf8')).stocks;
  var todo = all.map(function (s) { return { sym: s.sym, exch: s.exch || 'NS' }; });
  if (TEST) todo = todo.slice(0, 5);
  else if (LIMIT) todo = todo.slice(0, LIMIT);
  // Resume from partial checkpoint. Partial entries are {a: consensus
  // rec, s: sentiment rec} since v20; a pre-v20 partial holds the bare
  // consensus rec — treat that as {a: rec, s: null} (sentiment refetched).
  var done = {};
  try {
    var rawDone = JSON.parse(fs.readFileSync(PARTIAL, 'utf8')).stocks || {};
    Object.keys(rawDone).forEach(function (k) {
      var e = rawDone[k];
      done[k] = (e && (e.a || e.s)) ? e : { a: e, s: null };
    });
  } catch (e) {}
  var remaining = todo.filter(function (s) { return !(s.sym in done) || !done[s.sym].s; });
  console.log('analysts: ' + todo.length + ' symbols, ' + Object.keys(done).length + ' already fetched, ' + remaining.length + ' to fetch');
  for (var i = 0; i < remaining.length; i++) {
    var sym = remaining[i].sym;
    var yahooSym = sym + '.' + (remaining[i].exch === 'BO' ? 'BO' : 'NS');
    var r = await fetchOne(yahooSym);
    done[sym] = { a: r.rec, s: r.sent };
    if (r.error) console.log('  ' + sym + ': MISSING (' + r.error + ')');
    else if (!hasAny(r.rec)) console.log('  ' + sym + ': no consensus');
    fs.writeFileSync(PARTIAL, JSON.stringify({ updated: istNow(), stocks: done }, null, 1));
    await sleep(DELAY_MS);
  }
  var out = { fetchedAtIST: istNow(), source: 'yahoo', stocks: {} };
  var outSent = { fetchedAtIST: istNow(), source: 'yahoo', stocks: {} };
  for (var j = 0; j < todo.length; j++) {
    var s2 = todo[j].sym;
    var e2 = done[s2] || { a: parseConsensus(null), s: parseSentiment(null) };
    out.stocks[s2] = e2.a || parseConsensus(null);
    outSent.stocks[s2] = e2.s || parseSentiment(null);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  fs.writeFileSync(OUT_SENT, JSON.stringify(outSent, null, 1));
  try { fs.unlinkSync(PARTIAL); } catch (e) {}
  var withConsensus = todo.filter(function (s) { return hasAny(out.stocks[s.sym]); });
  var with3plus = todo.filter(function (s) {
    var n = out.stocks[s.sym].numberOfAnalystOpinions;
    return n !== null && n !== undefined && n >= 3;
  });
  var none = todo.filter(function (s) { return !hasAny(out.stocks[s.sym]); });
  var withSurprise = todo.filter(function (s) { return outSent.stocks[s.sym].surpriseN > 0; });
  var withRevisions = todo.filter(function (s) { return outSent.stocks[s.sym].revNet30 !== null; });
  console.log('analysts: ' + withConsensus.length + '/' + todo.length + ' with consensus, ' + with3plus.length + ' with >=3 analysts, ' + none.length + ' with none');
  console.log('sentiment: ' + withSurprise.length + '/' + todo.length + ' with earnings surprise, ' + withRevisions.length + ' with estimate revisions');
  console.log('wrote ' + OUT + ' and ' + OUT_SENT);
}

main().catch(function (e) { console.error(e); process.exit(1); });

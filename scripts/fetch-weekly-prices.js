// Weekly price fetch for the investor lenses (v0.2): per-symbol volume +
// 1y closes for the 200-day average and the volume-spike check, plus
// USDINR=X (3mo) for the Druckenmiller rupee check. This is a WEEKLY
// fetch — it is NOT part of the daily 16:45 market refresh (which only
// does prices/dots). All values are anchored to the session in
// market-data.json (sessionDate), NOT to "today": the 200-DMA is the mean
// of the 200 closes ending on the session day, the volume is the session
// day's volume vs the mean of the prior 15 trading days.
// Yahoo caveat (verified): for very recently listed symbols, range=1y
// returns only the latest candle — so try 1y first, and if the series
// is too short, retry 3mo and keep whichever returns more candles.
// Output: weekly-prices.json. Usage: node scripts/fetch-weekly-prices.js [--stocks-file <path>]
//   --stocks-file <path>: JSON {stocks:[{sym,exch}]} instead of the default
//     union (Nifty 500 + My Watchlist, deduplicated by symbol; watchlist
//     entries win on name/exch, N500-only symbols are NSE). Pass
//     watchlist.json explicitly to fetch the 151 watchlist stocks only.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const md = JSON.parse(fs.readFileSync(path.join(DIR, 'market-data.json'), 'utf8'));
// Default universe: union of Nifty 500 + My Watchlist, deduplicated by
// symbol (watchlist entry wins when a symbol is in both).
function buildUnion() {
  const wl = JSON.parse(fs.readFileSync(path.join(DIR, 'watchlist.json'), 'utf8'));
  const fl = JSON.parse(fs.readFileSync(path.join(DIR, 'final-lists.json'), 'utf8'));
  const map = new Map();
  for (const s of wl.stocks) map.set(s.sym, { sym: s.sym, exch: s.exch });
  for (const sym of fl.indices.NIFTY500) if (!map.has(sym)) map.set(sym, { sym, exch: 'NS' });
  return [...map.values()].sort((a, b) => a.sym.localeCompare(b.sym));
}
const args0 = process.argv.slice(2);
const sfIdx = args0.indexOf('--stocks-file');
let stockList;
if (sfIdx >= 0) {
  stockList = JSON.parse(fs.readFileSync(args0[sfIdx + 1], 'utf8')).stocks;
} else {
  stockList = buildUnion();
}
const FETCH = stockList.map(w => ({ key: w.sym, ysym: w.sym + (w.exch === 'BO' ? '.BO' : '.NS') }));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const SESSION = md.sessionDate; // e.g. "13 Nov 2026"
function istNow() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}
function istDate(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
}
async function fetchChart(ysym, range) {
  const q = encodeURIComponent(ysym);
  for (const host of HOSTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(`https://${host}/v8/finance/chart/${q}?range=${range}&interval=1d`, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) continue;
      const j = await r.json();
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res) continue;
      return { res, host };
    } catch (e) { /* try next host */ }
  }
  return null;
}
// Candles with close + volume, sorted by time, nulls dropped — except the
// session candle, which is kept even with a null close so the caller can
// substitute the market-data.json close (Yahoo sometimes returns a null
// close for the session candle; dropping it made the whole symbol read
// as missing).
function parseCandles(res) {
  const ts = res.timestamp || [];
  const quo = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const closes = quo.close || [];
  const vols = quo.volume || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const nullClose = closes[i] === null || closes[i] === undefined;
    if (nullClose && istDate(ts[i]) !== SESSION) continue;
    out.push({ t: ts[i], c: nullClose ? null : closes[i], v: (vols[i] === null || vols[i] === undefined) ? null : vols[i] });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
async function main() {
  const stocks = {};
  const missing = [];
  const fallbackSyms = [];
  const CHUNK = 20;
  for (let i = 0; i < FETCH.length; i += CHUNK) {
    const chunk = FETCH.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map(async ({ key: sym, ysym }) => {
      let got = await fetchChart(ysym, '1y');
      let candles = got ? parseCandles(got.res) : [];
      // Recent listings: 1y can return a single candle — retry 3mo and
      // keep whichever series is longer.
      if (candles.length < 200) {
        const got2 = await fetchChart(ysym, '3mo');
        if (got2) {
          const c2 = parseCandles(got2.res);
          if (c2.length > candles.length) candles = c2;
        }
      }
      if (!candles.length) return { sym, ok: false };
      // Session anchor: the candle whose IST date is the session date.
      let si = -1;
      for (let k = candles.length - 1; k >= 0; k--) {
        if (istDate(candles[k].t) === SESSION) { si = k; break; }
      }
      if (si < 0) return { sym, ok: false, reason: 'no session candle' };
      // Session-close fallback: Yahoo sometimes returns a null close for
      // the session candle. Substitute the market-data.json close for the
      // same session (md.stocks[sym].p) so the DMA still computes; volume
      // stays null, so the Axelrod volume check falls back to the daily
      // market-data ratio (m.v).
      let sessionCloseFallback = false;
      if (candles[si].c === null || candles[si].c === undefined) {
        const fb = md.stocks[sym] && md.stocks[sym].p;
        if (fb === null || fb === undefined) return { sym, ok: false, reason: 'no session close' };
        candles[si].c = fb;
        sessionCloseFallback = true;
      }
      const closesToSession = candles.slice(0, si + 1).map(c => c.c);
      const dma200 = closesToSession.length >= 200
        ? closesToSession.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
      const vol = sessionCloseFallback ? null : candles[si].v;
      const priorVols = candles.slice(Math.max(0, si - 15), si).map(c => c.v).filter(v => v !== null);
      const volAvg15 = priorVols.length >= 5
        ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length : null;
      return {
        sym, ok: true, sessionCloseFallback,
        dma200: dma200 === null ? null : Math.round(dma200 * 100) / 100,
        vol: vol === null ? null : vol,
        volAvg15: volAvg15 === null ? null : Math.round(volAvg15),
        volN: priorVols.length,
        closes: closesToSession.length,
      };
    }));
    for (const r of results) {
      if (!r.ok) { missing.push(r.sym); continue; }
      if (r.sessionCloseFallback) fallbackSyms.push(r.sym);
      stocks[r.sym] = { dma200: r.dma200, vol: r.vol, volAvg15: r.volAvg15, volN: r.volN, closes: r.closes };
    }
    await new Promise(res => setTimeout(res, 150));
  }
  // Rupee check: USDINR=X 3mo, session-anchored — the close ~3 months
  // before the session vs the session close. Strengthening = down.
  let rupee = { from: null, to: null, pct: null, strengthening: null };
  const fx = await fetchChart('USDINR=X', '3mo');
  if (fx) {
    const candles = parseCandles(fx.res);
    let si = -1;
    for (let k = candles.length - 1; k >= 0; k--) {
      if (istDate(candles[k].t) === SESSION) { si = k; break; }
    }
    if (si >= 0 && candles[si].c !== null && candles[si].c !== undefined) {
      const to = candles[si].c;
      const from = candles[0].c; // first candle of the 3mo window (~3 months back)
      rupee = {
        from: Math.round(from * 100) / 100,
        to: Math.round(to * 100) / 100,
        pct: Math.round((to / from - 1) * 10000) / 100,
        strengthening: to < from,
        fromDate: istDate(candles[0].t),
        toDate: istDate(candles[si].t),
      };
    }
  }
  const out = {
    version: 1,
    fetchedAtIST: istNow(),
    sessionDate: SESSION,
    source: 'Yahoo Finance (NSE feed) via query1/query2 — weekly lens fetch, not the daily refresh',
    rupee,
    stocks,
    missing,
    sessionCloseFallback: fallbackSyms,
  };
  fs.writeFileSync(path.join(DIR, 'weekly-prices.json'), JSON.stringify(out, null, 1));
  const withDma = Object.values(stocks).filter(s => s.dma200 !== null).length;
  const withVol = Object.values(stocks).filter(s => s.vol !== null && s.volAvg15 !== null).length;
  console.log(`done: ${Object.keys(stocks).length}/${FETCH.length} fetched, ${missing.length} missing`);
  if (fallbackSyms.length) console.log(`session-close fallback (market-data.json close, vol null): ${fallbackSyms.length} — ${fallbackSyms.join(',')}`);
  console.log(`200-DMA: ${withDma} | volume ratio: ${withVol}`);
  console.log('rupee:', JSON.stringify(rupee));
  if (missing.length) console.log('missing:', missing.join(','));
  if (stocks.TCS) console.log('check TCS:', JSON.stringify(stocks.TCS));
  if (stocks.TONBO) console.log('check TONBO:', JSON.stringify(stocks.TONBO));
}
main().catch(e => { console.error('WEEKLY PRICES FETCH FAILED:', e); process.exit(1); });

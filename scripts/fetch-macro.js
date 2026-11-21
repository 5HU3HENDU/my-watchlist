// Fetch the macro header values for the lens page (v20): India VIX,
// USD/INR, and the India 10-year G-sec yield. Tiny fetches — three
// calls per run, wired into the DAILY 16:45 market-data job (not the
// Saturday weekly job: these move every session).
//   VIX ^INDIAVIX + INR=X: Yahoo chart API (query1/query2), last close
//     of the 5-day series. Yahoo 429s transiently — retry with backoff.
//   India 10y yield: Yahoo has NO working symbol (^IND10Y / IN10Y
//     return "No data found"; ^TNX is the US 10y). The free CSV from
//     macrofinance.ai works (no key): date,close series, last row =
//     latest close. It is a WordPress admin-ajax endpoint — if it
//     breaks, the header shows VIX + rupee only, never a made-up yield.
// Output macro.json: {fetchedAtIST, vix, usdinr, yield10y, yieldDate,
// source}. Any single value may be null (header hides that piece). If
// ALL three fail, the script exits non-zero and writes nothing — the
// daily job logs it and continues without pushing macro.json, and the
// page header stays hidden.
// Usage: node scripts/fetch-macro.js [--out <path>] (default macro.json)
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const args0 = process.argv.slice(2);
const outIdx = args0.indexOf('--out');
const OUT = outIdx >= 0 ? (path.isAbsolute(args0[outIdx + 1]) ? args0[outIdx + 1] : path.join(DIR, args0[outIdx + 1])) : path.join(DIR, 'macro.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function istNow() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchChart(sym) {
  // Last close of the 5-day daily series (last non-null close).
  for (var a = 0; a < 3; a++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 15000);
      const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=5d&interval=1d', {
        signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      });
      clearTimeout(timer);
      if (!res.ok) { await sleep(5000 * (a + 1)); continue; }
      const j = await res.json();
      var r = j && j.chart && j.chart.result && j.chart.result[0];
      var closes = (r && r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
      for (var i = closes.length - 1; i >= 0; i--) {
        if (closes[i] !== null && closes[i] !== undefined) return closes[i];
      }
      return null;
    } catch (e) { await sleep(5000 * (a + 1)); }
  }
  return null;
}

async function fetchYield10y() {
  // Free CSV, no key: date,close series; last row = latest close.
  for (var a = 0; a < 2; a++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 15000);
      const res = await fetch('https://macrofinance.ai/wp-admin/admin-ajax.php?action=mf_history&symbol=Y.IN.10Y&format=csv&years=1', {
        signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/csv' },
      });
      clearTimeout(timer);
      if (!res.ok) { await sleep(5000); continue; }
      const txt = await res.text();
      var lines = txt.trim().split('\n').filter(function (l) { return l.indexOf(',') >= 0 && !l.toLowerCase().startsWith('date'); });
      if (!lines.length) return { yield10y: null, yieldDate: null };
      var last = lines[lines.length - 1].split(',');
      var v = parseFloat(last[1]);
      return { yield10y: Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null, yieldDate: last[0] || null };
    } catch (e) { await sleep(5000); }
  }
  return { yield10y: null, yieldDate: null };
}

async function main() {
  var vix = await fetchChart('^INDIAVIX');
  await sleep(2000);
  var usdinr = await fetchChart('INR=X');
  var y = await fetchYield10y();
  var out = {
    fetchedAtIST: istNow(),
    source: 'yahoo+macrofinance.ai',
    vix: (vix === null || vix === undefined) ? null : Math.round(vix * 100) / 100,
    usdinr: (usdinr === null || usdinr === undefined) ? null : Math.round(usdinr * 100) / 100,
    yield10y: y.yield10y,
    yieldDate: y.yieldDate,
  };
  if (out.vix === null && out.usdinr === null && out.yield10y === null) {
    console.error('macro: all three sources failed — writing nothing');
    process.exit(1);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('macro: VIX ' + out.vix + ', USDINR ' + out.usdinr + ', 10y ' + out.yield10y + (out.yieldDate ? ' (' + out.yieldDate + ')' : ''));
  console.log('wrote ' + OUT);
}

main().catch(function (e) { console.error(e); process.exit(1); });

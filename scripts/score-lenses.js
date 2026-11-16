// Score the investor lenses — rulebook v0.2 for My watchlist (151),
// rulebook v0.1 for the Nifty 500 tab (unchanged).
//
// lens.json versioning (per-scope, decided in the v0.2 build): the file
// carries TWO namespaces, each self-contained:
//   lens.json.watchlist — rulebook "0.2", 7 lenses, the 151 watchlist
//     stocks, freshly scored here from fundamentals-v2.json (Screener,
//     weekly, extended fields) + market-data.json (session prices) +
//     weekly-prices.json (volume / 200-DMA / rupee).
//   lens.json.n500 — rulebook "0.1", 6 lenses, copied VERBATIM from the
//     previous lens.json (v0.1). The 402 N500-only stocks are NOT
//     re-scored; the 93 watchlist names that are also in the N500 keep
//     their v0.1 verdicts here and their v0.2 verdicts in the watchlist
//     namespace. The page reads the namespace of the active tab.
// Rules: investor-lens-rulebook-v02-DRAFT.md (APPROVED, Shiva 2026-11-16).
// Lynch D/E ≤1, Marks D/E ≤0.5 (confirmed). Pledging SKIPPED (no source)
// — Jhunjhunwala scores out of 3, flagged, settings note on the page.
// N/A handling (v0.2): an N/A check is skipped (not pass/fail); the green
// threshold drops by one per N/A check; red stays ≤1; if more than half
// a lens's checks are N/A, the lens shows NO verdict (grey
// "insufficient data"). A missing value still FAILS its check (v0.1 rule).
// Debt checks are N/A for Financial Services stocks (sector from
// sectors.json — D/E is meaningless for banks/NBFCs/exchanges/AMCs;
// leverage is the business). Thin-history flag carries over.
// Inputs: fundamentals-v2.json + market-data.json + weekly-prices.json
//   + sectors.json + the previous lens.json (n500 copy).
// Output: lens.json (v2). Usage: node scripts/score-lenses.js
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const fund2 = JSON.parse(fs.readFileSync(path.join(DIR, 'fundamentals-v2.json'), 'utf8'));
const md = JSON.parse(fs.readFileSync(path.join(DIR, 'market-data.json'), 'utf8'));
const wp = JSON.parse(fs.readFileSync(path.join(DIR, 'weekly-prices.json'), 'utf8'));
const sectors = JSON.parse(fs.readFileSync(path.join(DIR, 'sectors.json'), 'utf8'));
const oldLens = JSON.parse(fs.readFileSync(path.join(DIR, 'lens.json'), 'utf8'));
const wl = JSON.parse(fs.readFileSync(path.join(DIR, 'watchlist.json'), 'utf8'));

const LENSES_WL = [
  { key: 'Berkshire', label: 'Buffett lens', note: null },
  { key: 'Burry', label: 'Burry lens', note: 'Debt checks now in; a cash-balance check is not possible from Screener' },
  { key: 'Axelrod', label: 'Axelrod lens', note: null },
  { key: 'Jhunjhunwala', label: 'Jhunjhunwala lens', note: 'Promoter-pledging check pending a data source — scores out of 3 for now' },
  { key: 'Lynch', label: 'Lynch lens', note: null },
  { key: 'Marks', label: 'Marks lens', note: 'Green = safe to lean in, red = be careful here' },
  { key: 'Druckenmiller', label: 'Druckenmiller lens', note: null },
];

function fmtPct(v, dec) {
  if (v === null || v === undefined) return null;
  const d = dec !== undefined ? dec : (Number.isInteger(v) ? 0 : 1);
  return v.toFixed(d) + '%';
}
function fmtNum(v, dec) {
  if (v === null || v === undefined) return null;
  const d = dec !== undefined ? dec : (Number.isInteger(v) ? 0 : 1);
  return v.toFixed(d);
}
function fmtINR(v) {
  if (v === null || v === undefined) return null;
  return '\u20B9' + Math.round(v).toLocaleString('en-IN') + ' cr';
}
function fmtSignedPct(v) {
  if (v === null || v === undefined) return null;
  return (v >= 0 ? '+' : '') + fmtPct(v);
}
// One check: {n: name, t: threshold text, v: display value (or null),
// p: pass, m: missing value (fails), na: N/A reason string or null}
// N/A checks are skipped in scoring; their value displays as "N/A".
function chk(n, t, v, pass) {
  return { n, t, v: v === undefined ? null : v, p: !!pass, m: v === null || v === undefined, na: null };
}
function chkNA(n, t, reason) {
  return { n, t, v: 'N/A', p: false, m: false, na: reason };
}
function eff5(f, base) {
  // 5y value, falling back to 3y for recent listings ("thin history").
  if (f[base + '5'] !== null && f[base + '5'] !== undefined) return { v: f[base + '5'], period: '5y', fallback: false };
  if (f[base + '3'] !== null && f[base + '3'] !== undefined) return { v: f[base + '3'], period: '3y', fallback: true };
  return { v: null, period: '5y', fallback: false };
}
// Earnings momentum from the quarterly Net Profit series: latest quarter
// YoY growth vs previous quarter YoY growth. N/A when either YoY is
// undefined (negative profit base or a missing year-ago quarter).
function earningsMomentum(qProfit) {
  if (!Array.isArray(qProfit) || qProfit.length < 6) return { na: 'too few quarters' };
  const n = qProfit.length;
  const latest = qProfit[n - 1].v, prev = qProfit[n - 2].v;
  const latestAgo = qProfit[n - 5].v, prevAgo = qProfit[n - 6].v;
  if ([latest, prev, latestAgo, prevAgo].some(v => v === null || v === undefined)) return { na: 'missing quarter' };
  if (latestAgo <= 0 || prevAgo <= 0) return { na: 'negative profit base' };
  const gLatest = (latest / latestAgo - 1) * 100;
  const gPrev = (prev / prevAgo - 1) * 100;
  return { gLatest, gPrev, accelerating: gLatest > gPrev };
}
// 5-day move: compound the 5 daily % moves stored as "m" in
// market-data.json (the same 5 moves behind the trend dots).
function fiveDayMove(moves) {
  if (!Array.isArray(moves) || moves.length < 5) return null;
  let acc = 1;
  for (const [, pct] of moves) acc *= (1 + pct / 100);
  return (acc - 1) * 100;
}

function scoreV02(f, m, w, isFinancial) {
  const price = (m && m.p !== undefined) ? m.p : f.price;
  const chg = (m && m.c !== undefined) ? m.c : null;
  const dots = (m && Array.isArray(m.d)) ? m.d : [null, null, null, null, null];
  const greenDots = dots.filter(d => d === 1).length;
  const pb = (f.bookValue && price) ? price / f.bookValue : null;
  const peg = (f.pe !== null && f.pe !== undefined && f.profit3 !== null && f.profit3 !== undefined && f.profit3 > 0)
    ? f.pe / f.profit3 : null;
  const belowHigh = (f.high52 !== null && f.high52 !== undefined && price)
    ? ((f.high52 - price) / f.high52) * 100 : null;
  const sales5 = eff5(f, 'sales');
  const profit5 = eff5(f, 'profit');
  const de = (f.debtEquity !== null && f.debtEquity !== undefined) ? f.debtEquity : null;
  const borrowFalling = (f.borrowNow !== null && f.borrowNow !== undefined && f.borrow3yAgo !== null && f.borrow3yAgo !== undefined)
    ? f.borrowNow < f.borrow3yAgo : null;
  const move5 = fiveDayMove(m && m.m);
  const volRatio = (w && w.vol !== null && w.vol !== undefined && w.volAvg15 !== null && w.volAvg15 !== undefined && w.volAvg15 > 0)
    ? w.vol / w.volAvg15 : null;
  const volNA = !w || w.volN === undefined || w.volN < 5;
  const aboveDma = (w && w.dma200 !== null && w.dma200 !== undefined && price) ? price > w.dma200 : null;
  const em = earningsMomentum(f.qProfit);
  const fiiRising = (f.fiiNow !== null && f.fiiNow !== undefined && f.fiiYearAgo !== null && f.fiiYearAgo !== undefined)
    ? f.fiiNow > f.fiiYearAgo : null;
  const rupeeUp = (wp.rupee && wp.rupee.strengthening !== null && wp.rupee.strengthening !== undefined)
    ? wp.rupee.strengthening : null;

  const out = {};
  // 1. Berkshire — quality compounder at a fair price (6 checks)
  out.Berkshire = [
    chk('ROCE', '\u2265 20%', fmtPct(f.roce), f.roce !== null && f.roce >= 20),
    chk('ROE', '\u2265 15%', fmtPct(f.roe), f.roe !== null && f.roe >= 15),
    chk('Sales growth ' + sales5.period, '\u2265 10%', fmtPct(sales5.v), sales5.v !== null && sales5.v >= 10),
    chk('Profit growth ' + profit5.period, '\u2265 10%', fmtPct(profit5.v), profit5.v !== null && profit5.v >= 10),
    chk('P/E', '\u2264 30', fmtNum(f.pe), f.pe !== null && f.pe <= 30),
    isFinancial ? chkNA('Debt/Equity', '\u2264 0.5', 'not applicable — financial')
      : chk('Debt/Equity', '\u2264 0.5', de === null ? null : de.toFixed(2), de !== null && de <= 0.5),
  ];
  // 2. Burry — cheap, hated, real assets (6 checks)
  out.Burry = [
    chk('P/E', '\u2264 15', fmtNum(f.pe), f.pe !== null && f.pe <= 15),
    chk('P/B', '\u2264 2', fmtNum(pb), pb !== null && pb <= 2),
    chk('ROCE', '\u2265 12%', fmtPct(f.roce), f.roce !== null && f.roce >= 12),
    chk('Price CAGR 3y', '< 0%', fmtPct(f.priceCagr3), f.priceCagr3 !== null && f.priceCagr3 < 0),
    isFinancial ? chkNA('Debt/Equity', '\u2264 1', 'not applicable — financial')
      : chk('Debt/Equity', '\u2264 1', de === null ? null : de.toFixed(2), de !== null && de <= 1),
    isFinancial ? chkNA('Borrowings vs 3y ago', 'lower', 'not applicable — financial')
      : chk('Borrowings vs 3y ago', 'lower', borrowFalling === null ? null : (borrowFalling ? 'lower' : 'higher'), borrowFalling === true),
  ];
  // 3. Axelrod — catalyst / momentum (5 checks)
  out.Axelrod = [
    chk('5-day move', '\u2265 +3%', move5 === null ? null : fmtSignedPct(move5), move5 !== null && move5 >= 3),
    chk('Trend dots green', '\u2265 3 of 5', greenDots + '/5 green', greenDots >= 3),
    chk('Sales growth 3y', '\u2265 20%', fmtPct(f.sales3), f.sales3 !== null && f.sales3 >= 20),
    chk('Price CAGR 3y', '\u2265 15%', fmtPct(f.priceCagr3), f.priceCagr3 !== null && f.priceCagr3 >= 15),
    volNA ? chkNA('Volume vs 15d avg', '\u2265 1.5\u00d7', 'too few prior days')
      : chk('Volume vs 15d avg', '\u2265 1.5\u00d7', volRatio === null ? null : volRatio.toFixed(2) + '\u00d7', volRatio !== null && volRatio >= 1.5),
  ];
  // 4. Jhunjhunwala — India long-term (4 checks; pledging SKIPPED — no
  // source — so it scores out of 3 until one is found)
  out.Jhunjhunwala = [
    chk('Promoter holding', '\u2265 50%', fmtPct(f.promoter), f.promoter !== null && f.promoter >= 50),
    chk('Sales growth ' + sales5.period, '\u2265 15%', fmtPct(sales5.v), sales5.v !== null && sales5.v >= 15),
    chk('ROCE', '\u2265 15%', fmtPct(f.roce), f.roce !== null && f.roce >= 15),
    chkNA('Promoter pledging', '< 5%', 'not yet sourced'),
  ];
  // 5. Lynch — growth at a reasonable price (4 checks)
  out.Lynch = [
    chk('PEG', '\u2264 1.5', peg !== null ? peg.toFixed(2) : null, peg !== null && peg <= 1.5),
    chk('Sales growth 3y', '\u2265 15%', fmtPct(f.sales3), f.sales3 !== null && f.sales3 >= 15),
    chk('ROCE', '\u2265 15%', fmtPct(f.roce), f.roce !== null && f.roce >= 15),
    isFinancial ? chkNA('Debt/Equity', '\u2264 1', 'not applicable — financial')
      : chk('Debt/Equity', '\u2264 1', de === null ? null : de.toFixed(2), de !== null && de <= 1),
  ];
  // 6. Marks — risk (4 checks). Green = safe to lean in, red = be careful.
  out.Marks = [
    chk('Below 52w high', '\u2265 20%', fmtPct(belowHigh), belowHigh !== null && belowHigh >= 20),
    chk('P/E', '\u2264 25', fmtNum(f.pe), f.pe !== null && f.pe <= 25),
    chk('ROCE', '\u2265 15%', fmtPct(f.roce), f.roce !== null && f.roce >= 15),
    isFinancial ? chkNA('Debt/Equity', '\u2264 0.5', 'not applicable — financial')
      : chk('Debt/Equity', '\u2264 0.5', de === null ? null : de.toFixed(2), de !== null && de <= 0.5),
  ];
  // 7. Druckenmiller — macro (4 checks)
  out.Druckenmiller = [
    em.na ? chkNA('Earnings momentum', 'accelerating', em.na)
      : chk('Earnings momentum', 'accelerating',
        fmtSignedPct(em.gLatest) + ' vs ' + fmtSignedPct(em.gPrev), em.accelerating),
    (w && w.dma200 !== null && w.dma200 !== undefined) ? chk('Price vs 200-day avg', 'above',
        fmtNum(price) + ' vs ' + fmtNum(w.dma200), aboveDma === true)
      : chkNA('Price vs 200-day avg', 'above', 'under 200 days of history'),
    chk('Rupee vs USD (3mo)', 'strengthening',
      (wp.rupee && wp.rupee.from !== null) ? ('\u20B9' + wp.rupee.from + ' \u2192 \u20B9' + wp.rupee.to) : null,
      rupeeUp === true),
    fiiRising === null ? chkNA('FII holding vs a year ago', 'higher', 'no year-ago value')
      : chk('FII holding vs a year ago', 'higher',
        fmtPct(f.fiiYearAgo) + ' \u2192 ' + fmtPct(f.fiiNow), fiiRising === true),
  ];
  return out;
}

function verdict(checks) {
  const total = checks.length;
  const ev = checks.filter(c => !c.na);
  const n = ev.length;
  if (n <= total / 2) return null; // more than half N/A -> no verdict
  const pass = ev.filter(c => c.p).length;
  const baseGreen = total === 6 ? 5 : total === 5 ? 4 : 3;
  const greenAt = baseGreen - (total - n); // green bar drops one per N/A
  if (pass >= greenAt) return 'green';
  if (pass <= 1) return 'red';
  return 'neutral';
}

function main() {
  const wlStocks = {};
  const missing = [];
  const secMap = (sectors.sectors || {});
  for (const w of wl.stocks) {
    const sym = w.sym;
    const f = fund2.stocks[sym];
    if (!f) { missing.push(sym + ' (no fundamentals-v2)'); continue; }
    const m = md.stocks[sym] || null;
    if (!m) { missing.push(sym + ' (no market data)'); continue; }
    const wpSym = wp.stocks[sym] || null;
    const isFinancial = secMap[sym] === 'Financial Services';
    const checks = scoreV02(f, m, wpSym, isFinancial);
    const verdicts = {};
    const scores = {};
    for (const L of LENSES_WL) {
      verdicts[L.key] = verdict(checks[L.key]);
      const ev = checks[L.key].filter(c => !c.na);
      scores[L.key] = [ev.filter(c => c.p).length, ev.length];
    }
    const flags = [];
    if (f.sales5 === null || f.sales5 === undefined || f.profit5 === null || f.profit5 === undefined) flags.push('thin history');
    if (f.pe === null || f.pe === undefined) flags.push('loss-making');
    // Financials: the debt checks are N/A per lens (flagged under each
    // affected lens in the popup), so no separate flag here.
    wlStocks[sym] = { verdicts, scores, checks, flags };
  }
  // Nifty 500 namespace: VERBATIM copy of the previous lens.json (v0.1).
  // Nothing is re-scored here — the 402 N500-only stocks keep their v0.1
  // verdicts, and the 93 watchlist names in the N500 keep v0.1 here too.
  // Accept both input shapes: the flat v1 file (top-level `stocks`) and
  // the v2 file (namespaced under `n500`). A re-run must NOT wipe the
  // N500 namespace — that bug shipped once (the second run read a v2
  // file, found no top-level `stocks`, and wrote an empty n500).
  const n500Stocks = oldLens.stocks || (oldLens.n500 && oldLens.n500.stocks) || {};
  const n500Lenses = oldLens.lenses || (oldLens.n500 && oldLens.n500.lenses) || [];
  let copyBad = 0;
  for (const sym of Object.keys(n500Stocks)) {
    const want = (oldLens.stocks || (oldLens.n500 && oldLens.n500.stocks) || {})[sym];
    if (JSON.stringify(n500Stocks[sym]) !== JSON.stringify(want)) copyBad++;
  }
  const out = {
    version: 2,
    fetchedAtIST: fund2.fetchedAtIST,
    sessionDate: md.sessionDate,
    source: 'screener.in fundamentals + Yahoo Finance (NSE feed) session prices',
    note: 'Two namespaces: watchlist runs rulebook v0.2 (7 lenses, incl. Druckenmiller); n500 runs rulebook v0.1 (6 lenses, copied from the previous lens.json — NOT re-scored). Lens verdicts are a mechanical reading of the approved rulebook — "Buffett lens", never "Buffett\'s view".',
    watchlist: { rulebook: '0.2', lenses: LENSES_WL, stocks: wlStocks },
    n500: { rulebook: '0.1', lenses: n500Lenses, stocks: n500Stocks },
    missing,
  };
  fs.writeFileSync(path.join(DIR, 'lens.json'), JSON.stringify(out));
  console.log(`scored watchlist ${Object.keys(wlStocks).length}/151 (v0.2), n500 copied ${Object.keys(n500Stocks).length} (v0.1), missing: ${missing.length}`);
  if (missing.length) console.log('missing:', missing.join(', '));
  console.log(`n500 copy check: ${copyBad} differences (want 0)`);
  // Worked-example spot check (rulebook v0.2 table) — must match.
  const expect = {
    TCS: { Berkshire: 'green', Burry: 'neutral', Axelrod: 'red', Jhunjhunwala: 'green', Lynch: 'neutral', Marks: 'green', Druckenmiller: 'green' },
    CPPLUS: { Berkshire: 'green', Burry: 'neutral', Axelrod: 'neutral', Jhunjhunwala: 'green', Lynch: 'green', Marks: 'neutral', Druckenmiller: 'green' },
    SYRMA: { Berkshire: 'neutral', Burry: 'neutral', Axelrod: 'neutral', Jhunjhunwala: 'green', Lynch: 'green', Marks: 'neutral', Druckenmiller: 'green' },
    TONBO: { Berkshire: 'neutral', Burry: 'neutral', Axelrod: 'neutral', Jhunjhunwala: 'red', Lynch: 'green', Marks: 'red', Druckenmiller: null },
  };
  let bad = 0;
  for (const [sym, exp] of Object.entries(expect)) {
    for (const [lens, want] of Object.entries(exp)) {
      const got = wlStocks[sym] && wlStocks[sym].verdicts[lens];
      const mark = got === want ? 'ok ' : 'MISMATCH';
      if (got !== want) bad++;
      console.log(`${mark} ${sym} ${lens}: got ${got}, want ${want} (${wlStocks[sym].scores[lens].join('/')})`);
    }
  }
  console.log(bad ? `WORKED EXAMPLE: ${bad} MISMATCHES — investigate before shipping` : 'WORKED EXAMPLE: all 28 verdicts match the rulebook');
  if (bad || copyBad) process.exit(2);
  // Verdict distribution (watchlist, v0.2) for the report.
  for (const L of LENSES_WL) {
    const c = { green: 0, neutral: 0, red: 0, none: 0 };
    for (const sym of Object.keys(wlStocks)) {
      const v = wlStocks[sym].verdicts[L.key];
      c[v === null ? 'none' : v]++;
    }
    console.log(`dist ${L.key}: green ${c.green} / neutral ${c.neutral} / red ${c.red} / no verdict ${c.none}`);
  }
}
main();

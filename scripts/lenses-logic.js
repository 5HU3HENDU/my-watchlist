// Investor-lens logic — rulebook v0.2 (7 lenses), plain browser JS.
//
// Data / logic / view separation (17 Nov 2026): the background jobs only
// update DATA files (market-data.json, fundamentals-v2.json,
// weekly-prices.json). This file is the LOGIC: it scores every stock from
// whatever data is loaded, in the browser, at page load. There is no
// pre-computed lens.json any more — the same rulebook runs on both tabs
// (My watchlist and Nifty 500), so both tabs show 7 lenses.
//
// Ported EXACTLY from scripts/score-lenses.js scoreV02() + verdict()
// (rulebook v0.2, APPROVED by Shiva 2026-11-16). Same check names,
// thresholds, display values, N/A rules, verdict function, flags.
// Do not reinterpret any threshold here — change the rulebook doc first.
//   - N/A handling: an N/A check is skipped (not pass/fail); the green
//     threshold drops by one per N/A check; red stays ≤1; if more than
//     half a lens's checks are N/A, the lens shows NO verdict (null).
//     A missing value still FAILS its check.
//   - Debt checks are N/A for Financial Services stocks (sector from
//     sectors.json — D/E is meaningless for banks/NBFCs/exchanges/AMCs).
//   - Jhunjhunwala's promoter-pledging check reads pledging.json
//     (Stocks Sena, % of promoter holding). Missing data or zero
//     promoter holding is N/A — the lens then scores out of 3, as it
//     did before the source existed.
//   - Volume (Axelrod spike check) uses the DAILY market-data ratio
//     (m.v, latest-day volume / mean of prior 15 days) when it is a
//     number, falling back to the weekly-prices entry (w.vol /
//     w.volAvg15) when the daily ratio is null. A ratio is evaluable
//     only with >= 5 prior days; fewer is N/A. The 5-day move, trend
//     dots, price vs 200-day avg and below-52w-high use the daily
//     market-data price/moves, so they refresh every day the market
//     data refreshes.
// Works in the browser (global LensLogic) and under Node (module.exports)
// so the same code can be verified against the Node reference scorer.
var LensLogic = (function () {
  var LENSES = [
    { key: 'Berkshire', label: 'Buffett lens', note: null },
    { key: 'Burry', label: 'Burry lens', note: 'Debt checks now in; a cash-balance check is not possible from Screener' },
    { key: 'Axelrod', label: 'Axelrod lens', note: null },
    { key: 'Jhunjhunwala', label: 'Jhunjhunwala lens', note: 'Pledging from Stocks Sena (shareholding filings)' },
    { key: 'Lynch', label: 'Lynch lens', note: null },
    { key: 'Marks', label: 'Marks lens', note: 'Green = safe to lean in, red = be careful here' },
    { key: 'Druckenmiller', label: 'Druckenmiller lens', note: null },
  ];

  function fmtPct(v, dec) {
    if (v === null || v === undefined) return null;
    var d = dec !== undefined ? dec : (Number.isInteger(v) ? 0 : 1);
    return v.toFixed(d) + '%';
  }
  function fmtNum(v, dec) {
    if (v === null || v === undefined) return null;
    var d = dec !== undefined ? dec : (Number.isInteger(v) ? 0 : 1);
    return v.toFixed(d);
  }
  function fmtSignedPct(v) {
    if (v === null || v === undefined) return null;
    return (v >= 0 ? '+' : '') + fmtPct(v);
  }
  // One check: {n: name, t: threshold text, v: display value (or null),
  // p: pass, m: missing value (fails), na: N/A reason string or null}
  // N/A checks are skipped in scoring; their value displays as "N/A".
  function chk(n, t, v, pass) {
    return { n: n, t: t, v: v === undefined ? null : v, p: !!pass, m: v === null || v === undefined, na: null };
  }
  function chkNA(n, t, reason) {
    return { n: n, t: t, v: 'N/A', p: false, m: false, na: reason };
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
    var n = qProfit.length;
    var latest = qProfit[n - 1].v, prev = qProfit[n - 2].v;
    var latestAgo = qProfit[n - 5].v, prevAgo = qProfit[n - 6].v;
    if ([latest, prev, latestAgo, prevAgo].some(function (v) { return v === null || v === undefined; })) return { na: 'missing quarter' };
    if (latestAgo <= 0 || prevAgo <= 0) return { na: 'negative profit base' };
    var gLatest = (latest / latestAgo - 1) * 100;
    var gPrev = (prev / prevAgo - 1) * 100;
    return { gLatest: gLatest, gPrev: gPrev, accelerating: gLatest > gPrev };
  }
  // 5-day move: compound the 5 daily % moves stored as "m" in
  // market-data.json (the same 5 moves behind the trend dots).
  function fiveDayMove(moves) {
    if (!Array.isArray(moves) || moves.length < 5) return null;
    var acc = 1;
    for (var i = 0; i < moves.length; i++) acc *= (1 + moves[i][1] / 100);
    return (acc - 1) * 100;
  }

  // Score one stock. f = fundamentals-v2 record, m = market-data record
  // (or null), w = weekly-prices record (or null), rupee = the
  // weekly-prices file's top-level rupee object (or null), isFinancial =
  // sector is Financial Services, pl = pledging.json record (or null).
  // Returns {LensKey: [checks]}.
  function scoreStock(f, m, w, rupee, isFinancial, pl) {
    var price = (m && m.p !== undefined) ? m.p : f.price;
    var dots = (m && Array.isArray(m.d)) ? m.d : [null, null, null, null, null];
    var greenDots = dots.filter(function (d) { return d === 1; }).length;
    var pb = (f.bookValue && price) ? price / f.bookValue : null;
    // Daily P/E: implied TTM EPS from Screener's same-moment price and P/E
    // (eps = f.price / f.pe), then the daily close divided by it. P/E now
    // tracks the daily price instead of lagging it by up to a week (the
    // weekly Screener snapshot). Null exactly when the weekly P/E is
    // missing — loss-makers stay null — or when either price is missing/0.
    var peDaily = (f.pe !== null && f.pe !== undefined && f.price !== null && f.price !== undefined && f.price !== 0 && price !== null && price !== undefined && price !== 0)
      ? price * f.pe / f.price : null;
    var peg = (peDaily !== null && f.profit3 !== null && f.profit3 !== undefined && f.profit3 > 0)
      ? peDaily / f.profit3 : null;
    var belowHigh = (f.high52 !== null && f.high52 !== undefined && price)
      ? ((f.high52 - price) / f.high52) * 100 : null;
    var sales5 = eff5(f, 'sales');
    var profit5 = eff5(f, 'profit');
    var de = (f.debtEquity !== null && f.debtEquity !== undefined) ? f.debtEquity : null;
    var borrowFalling = (f.borrowNow !== null && f.borrowNow !== undefined && f.borrow3yAgo !== null && f.borrow3yAgo !== undefined)
      ? f.borrowNow < f.borrow3yAgo : null;
    var move5 = fiveDayMove(m && m.m);
    // Volume spike (Axelrod): latest-day volume vs the mean of the prior
    // 15 trading days. PRIMARY source is the daily market-data ratio
    // (m.v, fresher — recomputed at every 16:45 refresh); FALLBACK is
    // the weekly file (w.vol / w.volAvg15) when the daily ratio is null.
    // A ratio is evaluable only with >= 5 prior days behind it; with
    // fewer, the check is N/A ("too few prior days"). When both sources
    // are null, N/A only if either source shows < 5 prior days —
    // otherwise the check fails as missing, exactly as before.
    var dailyVol = (m && typeof m.v === 'number') ? m.v : null;
    var dailyVolN = (m && typeof m.vn === 'number') ? m.vn : null;
    var weeklyVol = (w && w.vol !== null && w.vol !== undefined && w.volAvg15 !== null && w.volAvg15 !== undefined && w.volAvg15 > 0)
      ? w.vol / w.volAvg15 : null;
    var weeklyVolN = (w && typeof w.volN === 'number') ? w.volN : null;
    var volRatio = null, volNA = false;
    if (dailyVol !== null) {
      if (dailyVolN !== null && dailyVolN >= 5) volRatio = dailyVol;
      else volNA = true; // daily ratio exists but too few prior days
    } else if (weeklyVol !== null) {
      if (weeklyVolN !== null && weeklyVolN >= 5) volRatio = weeklyVol;
      else volNA = true;
    } else {
      // Both null: N/A only if either source shows < 5 prior days.
      volNA = (dailyVolN !== null && dailyVolN < 5) || (weeklyVolN !== null && weeklyVolN < 5);
    }
    var aboveDma = (w && w.dma200 !== null && w.dma200 !== undefined && price) ? price > w.dma200 : null;
    var em = earningsMomentum(f.qProfit);
    var fiiRising = (f.fiiNow !== null && f.fiiNow !== undefined && f.fiiYearAgo !== null && f.fiiYearAgo !== undefined)
      ? f.fiiNow > f.fiiYearAgo : null;
    var rupeeUp = (rupee && rupee.strengthening !== null && rupee.strengthening !== undefined)
      ? rupee.strengthening : null;

    var out = {};
    // 1. Berkshire — quality compounder at a fair price (6 checks)
    out.Berkshire = [
      chk('ROCE', '\u2265 20%', fmtPct(f.roce), f.roce !== null && f.roce >= 20),
      chk('ROE', '\u2265 15%', fmtPct(f.roe), f.roe !== null && f.roe >= 15),
      chk('Sales growth ' + sales5.period, '\u2265 10%', fmtPct(sales5.v), sales5.v !== null && sales5.v >= 10),
      chk('Profit growth ' + profit5.period, '\u2265 10%', fmtPct(profit5.v), profit5.v !== null && profit5.v >= 10),
      chk('P/E', '\u2264 30', fmtNum(peDaily), peDaily !== null && peDaily <= 30),
      isFinancial ? chkNA('Debt/Equity', '\u2264 0.5', 'not applicable \u2014 financial')
        : chk('Debt/Equity', '\u2264 0.5', de === null ? null : de.toFixed(2), de !== null && de <= 0.5),
    ];
    // 2. Burry — cheap, hated, real assets (6 checks)
    out.Burry = [
      chk('P/E', '\u2264 15', fmtNum(peDaily), peDaily !== null && peDaily <= 15),
      chk('P/B', '\u2264 2', fmtNum(pb), pb !== null && pb <= 2),
      chk('ROCE', '\u2265 12%', fmtPct(f.roce), f.roce !== null && f.roce >= 12),
      chk('Price CAGR 3y', '< 0%', fmtPct(f.priceCagr3), f.priceCagr3 !== null && f.priceCagr3 < 0),
      isFinancial ? chkNA('Debt/Equity', '\u2264 1', 'not applicable \u2014 financial')
        : chk('Debt/Equity', '\u2264 1', de === null ? null : de.toFixed(2), de !== null && de <= 1),
      isFinancial ? chkNA('Borrowings vs 3y ago', 'lower', 'not applicable \u2014 financial')
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
    // 4. Jhunjhunwala — India long-term (4 checks). Pledging is % of
    // promoter holding (Stocks Sena); missing data or zero promoter
    // holding is N/A, so the lens scores out of 3 for those stocks.
    var pledged = (pl && pl.pledgedPct !== null && pl.pledgedPct !== undefined) ? pl.pledgedPct : null;
    var promoterHeld = (pl && pl.promoterPct !== null && pl.promoterPct !== undefined) ? pl.promoterPct : null;
    out.Jhunjhunwala = [
      chk('Promoter holding', '\u2265 50%', fmtPct(f.promoter), f.promoter !== null && f.promoter >= 50),
      chk('Sales growth ' + sales5.period, '\u2265 15%', fmtPct(sales5.v), sales5.v !== null && sales5.v >= 15),
      chk('ROCE', '\u2265 15%', fmtPct(f.roce), f.roce !== null && f.roce >= 15),
      (pledged === null || promoterHeld === null || promoterHeld === 0)
        ? chkNA('Promoter pledging', '< 5%', pledged === null ? 'no pledging data' : 'no promoter holding')
        : chk('Promoter pledging', '< 5%', fmtPct(pledged, 2), pledged < 5),
    ];
    // 5. Lynch — growth at a reasonable price (4 checks)
    out.Lynch = [
      chk('PEG', '\u2264 1.5', peg !== null ? peg.toFixed(2) : null, peg !== null && peg <= 1.5),
      chk('Sales growth 3y', '\u2265 15%', fmtPct(f.sales3), f.sales3 !== null && f.sales3 >= 15),
      chk('ROCE', '\u2265 15%', fmtPct(f.roce), f.roce !== null && f.roce >= 15),
      isFinancial ? chkNA('Debt/Equity', '\u2264 1', 'not applicable \u2014 financial')
        : chk('Debt/Equity', '\u2264 1', de === null ? null : de.toFixed(2), de !== null && de <= 1),
    ];
    // 6. Marks — risk (4 checks). Green = safe to lean in, red = be careful.
    out.Marks = [
      chk('Below 52w high', '\u2265 20%', fmtPct(belowHigh), belowHigh !== null && belowHigh >= 20),
      chk('P/E', '\u2264 25', fmtNum(peDaily), peDaily !== null && peDaily <= 25),
      chk('ROCE', '\u2265 15%', fmtPct(f.roce), f.roce !== null && f.roce >= 15),
      isFinancial ? chkNA('Debt/Equity', '\u2264 0.5', 'not applicable \u2014 financial')
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
        (rupee && rupee.from !== null) ? ('\u20B9' + rupee.from + ' \u2192 \u20B9' + rupee.to) : null,
        rupeeUp === true),
      fiiRising === null ? chkNA('FII holding vs a year ago', 'higher', 'no year-ago value')
        : chk('FII holding vs a year ago', 'higher',
          fmtPct(f.fiiYearAgo) + ' \u2192 ' + fmtPct(f.fiiNow), fiiRising === true),
    ];
    return out;
  }

  function verdict(checks) {
    var total = checks.length;
    var ev = checks.filter(function (c) { return !c.na; });
    var n = ev.length;
    if (n <= total / 2) return null; // more than half N/A -> no verdict
    var pass = ev.filter(function (c) { return c.p; }).length;
    var baseGreen = total === 6 ? 5 : total === 5 ? 4 : 3;
    var greenAt = baseGreen - (total - n); // green bar drops one per N/A
    if (pass >= greenAt) return 'green';
    if (pass <= 1) return 'red';
    return 'neutral';
  }

  // Score a list of symbols. fundStocks = fundamentals-v2.json stocks map,
  // mdStocks = market-data.json stocks map, wp = the whole weekly-prices
  // file ({rupee, stocks}), secMap = sectors.json sectors map,
  // pledging = pledging.json stocks map (or null — pledging is N/A then).
  // Returns {sym: {verdicts, scores, checks, flags}} — the same shape
  // lens.json used to carry. Symbols with no fundamentals or no market
  // data are skipped (no lens record — the page renders them grey / with
  // "data not available yet", never a made-up verdict).
  function compute(fundStocks, mdStocks, wp, secMap, symbols, pledging) {
    var out = {};
    var rupee = (wp && wp.rupee) || null;
    var wpStocks = (wp && wp.stocks) || {};
    for (var i = 0; i < symbols.length; i++) {
      var sym = symbols[i];
      var f = fundStocks ? fundStocks[sym] : null;
      if (!f) continue;
      var m = (mdStocks && mdStocks[sym]) || null;
      if (!m) continue;
      var w = wpStocks[sym] || null;
      var isFinancial = secMap && secMap[sym] === 'Financial Services';
      var checks = scoreStock(f, m, w, rupee, isFinancial, pledging ? pledging[sym] : null);
      var verdicts = {};
      var scores = {};
      for (var j = 0; j < LENSES.length; j++) {
        var k = LENSES[j].key;
        verdicts[k] = verdict(checks[k]);
        var ev = checks[k].filter(function (c) { return !c.na; });
        scores[k] = [ev.filter(function (c) { return c.p; }).length, ev.length];
      }
      var flags = [];
      if (f.sales5 === null || f.sales5 === undefined || f.profit5 === null || f.profit5 === undefined) flags.push('thin history');
      if (f.pe === null || f.pe === undefined) flags.push('loss-making');
      out[sym] = { verdicts: verdicts, scores: scores, checks: checks, flags: flags };
    }
    return out;
  }

  return { LENSES: LENSES, scoreStock: scoreStock, verdict: verdict, compute: compute };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LensLogic;

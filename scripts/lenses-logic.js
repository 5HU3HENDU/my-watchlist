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
  // Volume ratio: the DAILY market-data ratio (m.v, latest-day volume /
  // mean of the prior 15 days) is primary, the weekly file (w.vol /
  // w.volAvg15) is the fallback. A ratio is evaluable only with >= 5
  // prior days behind it. Returns {ratio: number|null, na: boolean} —
  // na is true when a ratio exists but has too few prior days, or when
  // both sources are null and either shows < 5 prior days.
  function volRatioOf(m, w) {
    var dailyVol = (m && typeof m.v === 'number') ? m.v : null;
    var dailyVolN = (m && typeof m.vn === 'number') ? m.vn : null;
    var weeklyVol = (w && w.vol !== null && w.vol !== undefined && w.volAvg15 !== null && w.volAvg15 !== undefined && w.volAvg15 > 0)
      ? w.vol / w.volAvg15 : null;
    var weeklyVolN = (w && typeof w.volN === 'number') ? w.volN : null;
    if (dailyVol !== null) {
      if (dailyVolN !== null && dailyVolN >= 5) return { ratio: dailyVol, na: false };
      return { ratio: null, na: true }; // daily ratio exists but too few prior days
    }
    if (weeklyVol !== null) {
      if (weeklyVolN !== null && weeklyVolN >= 5) return { ratio: weeklyVol, na: false };
      return { ratio: null, na: true };
    }
    // Both null: N/A only if either source shows < 5 prior days.
    return { ratio: null, na: (dailyVolN !== null && dailyVolN < 5) || (weeklyVolN !== null && weeklyVolN < 5) };
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
    var vol = volRatioOf(m, w);
    var volRatio = vol.ratio, volNA = vol.na;
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

  // Rank parameters (v12): the raw numeric values behind the combined
  // percentile rank, one per distinct parameter used across the 7 lenses
  // — each counted ONCE, so P/E, D/E and ROCE no longer get 3–5 votes
  // through different lenses. Same fields, formulas and fallbacks as
  // scoreStock (5y growth with 3y fallback; banks skip debt checks);
  // null = N/A for that parameter. Dropped: the rupee check (identical
  // for every stock — zero ranking power), trend dots (duplicate of the
  // 5-day return), "borrowings lower than 3y ago" (duplicate of D/E).
  // 3y price CAGR is scored higher-better as momentum even though
  // Burry's lens reads a negative 3y CAGR as cheap — value captures
  // cheapness separately via P/E, P/B, PEG and 52w distance.
  function rankParams(f, m, w, isFinancial, pl, del) {
    var price = (m && m.p !== undefined) ? m.p : f.price;
    var peDaily = (f.pe !== null && f.pe !== undefined && f.price !== null && f.price !== undefined && f.price !== 0 && price !== null && price !== undefined && price !== 0)
      ? price * f.pe / f.price : null;
    if (peDaily !== null && peDaily <= 0) peDaily = null; // loss-makers / bad data are N/A, not "cheapest"
    var pb = (f.bookValue && price) ? price / f.bookValue : null;
    if (pb !== null && pb <= 0) pb = null;
    var peg = (peDaily !== null && f.profit3 !== null && f.profit3 !== undefined && f.profit3 > 0)
      ? peDaily / f.profit3 : null;
    if (peg !== null && peg <= 0) peg = null;
    var belowHigh = (f.high52 !== null && f.high52 !== undefined && price)
      ? ((f.high52 - price) / f.high52) * 100 : null;
    var sales5 = eff5(f, 'sales');
    var profit5 = eff5(f, 'profit');
    var em = earningsMomentum(f.qProfit);
    var de = isFinancial ? null : ((f.debtEquity !== null && f.debtEquity !== undefined) ? f.debtEquity : null);
    // Promoter holding: 0 or missing is N/A (same rule as the pledging
    // check — widely-held banks etc. carry 0 by structure, not by choice).
    var promoter = (f.promoter !== null && f.promoter !== undefined && f.promoter !== 0) ? f.promoter : null;
    var pledged = (pl && pl.pledgedPct !== null && pl.pledgedPct !== undefined) ? pl.pledgedPct : null;
    var promoterHeld = (pl && pl.promoterPct !== null && pl.promoterPct !== undefined) ? pl.promoterPct : null;
    if (pledged === null || promoterHeld === null || promoterHeld === 0) pledged = null;
    var vol = volRatioOf(m, w);
    var vsDma = (w && w.dma200 !== null && w.dma200 !== undefined && price)
      ? ((price - w.dma200) / w.dma200) * 100 : null;
    var fiiChg = (f.fiiNow !== null && f.fiiNow !== undefined && f.fiiYearAgo !== null && f.fiiYearAgo !== undefined)
      ? f.fiiNow - f.fiiYearAgo : null;
    // Day delivery % (Trendlyne, weekly Saturday snapshot): higher is
    // better — delivery means buyers took the shares home. Guard the
    // range: a value outside 0–100 is bad data, not a rank signal.
    var delivery = (del && del.deliveryPct !== null && del.deliveryPct !== undefined && del.deliveryPct >= 0 && del.deliveryPct <= 100)
      ? del.deliveryPct : null;
    return {
      quality: {
        roce: (f.roce !== null && f.roce !== undefined) ? f.roce : null,
        roe: (f.roe !== null && f.roe !== undefined) ? f.roe : null,
        salesGrowth: sales5.v,
        salesPeriod: sales5.period,
        profitGrowth: profit5.v,
        profitPeriod: profit5.period,
        earnMom: em.na ? null : (em.gLatest - em.gPrev),
        de: de,
        promoter: promoter,
        pledging: pledged,
      },
      value: { pe: peDaily, pb: pb, peg: peg, belowHigh: belowHigh },
      momentum: {
        move5: fiveDayMove(m && m.m),
        volRatio: vol.ratio,
        vsDma: vsDma,
        cagr3: (f.priceCagr3 !== null && f.priceCagr3 !== undefined) ? f.priceCagr3 : null,
        fiiChg: fiiChg,
        delivery: delivery,
      },
    };
  }

  // Parameter → sub-rank map. "lower" means lower is better (percentile
  // is inverted for those). Equal weights everywhere: a sub-rank score
  // is the mean of its available parameter percentiles; the combined
  // score is the mean of the available sub-rank scores.
  var RANK_PARAMS = {
    quality: [
      { key: 'roce', lower: false },
      { key: 'roe', lower: false },
      { key: 'salesGrowth', lower: false },
      { key: 'profitGrowth', lower: false },
      { key: 'earnMom', lower: false },
      { key: 'de', lower: true },
      { key: 'promoter', lower: false },
      { key: 'pledging', lower: true },
    ],
    value: [
      { key: 'pe', lower: true },
      { key: 'pb', lower: true },
      { key: 'peg', lower: true },
      { key: 'belowHigh', lower: false },
    ],
    momentum: [
      { key: 'move5', lower: false },
      { key: 'volRatio', lower: false },
      { key: 'vsDma', lower: false },
      { key: 'cagr3', lower: false },
      { key: 'fiiChg', lower: false },
      { key: 'delivery', lower: false },
    ],
  };

  // Rank detail (v16): per-parameter display spec for the popup's rank
  // breakdown — label, how the raw value is formatted, and whether
  // lower is better. The percentile already accounts for direction
  // (lower-better parameters are inverted before the mean), so the flag
  // is only a display hint. 'period' params (sales/profit growth) use
  // the 5y value with a 3y fallback — the label carries the period
  // actually used. 'pp' is a difference of two percentages (percentage
  // points), 'x' is a ratio.
  var RANK_DETAIL_META = {
    quality: [
      { key: 'roce', label: 'ROCE', fmt: 'pct' },
      { key: 'roe', label: 'ROE', fmt: 'pct' },
      { key: 'salesGrowth', label: 'Sales growth', fmt: 'pct', period: 'salesPeriod' },
      { key: 'profitGrowth', label: 'Profit growth', fmt: 'pct', period: 'profitPeriod' },
      { key: 'earnMom', label: 'Earnings momentum', fmt: 'pp' },
      { key: 'de', label: 'Debt/Equity', fmt: 'num2', lower: true },
      { key: 'promoter', label: 'Promoter holding', fmt: 'pct' },
      { key: 'pledging', label: 'Promoter pledging', fmt: 'pct2', lower: true },
    ],
    value: [
      { key: 'pe', label: 'P/E', fmt: 'num', lower: true },
      { key: 'pb', label: 'P/B', fmt: 'num', lower: true },
      { key: 'peg', label: 'PEG', fmt: 'num2', lower: true },
      { key: 'belowHigh', label: 'Below 52w high', fmt: 'pct' },
    ],
    momentum: [
      { key: 'move5', label: '5-day move', fmt: 'signedPct' },
      { key: 'volRatio', label: 'Volume vs 15d avg', fmt: 'x' },
      { key: 'vsDma', label: 'Price vs 200-day avg', fmt: 'signedPct' },
      { key: 'cagr3', label: 'Price CAGR 3y', fmt: 'pct' },
      { key: 'fiiChg', label: 'FII holding change', fmt: 'pp' },
      { key: 'delivery', label: 'Delivery %', fmt: 'pct' },
    ],
  };
  function fmtRankParam(fmt, v) {
    if (v === null || v === undefined) return null;
    switch (fmt) {
      case 'pct': return fmtPct(v);
      case 'pct2': return fmtPct(v, 2);
      case 'num': return fmtNum(v);
      case 'num2': return v.toFixed(2);
      case 'signedPct': return fmtSignedPct(v);
      case 'pp': return (v >= 0 ? '+' : '') + v.toFixed(1) + ' pp';
      case 'x': return v.toFixed(2) + '\u00d7';
      default: return fmtNum(v);
    }
  }

  // Percentile ranks (0–100) for a list of {sym, v} with non-null v,
  // higher v = higher percentile, ties share the average rank. A single
  // value scores 50 (no information). Linear: (avgRank)/(n-1)*100.
  function percentileMap(entries) {
    var sorted = entries.slice().sort(function (a, b) { return a.v - b.v; });
    var n = sorted.length;
    var out = {};
    if (n === 0) return out;
    if (n === 1) { out[sorted[0].sym] = 50; return out; }
    var i = 0;
    while (i < n) {
      var j = i;
      while (j + 1 < n && sorted[j + 1].v === sorted[i].v) j++;
      var pct = ((i + j) / 2) / (n - 1) * 100;
      for (var k = i; k <= j; k++) out[sorted[k].sym] = pct;
      i = j + 1;
    }
    return out;
  }

  // Combined percentile rank for a symbol list, within that tab's
  // universe (watchlist 151, Nifty 500 500). Same inputs as compute();
  // symbols with no fundamentals or no market data are skipped (no
  // rank — the page renders them grey, never a made-up rank).
  // delivery (v18) is the optional delivery.json map
  // {SYM:{deliveryPct}} — null when the file failed to load, in which
  // case every stock scores Momentum out of the other 5 params.
  // Returns {sym: {rank, score, q, v, m, detail}} — score is the combined
  // 0–100, q/v/m the Quality/Value/Momentum sub-rank scores (null when
  // a sub-rank has no available parameters for that stock), and detail
  // the per-parameter breakdown behind each sub-rank (v16, for the
  // popup): {quality: [{key, label, v, disp, pct, na, lower}], ...} —
  // pct is the direction-adjusted percentile (1dp) that feeds the
  // sub-rank mean, null with a reason when the parameter is N/A.
  // Rank 1..N by combined score desc; ties broken by Quality, then
  // Value, then symbol (deterministic). Stocks with no sub-rank at all
  // score null and rank last, by symbol.
  function computeRank(fundStocks, mdStocks, wp, secMap, symbols, pledging, delivery) {
    var wpStocks = (wp && wp.stocks) || {};
    var params = {};
    var finMap = {}; // sym -> isFinancial (for the D/E N/A reason in the detail)
    var list = [];
    for (var i = 0; i < symbols.length; i++) {
      var sym = symbols[i];
      var f = fundStocks ? fundStocks[sym] : null;
      if (!f) continue;
      var m = (mdStocks && mdStocks[sym]) || null;
      if (!m) continue;
      var w = wpStocks[sym] || null;
      var isFinancial = secMap && secMap[sym] === 'Financial Services';
      params[sym] = rankParams(f, m, w, isFinancial, pledging ? pledging[sym] : null, delivery ? delivery[sym] : null);
      finMap[sym] = isFinancial;
      list.push(sym);
    }
    var pct = {}; // sym -> {quality: {param: pct}, value: {...}, momentum: {...}}
    Object.keys(RANK_PARAMS).forEach(function (sub) {
      RANK_PARAMS[sub].forEach(function (spec) {
        var entries = [];
        list.forEach(function (sym) {
          var v = params[sym][sub][spec.key];
          if (v !== null && v !== undefined) entries.push({ sym: sym, v: v });
        });
        var map = percentileMap(entries);
        list.forEach(function (sym) {
          var p = map[sym];
          if (p === undefined) return;
          if (spec.lower) p = 100 - p;
          if (!pct[sym]) pct[sym] = {};
          if (!pct[sym][sub]) pct[sym][sub] = {};
          pct[sym][sub][spec.key] = p;
        });
      });
    });
    var rows = list.map(function (sym) {
      var sub = {};
      Object.keys(RANK_PARAMS).forEach(function (s) {
        var vals = pct[sym] && pct[sym][s] ? Object.keys(pct[sym][s]).map(function (k) { return pct[sym][s][k]; }) : [];
        sub[s] = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
      });
      var avail = Object.keys(sub).map(function (k) { return sub[k]; }).filter(function (x) { return x !== null; });
      var score = avail.length ? avail.reduce(function (a, b) { return a + b; }, 0) / avail.length : null;
      // Per-parameter breakdown (v16, for the popup): raw value + the
      // direction-adjusted percentile that feeds the sub-rank mean, per
      // sub-rank. N/A parameters carry pct: null and a reason — they are
      // skipped in the mean, never scored zero.
      var detail = {};
      Object.keys(RANK_PARAMS).forEach(function (s) {
        detail[s] = RANK_DETAIL_META[s].map(function (meta) {
          var raw = params[sym][s][meta.key];
          var p = pct[sym] && pct[sym][s] ? pct[sym][s][meta.key] : undefined;
          var na = null;
          if (raw === null || raw === undefined) {
            na = (s === 'quality' && meta.key === 'de' && finMap[sym]) ? 'not applicable \u2014 financial' : 'no data';
          }
          var label = meta.label;
          if (meta.period) {
            var per = params[sym][s][meta.period];
            if (per) label += ' ' + per;
          }
          return { key: meta.key, label: label,
            v: (raw === null || raw === undefined) ? null : raw,
            disp: fmtRankParam(meta.fmt, raw),
            pct: (p === undefined) ? null : Math.round(p * 10) / 10,
            na: na, lower: !!meta.lower };
        });
      });
      return { sym: sym, score: score, q: sub.quality, v: sub.value, m: sub.momentum, detail: detail };
    });
    rows.sort(function (a, b) {
      if (a.score === null && b.score === null) return a.sym < b.sym ? -1 : 1;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score || (b.q || 0) - (a.q || 0) || (b.v || 0) - (a.v || 0) || (a.sym < b.sym ? -1 : 1);
    });
    var out = {};
    rows.forEach(function (r, idx) {
      out[r.sym] = {
        rank: idx + 1,
        score: r.score === null ? null : Math.round(r.score * 10) / 10,
        q: r.q === null ? null : Math.round(r.q * 10) / 10,
        v: r.v === null ? null : Math.round(r.v * 10) / 10,
        m: r.m === null ? null : Math.round(r.m * 10) / 10,
        detail: r.detail,
      };
    });
    return out;
  }

  // Analysts View (v14): pure helpers over one analysts.json record
  // (Yahoo recommendationTrend + financialData). Each rating has its
  // own colour — strong buy dark green, buy light green, hold grey,
  // sell light red, strong sell dark red. Hold stays grey so it never
  // clashes with the amber watchlist-overlap dot on N500 tiles.
  // Thin-coverage rule (Shiva): fewer than 3 analysts -> upside and
  // score are N/A (grey); the counts still show — they are factual.
  // Zero analysts -> no coverage at all ("No analyst coverage").
  var ANALYST_COLORS = {
    strongBuy: '#15803d', buy: '#4ade80', hold: '#6b7280',
    sell: '#f87171', strongSell: '#b91c1c',
  };
  var ANALYST_KEYS = ['strongBuy', 'buy', 'hold', 'sell', 'strongSell'];
  var ANALYST_WEIGHTS = { strongBuy: 4, buy: 3, hold: 2, sell: 1, strongSell: 0 };

  // Counts from the CURRENT period (trend[0], period "0m"). Null when
  // there is no trend row at all (no consensus). A missing count inside
  // an existing row reads as 0 — Yahoo sends explicit 0s.
  function analystCounts(rec) {
    if (!rec || !Array.isArray(rec.trend) || !rec.trend.length) return null;
    var t = rec.trend[0];
    var out = {};
    ANALYST_KEYS.forEach(function (k) {
      var v = t[k];
      out[k] = (v === null || v === undefined) ? 0 : v;
    });
    return out;
  }
  // Number of covering analysts: Yahoo's opinion count when present,
  // else the sum of the current-period counts. Null when unknown.
  function analystN(rec) {
    if (!rec) return null;
    if (rec.numberOfAnalystOpinions !== null && rec.numberOfAnalystOpinions !== undefined) return rec.numberOfAnalystOpinions;
    var c = analystCounts(rec);
    if (!c) return null;
    return ANALYST_KEYS.reduce(function (a, k) { return a + c[k]; }, 0);
  }
  // Weighted average upside %: (average target / current price - 1) x
  // 100, from the consensus response's own prices (same response, so
  // tile and popup can never disagree). Null when either price is
  // missing. Yahoo publishes only the MEAN target, so this is the
  // equal-weighted mean across analysts — rating-weighted targets would
  // need per-firm data, which Yahoo does not give.
  function analystUpside(rec) {
    if (!rec || rec.targetMeanPrice === null || rec.targetMeanPrice === undefined ||
        rec.currentPrice === null || rec.currentPrice === undefined || rec.currentPrice === 0) return null;
    return (rec.targetMeanPrice / rec.currentPrice - 1) * 100;
  }
  // % weighted score (popup only, never on the tile): strong buy 4,
  // buy 3, hold 2, sell 1, strong sell 0; weighted sum / (4 x analysts)
  // x 100. Null when there are no counts to weigh.
  function analystScore(rec) {
    var c = analystCounts(rec);
    if (!c) return null;
    var n = ANALYST_KEYS.reduce(function (a, k) { return a + c[k]; }, 0);
    if (n === 0) return null;
    var s = ANALYST_KEYS.reduce(function (a, k) { return a + ANALYST_WEIGHTS[k] * c[k]; }, 0);
    return s / (4 * n) * 100;
  }
  // The tile's view of one record: coverage, analyst count, the five
  // counts (always, zeros included), upside and score — the last two
  // null under the thin-coverage rule (< 3 analysts).
  function analystView(rec) {
    var c = analystCounts(rec);
    if (!c) return { coverage: false, n: 0, counts: null, upside: null, score: null };
    var n = analystN(rec);
    var thin = (n === null || n < 3);
    return {
      coverage: true,
      n: n,
      counts: c,
      upside: thin ? null : analystUpside(rec),
      score: thin ? null : analystScore(rec),
    };
  }
  // 3-month trend for the popup: buys and sells per period, oldest
  // first (trend is stored newest-first: 0m, -1m, -2m, -3m).
  function analystTrend(rec) {
    if (!rec || !Array.isArray(rec.trend)) return [];
    return rec.trend.slice().reverse().map(function (t) {
      var buys = ((t.strongBuy || 0) + (t.buy || 0));
      var sells = ((t.sell || 0) + (t.strongSell || 0));
      return { period: t.period, buys: buys, sells: sells };
    });
  }

  return { LENSES: LENSES, scoreStock: scoreStock, verdict: verdict, compute: compute, computeRank: computeRank,
    RANK_DETAIL_META: RANK_DETAIL_META,
    ANALYST_COLORS: ANALYST_COLORS, ANALYST_KEYS: ANALYST_KEYS,
    analystCounts: analystCounts, analystN: analystN, analystUpside: analystUpside,
    analystScore: analystScore, analystView: analystView, analystTrend: analystTrend };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LensLogic;

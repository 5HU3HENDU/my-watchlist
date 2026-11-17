// Daily re-score of the DAILY-dependent lens checks for the My watchlist
// namespace only (rulebook v0.2, 151 stocks). The lens.json weekly refresh
// (Saturdays) re-scores everything from fresh fundamentals; this script
// runs every weekday at 16:45 after the price refresh and only touches
// the checks whose inputs move daily:
//
//   Axelrod [0] 5-day move, [1] trend dots green, [4] volume vs 15d avg
//   Druckenmiller [1] price vs 200-day avg
//   Marks [0] below 52w high
//
// Everything else — all fundamentals-based checks, all other lenses, and
// the WHOLE n500 namespace (rulebook v0.1) — is preserved verbatim from
// the input lens.json.
//
// The check definitions below are COPIED from score-lenses.js (scoreV02,
// chk, chkNA, fmt*, fiveDayMove, verdict). score-lenses.js is the source
// of truth: do not change a definition here without changing it there.
//
// Why this exists: the Axelrod trend-dots check went stale mid-week for
// SHAREINDIA — scored "3/5 green" on 16 Nov from the 13 Nov close, while
// the popup's daily 5-day moves already showed only 2 green days after
// the 16:45 price refresh moved the window. Daily checks are recorded as
// of the market-data sessionDate in watchlist.dailyChecksAsOf.
//
// Inputs: market-data.json (daily p/c/d/m/v/vn) + lens.json +
//   weekly-prices.json (dma200) + fundamentals-v2.json (high52).
// Output: lens.json rewritten in place + CHANGED/UNCHANGED + summary.
// Usage: node scripts/score-lenses-daily.js (run from ~/workspace/my-watchlist/)
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');

function load(name) {
  const p = path.join(DIR, name);
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch (e) { console.error(`DAILY SCORE FAILED: cannot read ${name}: ${e.message}`); process.exit(1); }
  try { return JSON.parse(raw); }
  catch (e) { console.error(`DAILY SCORE FAILED: ${name} is not valid JSON: ${e.message}`); process.exit(1); }
}
const md = load('market-data.json');
const lensRaw = (() => {
  try { return fs.readFileSync(path.join(DIR, 'lens.json'), 'utf8'); }
  catch (e) { console.error(`DAILY SCORE FAILED: cannot read lens.json: ${e.message}`); process.exit(1); }
})();
let lens;
try { lens = JSON.parse(lensRaw); }
catch (e) { console.error(`DAILY SCORE FAILED: lens.json is not valid JSON: ${e.message}`); process.exit(1); }
const wp = load('weekly-prices.json');
const fund2 = load('fundamentals-v2.json');

if (!lens.watchlist || !lens.watchlist.stocks || typeof lens.watchlist.stocks !== 'object') {
  console.error('DAILY SCORE FAILED: lens.json has no watchlist.stocks namespace');
  process.exit(1);
}
if (!md.stocks || typeof md.stocks !== 'object') {
  console.error('DAILY SCORE FAILED: market-data.json has no stocks map');
  process.exit(1);
}
if (!wp.stocks || !fund2.stocks) {
  console.error('DAILY SCORE FAILED: weekly-prices.json or fundamentals-v2.json has no stocks map');
  process.exit(1);
}

// --- helpers copied from score-lenses.js (source of truth) ---
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
function fmtSignedPct(v) {
  if (v === null || v === undefined) return null;
  return (v >= 0 ? '+' : '') + fmtPct(v);
}
function chk(n, t, v, pass) {
  return { n, t, v: v === undefined ? null : v, p: !!pass, m: v === null || v === undefined, na: null };
}
function chkNA(n, t, reason) {
  return { n, t, v: 'N/A', p: false, m: false, na: reason };
}
// 5-day move: compound the 5 daily % moves stored as "m" in
// market-data.json (the same 5 moves behind the trend dots).
function fiveDayMove(moves) {
  if (!Array.isArray(moves) || moves.length < 5) return null;
  let acc = 1;
  for (const [, pct] of moves) acc *= (1 + pct / 100);
  return (acc - 1) * 100;
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
function scoreOf(checks) {
  const ev = checks.filter(c => !c.na);
  return [ev.filter(c => c.p).length, ev.length];
}

const DAILY_LENSES = ['Axelrod', 'Druckenmiller', 'Marks'];
const changes = { Axelrod: [], Druckenmiller: [], Marks: [] };
const skipped = [];

for (const sym of Object.keys(lens.watchlist.stocks)) {
  const st = lens.watchlist.stocks[sym];
  const m = md.stocks[sym] || null;
  if (!m || m.p === undefined || m.p === null) { skipped.push(sym + ' (no market data)'); continue; }
  const price = m.p;
  const w = wp.stocks[sym] || null;
  const f = fund2.stocks[sym] || null;

  const old = {
    Axelrod: st.verdicts.Axelrod,
    Druckenmiller: st.verdicts.Druckenmiller,
    Marks: st.verdicts.Marks,
  };

  // --- Axelrod: [0] 5-day move, [1] trend dots, [4] volume (daily);
  // [2] sales growth 3y, [3] price CAGR 3y preserved (weekly).
  const move5 = fiveDayMove(m.m);
  const dots = Array.isArray(m.d) ? m.d : [null, null, null, null, null];
  const greenDots = dots.filter(d => d === 1).length;
  const volNA = (m.vn === undefined || m.vn === null || m.vn < 5);
  const volRatio = (m.v === undefined ? null : m.v);
  const ax = [
    chk('5-day move', '≥ +3%', move5 === null ? null : fmtSignedPct(move5), move5 !== null && move5 >= 3),
    chk('Trend dots green', '≥ 3 of 5', greenDots + '/5 green', greenDots >= 3),
    st.checks.Axelrod[2],
    st.checks.Axelrod[3],
    volNA ? chkNA('Volume vs 15d avg', '≥ 1.5×', 'too few prior days')
      : chk('Volume vs 15d avg', '≥ 1.5×', volRatio === null ? null : volRatio.toFixed(2) + '×', volRatio !== null && volRatio >= 1.5),
  ];
  // --- Druckenmiller: [1] price vs 200-day avg (daily); [0], [2], [3]
  // preserved (weekly). dma200 comes from the weekly file; only the
  // price-vs-average comparison refreshes daily.
  const dma200 = (w && w.dma200 !== null && w.dma200 !== undefined) ? w.dma200 : null;
  const dr = [
    st.checks.Druckenmiller[0],
    dma200 !== null
      ? chk('Price vs 200-day avg', 'above', fmtNum(price) + ' vs ' + fmtNum(dma200), price > dma200)
      : chkNA('Price vs 200-day avg', 'above', 'under 200 days of history'),
    st.checks.Druckenmiller[2],
    st.checks.Druckenmiller[3],
  ];
  // --- Marks: [0] below 52w high (daily — price moves, high52 is weekly);
  // [1] P/E, [2] ROCE, [3] D/E preserved (weekly). A null high52 fails
  // the check, exactly as scoreV02 does (missing value fails, not N/A).
  const high52 = (f && f.high52 !== null && f.high52 !== undefined) ? f.high52 : null;
  const belowHigh = (high52 !== null && price) ? ((high52 - price) / high52) * 100 : null;
  const mk = [
    chk('Below 52w high', '≥ 20%', fmtPct(belowHigh), belowHigh !== null && belowHigh >= 20),
    st.checks.Marks[1],
    st.checks.Marks[2],
    st.checks.Marks[3],
  ];

  st.checks.Axelrod = ax;
  st.checks.Druckenmiller = dr;
  st.checks.Marks = mk;
  st.verdicts.Axelrod = verdict(ax);
  st.verdicts.Druckenmiller = verdict(dr);
  st.verdicts.Marks = verdict(mk);
  st.scores.Axelrod = scoreOf(ax);
  st.scores.Druckenmiller = scoreOf(dr);
  st.scores.Marks = scoreOf(mk);
  for (const L of DAILY_LENSES) {
    if (st.verdicts[L] !== old[L]) changes[L].push(`${sym}: ${old[L]} → ${st.verdicts[L]}`);
  }
}

// The daily checks are as of the market-data session (not the weekly
// fundamentals session at the top level, which stays untouched).
lens.watchlist.dailyChecksAsOf = md.sessionDate;

const after = JSON.stringify(lens);
const beforeNorm = JSON.stringify(JSON.parse(lensRaw));
const changed = beforeNorm !== after;
if (changed) fs.writeFileSync(path.join(DIR, 'lens.json'), after);
console.log(changed ? 'CHANGED' : 'UNCHANGED', '| daily checks as of:', md.sessionDate, '| skipped (no market data):', skipped.length, skipped.join(', '));
for (const L of DAILY_LENSES) {
  console.log(`${L}: ${changes[L].length} verdict change(s)${changes[L].length ? ' — ' + changes[L].join('; ') : ''}`);
}

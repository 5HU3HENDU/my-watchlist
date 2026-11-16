// Fetch fundamentals for the 151 My-watchlist stocks from Screener.in
// (no login, server-rendered company pages). This is a WEEKLY fetch —
// fundamentals move slowly — and is NOT part of the daily 16:45 market
// refresh. Output: fundamentals.json in the news-for-adults dir.
// Slug resolution: direct /company/<SYM>/ first; on 404/mismatch, fall
// back to the Screener search API and take the best name match.
// Usage: node scripts/fetch-fundamentals.js [--test] [--limit N] [--stocks-file <path>] [--out <path>] [--partial <path>]
//   --test  : 10 stocks only (parser validation)
//   --limit N: first N stocks
//   --stocks-file <path>: JSON {stocks:[{sym,name}]} instead of watchlist.json
//     (used for the Nifty 500 expansion — the 402 unscored N500 symbols)
//   --out <path>: output JSON (default fundamentals.json). The v0.2 run
//     writes fundamentals-v2.json (watchlist only, extended fields) so the
//     v0.1 file — which the Nifty 500 tab still scores from — is untouched.
//   --partial <path>: resume checkpoint (default fundamentals.partial.json)
// Resume: results are checkpointed to the partial file after each chunk;
// a re-run skips already-fetched symbols.
// NOTE on basis: the bare /company/<SYM>/ URL serves STANDALONE numbers
// (verified on TCS: ROCE 76.7, borrowings Mar 2026 9,354 — standalone;
// the /consolidated/ URL serves different numbers). The canonical link
// still says /consolidated/, so `basis` records that — same as v0.1.
// The v0.2 rulebook's worked example was computed from the bare-URL
// (standalone) numbers, so the fetch keeps using the bare URL.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const wl = JSON.parse(fs.readFileSync(path.join(DIR, 'watchlist.json'), 'utf8'));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BASE = 'https://www.screener.in';
// Screener slugs that differ from the NSE symbol (company renames).
const SLUG_OVERRIDES = { ICICIPRULI: 'ICICILIFE' }; // ICICI Prudential Life -> ICICI Life Insurance Ltd
const args0 = process.argv.slice(2);
const outIdx = args0.indexOf('--out');
const partIdx = args0.indexOf('--partial');
const OUT = path.join(DIR, outIdx >= 0 ? args0[outIdx + 1] : 'fundamentals.json');
const PARTIAL = path.join(DIR, partIdx >= 0 ? args0[partIdx + 1] : 'fundamentals.partial.json');
const DELAY_MS = 1000;

function istNow() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function num(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/,/g, '').replace(/%/g, '').trim();
  if (t === '' || t === '-' || t === '--') return null;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

// --- HTML parsing (Screener server-renders everything we need) ---
function parseRatios(html) {
  const m = html.match(/<ul id="top-ratios">([\s\S]*?)<\/ul>/);
  if (!m) return null;
  const out = {};
  for (const li of m[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const name = li[1].match(/<span class="name">\s*([^<]+?)\s*<\/span>/);
    if (!name) continue;
    const nums = [...li[1].matchAll(/<span class="number">([^<]+)<\/span>/g)].map(x => x[1]);
    out[name[1].trim()] = nums;
  }
  return out;
}

function parseGrowth(html, heading) {
  // Compounded growth tables are <table class="ranges-table"> with a <th>
  // naming the table; parse ONLY that table (a blank cell is just "%" —
  // searching past the table end would pick up the next table's values).
  const out = { y10: null, y5: null, y3: null };
  for (const t of html.matchAll(/<table class="ranges-table">([\s\S]*?)<\/table>/g)) {
    if (!t[1].includes(heading)) continue;
    for (const row of t[1].matchAll(/<td>(10|5|3) Years:<\/td>\s*<td>([^<]*)<\/td>/g)) {
      const v = num(row[2]);
      if (row[1] === '10') out.y10 = v;
      else if (row[1] === '5') out.y5 = v;
      else out.y3 = v;
    }
    return out;
  }
  return out;
}

function parsePromoter(html) {
  const i = html.indexOf('Shareholding Pattern');
  if (i < 0) return null;
  const seg = html.slice(i, i + 20000);
  // First <tr> containing "Promoters" in the quarterly table; latest value is last.
  for (const tr of seg.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    if (!/Promoters/.test(tr[1])) continue;
    const vals = [...tr[1].matchAll(/([\d.]+)%/g)].map(x => parseFloat(x[1]));
    if (vals.length) return vals[vals.length - 1];
  }
  return null;
}

// --- v0.2 parsers (Screener tables are server-rendered; labels carry a
// trailing "+" button, and "&nbsp;" entities — both are normalised) ---
function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function normLabel(s) {
  return stripTags(s).replace(/\+/g, '').replace(/\s+/g, ' ').trim();
}
// First <table> after a marker; returns {headers, rows} with headers[0]
// empty (label column) and rows keyed by normalised label.
function parseTableAt(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const t0 = html.indexOf('<table', i);
  const t1 = html.indexOf('</table>', t0);
  if (t0 < 0 || t1 < 0) return null;
  const t = html.slice(t0, t1 + 8);
  const head = t.match(/<thead>([\s\S]*?)<\/thead>/);
  const headers = head ? [...head[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => stripTags(m[1])) : [];
  const rows = {};
  for (const tr of t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    if (!cells.length) continue;
    const lab = normLabel(cells[0]);
    if (!lab) continue;
    rows[lab] = cells.slice(1).map(stripTags);
  }
  return { headers, rows };
}
function colVal(vals, headers, col) {
  // headers[0] is the empty label column, so values align to headers[1..].
  const idx = headers.indexOf(col);
  if (idx < 1 || !vals || idx - 1 >= vals.length) return null;
  return num(vals[idx - 1]);
}
// Balance sheet: Borrowings, Equity Capital, Reserves at the latest
// annual column and 3 years earlier. D/E = Borrowings /
// (Equity Capital + Reserves) at the latest annual column.
// Most companies report March year-ends, but some (e.g. HEXT,
// RSYSTEMS) report December year-ends — so take the latest annual
// column of either month, not just March. (A Dec-only bug shipped in
// the first v0.2 fetch run and was caught by the coverage check.)
function parseDebt(html) {
  const tab = parseTableAt(html, 'id="balance-sheet"');
  if (!tab) return { borrowNow: null, borrow3yAgo: null, debtEquity: null };
  const { headers, rows } = tab;
  const annualCols = headers.filter(h => /^(Mar|Dec) \d{4}$/.test(h)).sort();
  if (!annualCols.length) return { borrowNow: null, borrow3yAgo: null, debtEquity: null };
  const latest = annualCols[annualCols.length - 1];
  const [mon, yr] = latest.split(' ');
  const threeAgo = `${mon} ${parseInt(yr, 10) - 3}`;
  const b = rows['Borrowings'], ec = rows['Equity Capital'], rv = rows['Reserves'];
  const borrowNow = colVal(b, headers, latest);
  const borrow3yAgo = annualCols.includes(threeAgo) ? colVal(b, headers, threeAgo) : null;
  const eqCap = colVal(ec, headers, latest);
  const res = colVal(rv, headers, latest);
  const debtEquity = (borrowNow !== null && eqCap !== null && res !== null && (eqCap + res) > 0)
    ? borrowNow / (eqCap + res) : null;
  return { borrowNow, borrow3yAgo, debtEquity };
}
// Quarterly Net Profit series: [{q: 'Sep 2026', v: 13934}, ...].
function parseQuarterlyProfit(html) {
  const tab = parseTableAt(html, 'id="quarters"');
  if (!tab) return [];
  const { headers, rows } = tab;
  const vals = rows['Net Profit'];
  if (!vals) return [];
  const out = [];
  for (let k = 1; k < headers.length; k++) {
    const v = num(vals[k - 1]);
    if (v !== null) out.push({ q: headers[k], v });
  }
  return out;
}
// Quarterly FII % (first shareholding table = quarterly): latest value
// and the same quarter a year ago (4 columns back).
function parseFII(html) {
  const i = html.indexOf('Shareholding Pattern');
  if (i < 0) return { fiiNow: null, fiiYearAgo: null, fiiLatestQ: null };
  const tab = parseTableAt(html.slice(i), 'Shareholding Pattern');
  if (!tab) return { fiiNow: null, fiiYearAgo: null, fiiLatestQ: null };
  const { headers, rows } = tab;
  const vals = rows['FIIs'];
  if (!vals || !vals.length) return { fiiNow: null, fiiYearAgo: null, fiiLatestQ: null };
  const nums = vals.map(num);
  const n = nums.length;
  const fiiNow = nums[n - 1];
  const fiiYearAgo = n >= 5 ? nums[n - 5] : null;
  return { fiiNow, fiiYearAgo, fiiLatestQ: headers[headers.length - 1] || null };
}

function parseBasis(html) {
  const m = html.match(/<link rel="canonical"\s+href="([^"]+)"/);
  if (!m) return null;
  return m[1].includes('/consolidated/') ? 'consolidated' : 'standalone';
}

function parseTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/);
  return m ? m[1].replace(/&amp;/g, '&').trim() : '';
}

// Token-overlap check: does the Screener title plausibly name the expected company?
function nameMatches(expected, title) {
  const stop = new Set(['ltd', 'limited', 'india', 'indian', 'the', 'of', 'and', 'co', 'company', 'pvt', 'private']);
  const toks = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t && !stop.has(t));
  const e = toks(expected), t = new Set(toks(title));
  if (!e.length) return false;
  const hit = e.filter(x => t.has(x)).length;
  return hit / e.length >= 0.6;
}

async function fetchHtml(url, tries = 2) {
  for (let a = 0; a < tries; a++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      clearTimeout(timer);
      if (r.status === 429 || r.status === 403) { await sleep(30000); continue; }
      if (!r.ok) return { status: r.status, html: '' };
      return { status: r.status, html: await r.text() };
    } catch (e) { await sleep(2000); }
  }
  return { status: 0, html: '' };
}

async function searchSlug(query) {
  try {
    const r = await fetch(`${BASE}/api/company/search/?q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j) || !j.length) return null;
    return j[0].url || null; // e.g. /company/544937/consolidated/
  } catch (e) { return null; }
}

async function fetchOne(stock) {
  const { sym, name } = stock;
  const slug = encodeURIComponent(SLUG_OVERRIDES[sym] || sym);
  let url = `${BASE}/company/${slug}/`;
  let got = await fetchHtml(url);
  let html = got.html;
  let usedSlug = SLUG_OVERRIDES[sym] || sym;
  // Verify: right company? Title must contain "share price" and name-match.
  const okPage = (h) => h && h.includes('id="top-ratios"') && /share price/i.test(parseTitle(h)) && nameMatches(name, parseTitle(h));
  if (!okPage(html)) {
    // Fallback: search API, try the top result's URL.
    const found = await searchSlug(sym);
    if (found) {
      const u2 = BASE + found;
      const g2 = await fetchHtml(u2);
      if (okPage(g2.html)) { html = g2.html; url = u2; usedSlug = found.replace(/^\/company\//, '').replace(/\/.*$/, ''); }
    }
  }
  if (!okPage(html)) {
    // Last resort: accept any page with ratios whose title has "share price"
    // (name may differ in abbreviation, e.g. "360 ONE WAM").
    if (!(html && html.includes('id="top-ratios"') && /share price/i.test(parseTitle(html)))) {
      return { sym, error: `no Screener page (direct ${got.status}, search fallback failed)`, slug: usedSlug };
    }
  }
  const ratios = parseRatios(html);
  if (!ratios) return { sym, error: 'ratios section missing', slug: usedSlug };
  const get = (k) => (ratios[k] && ratios[k][0] !== undefined ? num(ratios[k][0]) : null);
  const hl = ratios['High / Low'] || [];
  const sales = parseGrowth(html, 'Compounded Sales Growth');
  const profit = parseGrowth(html, 'Compounded Profit Growth');
  const priceCagr = parseGrowth(html, 'Stock Price CAGR');
  const debt = parseDebt(html);
  const qProfit = parseQuarterlyProfit(html);
  const fii = parseFII(html);
  const rec = {
    sym,
    slug: usedSlug,
    name: parseTitle(html).split(' share price')[0],
    pe: get('Stock P/E'),
    pb: null, // computed in scoring (price / book value)
    bookValue: get('Book Value'),
    roce: get('ROCE'),
    roe: get('ROE'),
    mcap: get('Market Cap'), // ₹ Cr
    price: get('Current Price'),
    high52: hl[0] !== undefined ? num(hl[0]) : null,
    low52: hl[1] !== undefined ? num(hl[1]) : null,
    divYield: get('Dividend Yield'),
    sales10: sales.y10, sales5: sales.y5, sales3: sales.y3,
    profit10: profit.y10, profit5: profit.y5, profit3: profit.y3,
    priceCagr10: priceCagr.y10, priceCagr5: priceCagr.y5, priceCagr3: priceCagr.y3,
    promoter: parsePromoter(html),
    basis: parseBasis(html),
    // v0.2 (rulebook v0.2): debt from the annual balance sheet (latest
    // annual column — March for most, December for some), quarterly Net
    // Profit series, quarterly FII %.
    borrowNow: debt.borrowNow,
    borrow3yAgo: debt.borrow3yAgo,
    debtEquity: debt.debtEquity,
    qProfit,
    fiiNow: fii.fiiNow,
    fiiYearAgo: fii.fiiYearAgo,
    fiiLatestQ: fii.fiiLatestQ,
  };
  return { sym, rec };
}

async function main() {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;
  const sfIdx = args.indexOf('--stocks-file');
  let stocks = wl.stocks.slice();
  if (sfIdx >= 0) {
    const sf = JSON.parse(fs.readFileSync(args[sfIdx + 1], 'utf8'));
    stocks = sf.stocks.slice();
  }
  if (isTest) {
    const testSyms = ['TCS', 'CPPLUS', 'SYRMA', 'TONBO', 'JPL', 'ACEVECTOR', 'PFOCUS', 'ARCIL', 'ZENTEC', 'STLTECH'];
    stocks = stocks.filter(s => testSyms.includes(s.sym));
  }
  if (limit) stocks = stocks.slice(0, limit);
  // Resume from partial checkpoint.
  let done = {};
  try { done = JSON.parse(fs.readFileSync(PARTIAL, 'utf8')).stocks || {}; } catch (e) {}
  const todo = stocks.filter(s => !done[s.sym]);
  console.log(`total: ${stocks.length} | already done: ${stocks.length - todo.length} | to fetch: ${todo.length}`);
  const failed = [];
  for (let i = 0; i < todo.length; i++) {
    const s = todo[i];
    const res = await fetchOne(s);
    if (res.rec) done[s.sym] = res.rec;
    else { failed.push({ sym: s.sym, error: res.error }); console.log(`FAIL ${s.sym}: ${res.error}`); }
    if ((i + 1) % 10 === 0 || i === todo.length - 1) {
      fs.writeFileSync(PARTIAL, JSON.stringify({ updated: istNow(), stocks: done }, null, 1));
      console.log(`progress: ${i + 1}/${todo.length} done, ${failed.length} failed`);
    }
    if (i < todo.length - 1) await sleep(DELAY_MS);
  }
  const out = {
    version: 2,
    fetchedAtIST: istNow(),
    source: 'screener.in (company pages, no login)',
    note: 'Weekly fetch. mcap in ₹ Cr. Growth figures are compounded % (10y/5y/3y). v0.2: borrowNow/borrow3yAgo/debtEquity from the annual balance sheet (latest annual column — March for most, December for some), qProfit = quarterly Net Profit series, fiiNow/fiiYearAgo = quarterly FII %.',
    stocks: done,
    missing: failed,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  try { fs.unlinkSync(PARTIAL); } catch (e) {}
  console.log(`done: ${Object.keys(done).length}/${stocks.length} fetched, ${failed.length} missing`);
  if (failed.length) console.log('missing:', failed.map(f => `${f.sym} (${f.error})`).join(', '));
}
main().catch(e => { console.error('FUNDAMENTALS FETCH FAILED:', e); process.exit(1); });

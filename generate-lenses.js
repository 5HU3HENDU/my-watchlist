// Generate lenses.html — the standalone investor-lenses page: two tabs,
// "Nifty 500" (500 stocks) and "My watchlist" (151 stocks). Each cell
// carries lens dots; tap-a-stock popup shows last-5-days % moves and
// per-lens check detail. Same controls per tab: Sector, A–Z, Lenses
// sort pill, lens dot filter, settings. Default tab is My watchlist —
// the page is still his watchlist page first.
// DATA / LOGIC / VIEW (v18, 21 Nov 2026): the background jobs only update
// DATA files (market-data.json, fundamentals-v2.json, weekly-prices.json,
// pledging.json, analysts.json, broker-calls.json, delivery.json).
// PWA (v18): the page is installable — manifest.json + sw.js + SVG icons
// (PIL-rendered PNG embedded as base64, since push-files can't push
// binary). The worker is NETWORK-FIRST and only handles the lens page's
// own URLs; Shiva's index.html and his numbered files pass through
// untouched and are never cached. Bump the sw.js cache name when the
// page version bumps.
// REDEPLOY 21 Nov 2026 ~13:35 IST: v12 re-pushed unchanged — the first
// Pages deploy never went live (site still served v11 16 min after push).
// The LOGIC lives in scripts/lenses-logic.js (rulebook v0.2, 7 lenses,
// ported exactly from the old Node scorer) and runs in the browser at
// load — the page computes every verdict from whatever data is there.
// There is no pre-computed lens.json any more, and both tabs run the
// SAME rulebook (v0.2, 7 lenses incl. Druckenmiller); the old v0.1/v0.2
// split is gone. A very small amber dot on Nifty 500 tiles marks stocks
// that are also in My watchlist.
// BAGMANE (in Nifty 500, no Yahoo data): grey "No data" tile, no lens
// dots, flagged in settings — never a made-up verdict. No-data tiles are
// computed at RUNTIME from the loaded market data, not baked in at build.
// Popup CSS/JS matches the heatmap v12 mobile fix: panels fit the
// viewport (min(560px, 100vw-24px)), scroll internally (88dvh), visible
// ✕ close button, page scroll-locked while open and restored on close.
// HTML is GENERATED — never hand-edit lenses.html.
const fs = require('fs');
const fin = JSON.parse(fs.readFileSync(__dirname + '/final-lists.json', 'utf8'));
const wl = JSON.parse(fs.readFileSync(__dirname + '/watchlist.json', 'utf8'));
const n500Syms = fin.indices.NIFTY500.slice();
const wlSyms = wl.stocks.map(s => s.sym);
const wlNames = Object.fromEntries(wl.stocks.map(s => [s.sym, s.name]));
const names = Object.assign({}, fin.names || {}, wlNames);
const wlSet = new Set(wlSyms);
// Confirmed-unlisted names (no NSE/BSE listing): grey placeholder tiles,
// no price/data. Empty today — all 151 names are listed — but the design
// is live so a future unlisted name renders as a grey tile.
const wlUnlisted = (wl.unlisted || []).map(u => u.name).sort((a, b) => a < b ? -1 : 1);
const unlistedJson = JSON.stringify(wlUnlisted);
const n500Json = JSON.stringify(n500Syms);
const wlJson = JSON.stringify(wlSyms);
const namesJson = JSON.stringify(names);
const secRaw = JSON.parse(fs.readFileSync(__dirname + '/sectors.json', 'utf8'));
const sectorsMap = {};
for (const s of new Set([...n500Syms, ...wlSyms])) sectorsMap[s] = (secRaw.sectors && secRaw.sectors[s]) || 'Other';
const sectorsJson = JSON.stringify(sectorsMap);
// Sub-index membership, for the popup's index pills only.
const SUB = [
  { key: 'NIFTY50', label: 'Nifty 50', list: fin.indices.NIFTY50 },
  { key: 'SENSEX', label: 'Sensex', list: fin.indices.SENSEX },
  { key: 'BANKNIFTY', label: 'Bank Nifty', list: fin.indices.BANKNIFTY },
  { key: 'MIDCAP150', label: 'Midcap 150', list: fin.indices.MIDCAP150 },
  { key: 'SMALLCAP250', label: 'Smallcap 250', list: fin.indices.SMALLCAP250 },
];
const subJson = JSON.stringify(SUB);
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#05070a">
<meta name="description" content="Your 151-stock watchlist and the Nifty 500, read through 7 investor lenses — green, red or neutral dots per stock, computed live in the browser.">
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icon-192.svg">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Lenses">
<title>Investor lenses — Nifty 500 &amp; My watchlist</title>
<!-- my-watchlist-lenses-v19 -->
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{background:#05070a;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;display:flex;flex-direction:column;overflow:hidden}
  header{display:flex;align-items:center;gap:12px;padding:8px 12px;background:#05070a;border-bottom:1px solid #1f2937;flex-wrap:wrap}
  .brand{font-size:17px;font-weight:800;letter-spacing:.03em}
  .brand .amber{color:#fbbf24}
  .gear{margin-left:auto;background:none;border:none;color:#9ca3af;cursor:pointer;padding:4px;position:relative;line-height:0}
  .gear svg{width:24px;height:24px}
  .gear .fdot{position:absolute;top:1px;right:1px;width:8px;height:8px;border-radius:50%;background:#22c55e;display:none}
  .gear.on-filter .fdot{display:block}
  main{flex:1;min-height:0;padding:6px}
  #grid{display:grid;grid-auto-rows:1fr;gap:3px;height:100%}
  .cell{container-type:inline-size;position:relative;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:0;padding:2px 3px;line-height:1.25;cursor:pointer;overflow:hidden}
  .wlbadge{position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:#fbbf24}
  .sym{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-size:14cqw;font-weight:700;white-space:nowrap;overflow:hidden;max-width:100%}
  .ret{font-size:10.5px;font-size:12cqw;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;opacity:.95}
  .dots{display:flex;gap:2px;gap:max(2px,1cqw);justify-content:center}
  .dot{width:5px;height:5px;width:max(5px,3cqw);height:max(5px,3cqw);border-radius:50%}
  .dot.up{background:#22c55e}.dot.dn{background:#ef4444}.dot.flat{background:#4b5563}
  .rankline{font-size:11px;font-size:13cqw;font-weight:800;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}
  /* Rank sub-ranks (v15): same flex-cell treatment as the Analysts counts
     (v14). The old single string "Q 76 · V 43 · M 88" at 11cqw was ~163px
     in a 131px tile and only survived via .cell overflow:hidden, clipping
     inside the tile. Now three equal-width cells, no separators, pure
     9cqw (NO px floor — a 9px floor breaks the worst case "Q 100" at
     360px viewports). Each cell is 1/3 of the tile's inner width, so
     even three three-digit values fit by construction. */
  .subrank{display:flex;width:100%;min-width:0;color:#d1d5db;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9cqw;line-height:1.25}
  .subrank>span{flex:1 1 0;min-width:0;text-align:center}
  /* Analysts View tile lines (v14): the counts row is five EQUAL flex
     cells (no "·" separators — the colours already distinguish the
     ratings), so it always fits the tile even with five two-digit
     counts; the font floor keeps it readable on narrow phones. The
     upside line is small enough for the worst case ("upside +174.7%",
     14 chars). "No analyst coverage" wraps to two lines instead of
     running past the tile edge. .cell has overflow:hidden as a safety
     net only — the sizing itself must make clipping unnecessary. */
  .acounts{display:flex;width:100%;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;font-size:max(9px,8.5cqw);font-weight:700;line-height:1.25}
  .acounts>span{flex:1 1 0;min-width:0;text-align:center}
  .aupside{font-size:8px;font-size:8.5cqw;color:#d1d5db;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}
  .acov{display:block;width:100%;font-size:9px;font-size:8cqw;color:#9ca3af;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:center;line-height:1.25}
  #fcircles.disabled{opacity:.35;pointer-events:none}
  .nomatch{grid-column:1/-1;color:#9ca3af;text-align:center;padding-top:40px;font-size:14px}
  .sechead{grid-column:1/-1;background:#111827;border-radius:4px;display:flex;justify-content:space-between;align-items:center;padding:7px 10px;font-size:13px;font-weight:700}
  .sechead .avg{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:700}
  .sectgl{background:#1f2937;color:#d1d5db;border:1px solid #4b5563;border-radius:999px;padding:3px 14px;font-size:12px;font-weight:700;cursor:pointer;margin-left:8px}
  .sectgl.on{background:#fbbf24;color:#111827;border-color:#fbbf24}
  #sectorToggleHdr{margin-left:auto}
  header .gear{margin-left:0}
  #overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:50;padding:16px}
  #overlay.open{display:flex}
  #panel{background:#111827;border:1px solid #374151;border-radius:12px;padding:16px;width:min(560px,calc(100vw - 24px));max-height:88vh;max-height:88dvh;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;color:#e5e7eb;font-size:13px;line-height:1.6}
  .pclose{position:absolute;top:10px;right:10px;width:44px;height:44px;border-radius:50%;background:#1f2937;color:#fff;border:1px solid #6b7280;font-size:20px;line-height:1;cursor:pointer;z-index:5;display:flex;align-items:center;justify-content:center;flex:none}
  /* Popup Back button (v19): the proper way back — a large, always-visible
     tap target at the top of the panel. Tapping it clears the popup and
     returns to the grid (same as the phone's own back button, which the
     history state below also routes to clearing the popup). */
  .backbtn{display:inline-flex;align-items:center;background:#1f2937;color:#fff;border:1px solid #6b7280;border-radius:999px;padding:9px 18px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:12px}
  #panel .prow{margin-bottom:12px}
  #panel .prow:last-child{margin-bottom:0}
  #panel b{color:#fff}
  #fcircles{display:flex;gap:10px;align-items:center;margin-top:6px}
  .fc{width:30px;height:30px;border-radius:50%;border:2px solid #6b7280;background:#fff;cursor:pointer;padding:0;flex:none}
  .fc.green{background:#22c55e;border-color:#22c55e}
  .fc.red{background:#ef4444;border-color:#ef4444}
  #clearFilter{background:#1f2937;color:#d1d5db;border:1px solid #4b5563;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;margin-left:auto}
  #panel .dim{color:#9ca3af}
  #stockOverlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:60;padding:16px}
  #stockOverlay.open{display:flex}
  #stockPanel{background:#111827;border:1px solid #374151;border-radius:12px;padding:16px;width:min(560px,calc(100vw - 24px));max-height:88vh;max-height:88dvh;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;color:#e5e7eb;font-size:14px;line-height:1.6}
  #stockPanel .dim{color:#9ca3af}
  #stockPanel .srow{margin-bottom:8px}
  #stockPanel .srow:last-child{margin-bottom:0}
  .bdot{width:12px;height:12px;border-radius:50%;display:inline-block;margin-right:7px}
  .bdot.up{background:#22c55e}.bdot.dn{background:#ef4444}.bdot.flat{background:#4b5563}
  .fcol{display:flex;flex-direction:column;align-items:center;gap:2px}
  .fclab{font-size:9px;color:#9ca3af;font-weight:700}
  .moves{display:flex;gap:6px;flex-wrap:nowrap;margin-top:4px}
  .mv{display:flex;flex-direction:column;align-items:center;flex:1 1 0;min-width:0;background:#1f2937;border:1px solid #374151;border-radius:6px;padding:3px 8px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:center;line-height:1.35}
  @media (max-width:420px){.mv{padding:3px 2px;font-size:11px}}
  .mv .md{display:block;font-size:10px;color:#9ca3af;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  .lens{border-top:1px solid #374151;padding-top:10px;margin-top:10px}
  .lhead{font-size:13px;font-weight:700;margin-bottom:4px}
  .lcheck{display:grid;grid-template-columns:1fr auto auto 16px;gap:8px;font-size:12px;line-height:1.7;color:#d1d5db}
  .lcheck .thr,.lcheck .val{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#9ca3af;text-align:right;white-space:nowrap}
  .lcheck .mk{text-align:center;font-weight:800}
  .lcheck .mk.ok{color:#22c55e}.lcheck .mk.no{color:#ef4444}.lcheck .mk.na{color:#6b7280}
  /* Rank breakdown rows (v16): same 3-column grid as the lens checks
     (parameter | value | percentile score), no mark column — the
     percentile IS the mark. Values are short (e.g. "24.5%", "+12.3 pp",
     "scores 91.2"), so the grid fits the phone panel with no media
     override. */
  .rcheck{display:grid;grid-template-columns:1fr auto auto;gap:8px;font-size:12px;line-height:1.7;color:#d1d5db}
  .rcheck .val,.rcheck .pct{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#9ca3af;text-align:right;white-space:nowrap}
  .lnote{font-size:11px;color:#9ca3af;margin-top:2px}
  .lflag{font-size:12px;color:#fbbf24;margin-top:6px}
  .pill{display:inline-block;background:#1f2937;border:1px solid #4b5563;border-radius:999px;padding:1px 10px;font-size:12px;margin:2px 4px 2px 0}
  .cell.grey{background:#374151}
  .cell.grey .uname{font-size:11px;font-weight:700;text-align:center;line-height:1.25;overflow:hidden}
  .cell.grey .ulabel{font-size:10px;color:#9ca3af;text-align:center}
  #unlistedOverlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:60;padding:16px}
  #unlistedOverlay.open{display:flex}
  #unlistedPanel{background:#111827;border:1px solid #374151;border-radius:12px;padding:16px;width:min(560px,calc(100vw - 24px));max-height:88vh;max-height:88dvh;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;color:#e5e7eb;font-size:14px;line-height:1.6}
  #unlistedPanel .dim{color:#9ca3af}
  @media(max-width:700px){
    body{overflow:auto;height:auto}
    #grid{grid-template-columns:repeat(5,1fr)!important;grid-auto-rows:auto;height:auto}
    .cell{padding:9px 4px}
    .sym{font-size:14cqw} /* v19: was 15cqw — the longest 10-char names
      (IDFCFIRSTB etc.) overflowed by ~2px at 412px; 14cqw fits them all */
    .ret{font-size:13cqw}
    #overlay,#stockOverlay,#unlistedOverlay{padding:12px}
  }
  @media(max-width:480px){
    .lcheck{display:flex;flex-wrap:wrap;gap:2px 8px}
    .lcheck span{overflow-wrap:anywhere;min-width:0}
    .lcheck span:first-child{flex:1 1 100%}
    .lcheck .mk{margin-left:auto}
  }
</style>
</head>
<body>
<header>
  <div class="brand">MY WATCHLIST <span class="amber">LENSES</span></div>
  <button class="sectgl hdr tabbtn" id="tabN500">Nifty 500</button>
  <button class="sectgl hdr tabbtn on" id="tabWl">My watchlist (${wlSyms.length})</button>
  <button class="sectgl hdr" id="sectorToggleHdr">Sector</button>
  <button class="sectgl hdr" id="azToggleHdr">A–Z</button>
  <button class="sectgl hdr" id="lensToggleHdr">Lenses</button>
  <button class="sectgl hdr" id="rankToggleHdr">Rank</button>
  <button class="sectgl hdr" id="analystToggleHdr">Analysts View</button>
  <button class="gear" id="gearBtn" aria-label="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg><span class="fdot"></span></button>
</header>
<main><div id="grid"></div></main>
<div id="overlay"><button class="pclose" id="closeSettings" aria-label="Close">✕</button><div id="panel">
  <div class="prow"><span id="orderLine">Top-left = <b>biggest gainer</b> \u00b7 Bottom-right = <b>biggest loser</b></span><br><span id="legendLine"></span></div>
  <div class="prow dim" id="gapLine"></div>
  <div class="prow dim" id="nodataLine"></div>
  <div class="prow dim" id="pledgeLine"></div>
  <div class="prow"><span class="dim">Lens filter</span><div id="fcircles"></div></div>
  <div class="prow"><span class="dim">Last updated:</span> <span id="lastUpdated">\u2014</span><br><span class="dim">Next update:</span> <span id="nextUpdate">\u2014</span><br><span class="dim">Data:</span> <span id="dataStatus">SAMPLE DATA</span><br><span class="dim">Lens data:</span> <span id="lensUpdated">\u2014</span></div>
</div></div>
<div id="stockOverlay"><button class="pclose" id="closeStock" aria-label="Close">✕</button><div id="stockPanel">
  <button class="backbtn" id="backStock">‹ Back</button>
  <div class="srow"><div style="font-size:17px;font-weight:800" id="stName"></div><div class="dim" id="stSym"></div></div>
  <div class="srow"><span style="font-size:20px;font-weight:800" id="stPrice"></span> <span id="stChange" style="font-weight:700"></span></div>
  <div class="srow"><div class="dim" style="font-size:12px">Last 5 days</div><div id="stMoves" class="moves"></div></div>
  <div id="stLens"></div>
  <div class="srow" id="stRank"></div>
  <div class="srow" id="stAnalysts"></div>
  <div class="srow" id="stIndices"></div>
  <div class="srow dim" style="font-size:12px">Data as of <span id="stAsof">\u2014</span></div>
  <div class="srow"><a id="stGf" href="#" target="_blank" rel="noopener" style="color:#fbbf24;font-weight:700;text-decoration:none">Google Finance \u2197</a></div>
</div></div>
<div id="unlistedOverlay"><button class="pclose" id="closeUnlisted" aria-label="Close">✕</button><div id="unlistedPanel">
  <button class="backbtn" id="backUnlisted">‹ Back</button>
  <div style="font-size:17px;font-weight:800" id="unName"></div>
  <div class="dim" style="margin-top:6px" id="unSub">Not listed yet \u2014 no market data</div>
</div></div>
<script src="scripts/lenses-logic.js?v=19"></script>
<script>
const N500_SYMS=${n500Json};
const WL_SYMS=${wlJson};
const WL_SET=new Set(WL_SYMS);
const NAMES=${namesJson};
const SECTORS=${sectorsJson};
const SUB=${subJson};
const UNLISTED=${unlistedJson};
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function samplePct(sym){return ((hash(sym+"%")%9000)/1000)-4.5;}
function dayUp(sym,k){return (hash(sym+":d"+k)%2)===0;}
function colorFor(pct){
  // sqrt curve so small moves stay visible: +1% -> 45% tint, +2% -> 63%, +5% -> 100%; 0% stays neutral.
  const t=Math.sqrt(Math.min(Math.abs(pct)/5,1));
  const neutral=[17,24,39], end=pct>=0?[22,101,52]:[153,27,27];
  const c=neutral.map(function(v,i){return Math.round(v+(end[i]-v)*t);});
  return "rgb("+c[0]+","+c[1]+","+c[2]+")";
}
let REAL=null, REAL_ASOF="", REAL_SESSION="", LAST_FALLBACK=0, LAST_COUNT=0;
// Lens data, computed in the browser (scripts/lenses-logic.js, rulebook
// v0.2, 7 lenses, BOTH tabs) from the loaded data files. No lens.json.
// LENS_ASOF = fundamentals fetchedAtIST (the slow data's as-of);
// LENS_SESSION = market-data sessionDate (the daily checks' as-of).
let LENS_WL=null, LENS_N500=null;
let RANK_WL=null, RANK_N500=null;
let FUND=null, FUND_ASOF="", WP=null, RUPEE=null, PLEDGE=null;
let ANALYSTS=null, BROKER=null, DELIVERY=null;
let LENS_ASOF="", LENS_SESSION="";
const ORDER=["Berkshire","Burry","Axelrod","Jhunjhunwala","Lynch","Marks","Druckenmiller"];
const LENS_SHORT={Berkshire:"BUF",Burry:"BRY",Axelrod:"AXL",Jhunjhunwala:"RJ",Lynch:"LYN",Marks:"MRK",Druckenmiller:"DRU"};
function activeOrder(){ return ORDER; }
function activeLens(){ return TAB==="wl"?LENS_WL:LENS_N500; }
function activeRank(){ return TAB==="wl"?RANK_WL:RANK_N500; }
let FILTER=[0,0,0,0,0,0,0];
let SECTOR_MODE=false;
let AZ_MODE=false;
let LENS_MODE=false;
let RANK_MODE=false;
let ANALYST_MODE=false;
let TAB="wl"; // "wl" (default) or "n500"
let FULL_ROWS=[]; // rows of the active tab, in default (return) order
function fmtINR(n){return n.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});}
function nextUpdateStr(){
  const ist=new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Kolkata"}));
  const days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  let d=new Date(ist.getFullYear(),ist.getMonth(),ist.getDate());
  const mins=ist.getHours()*60+ist.getMinutes();
  const wd=ist.getDay();
  if(!(wd>=1&&wd<=5&&mins<16*60+45)){ do{ d.setDate(d.getDate()+1); }while(d.getDay()===0||d.getDay()===6); }
  return days[d.getDay()]+" "+d.getDate()+" "+months[d.getMonth()]+", 4:45 pm";
}
// No-data symbols (e.g. BAGMANE): Nifty 500 symbols with no market data
// in the LOADED market-data.json — computed at runtime, never baked in.
function nodataList(){
  return N500_SYMS.filter(function(s){ return !(REAL&&REAL[s]); }).map(function(s){ return {sym:s, name:NAMES[s]||s}; });
}
function updateSettings(){
  const gap=document.getElementById("gapLine");
  gap.textContent=(!REAL||LAST_FALLBACK<=0)?"":LAST_FALLBACK+" of "+LAST_COUNT+" stocks showing sample values (feed gap)";
  const nd=TAB==="n500"?nodataList():[];
  document.getElementById("nodataLine").textContent=nd.length?nd.map(function(x){return x.sym;}).join(", ")+": no market data yet (feed gap) \u2014 no price, no lens verdicts":"";
  // Legend: the tile is all-in-one (v19) — 7 lens dots, rank # + score,
  // Q/V/M sub-ranks, five analyst counts, upside %. The legend describes
  // the tile once; the active sort is named in the order line below.
  document.getElementById("legendLine").innerHTML=
    "Every tile shows the 7 lens dots (<span style='color:#22c55e'>\u25cf</span> lens likes it, <span style='color:#ef4444'>\u25cf</span> lens avoids it, <span style='color:#6b7280'>\u25cf</span> neutral — Buffett, Burry, Axelrod, Jhunjhunwala, Lynch, Marks, Druckenmiller), rank # + combined score, Q/V/M sub-ranks, the five analyst counts (strong buy \u00b7 buy \u00b7 hold \u00b7 sell \u00b7 strong sell, each in its own colour, zeros shown) and upside % (average analyst target vs current price; grey upside = fewer than 3 analysts; \u201cNo analyst coverage\u201d = none).";
  // Pledging: the Jhunjhunwala pledging check is live for both tabs
  // (Stocks Sena; watchlist since v10, Nifty 500 since v17).
  document.getElementById("pledgeLine").textContent="Jhunjhunwala lens: promoter pledging is live for My watchlist and Nifty 500 (Stocks Sena).";
  document.getElementById("lastUpdated").textContent=REAL?REAL_ASOF:"\u2014";
  document.getElementById("nextUpdate").textContent=nextUpdateStr();
  document.getElementById("dataStatus").textContent=REAL?"REAL DATA":"SAMPLE DATA";
  document.getElementById("lensUpdated").textContent=LENS_ASOF||"\u2014";
}
async function loadReal(){
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(function(){ctrl.abort();},8000);
    const r=await fetch("market-data.json",{signal:ctrl.signal});
    clearTimeout(timer);
    if(!r.ok) return;
    const j=await r.json();
    if(j&&j.stocks){ REAL=j.stocks; REAL_ASOF=j.fetchedAtIST||""; REAL_SESSION=j.sessionDate||""; }
  }catch(e){}
}
async function loadFundamentals(){
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(function(){ctrl.abort();},8000);
    const r=await fetch("fundamentals-v2.json",{signal:ctrl.signal});
    clearTimeout(timer);
    if(!r.ok) return;
    const j=await r.json();
    if(j&&j.stocks){ FUND=j.stocks; FUND_ASOF=j.fetchedAtIST||""; }
  }catch(e){}
}
async function loadWeeklyPrices(){
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(function(){ctrl.abort();},8000);
    const r=await fetch("weekly-prices.json",{signal:ctrl.signal});
    clearTimeout(timer);
    if(!r.ok) return;
    const j=await r.json();
    if(j&&j.stocks){ WP=j; RUPEE=j.rupee||null; }
  }catch(e){}
}
async function loadPledging(){
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(function(){ctrl.abort();},8000);
    const r=await fetch("pledging.json",{signal:ctrl.signal});
    clearTimeout(timer);
    if(!r.ok) return;
    const j=await r.json();
    if(j&&j.stocks){ PLEDGE=j.stocks; }
  }catch(e){}
}
async function loadAnalysts(){
  // Yahoo analyst consensus (analysts.json, weekly Saturday fetch).
  // Missing file -> ANALYSTS stays null and the Analysts View tiles
  // show "No analyst coverage" rather than breaking the page.
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(function(){ctrl.abort();},8000);
    const r=await fetch("analysts.json",{signal:ctrl.signal});
    clearTimeout(timer);
    if(!r.ok) return;
    const j=await r.json();
    if(j&&j.stocks){ ANALYSTS=j.stocks; }
  }catch(e){}
}
async function loadBrokerCalls(){
  // Per-firm broker calls (broker-calls.json) — optional. The file
  // exists from v18 (Moneycontrol archive, weekly Saturday fetch).
  // Missing file -> BROKER stays null and the popup renders without
  // the per-firm section rather than breaking the page.
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(function(){ctrl.abort();},8000);
    const r=await fetch("broker-calls.json",{signal:ctrl.signal});
    clearTimeout(timer);
    if(!r.ok) return;
    const j=await r.json();
    if(j&&j.stocks){ BROKER=j.stocks; }
  }catch(e){}
}
async function loadDelivery(){
  // Day delivery % (delivery.json, weekly Saturday fetch from
  // Trendlyne). Missing file -> DELIVERY stays null and every stock
  // scores Momentum out of the other 5 params rather than breaking.
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(function(){ctrl.abort();},8000);
    const r=await fetch("delivery.json",{signal:ctrl.signal});
    clearTimeout(timer);
    if(!r.ok) return;
    const j=await r.json();
    if(j&&j.stocks){ DELIVERY=j.stocks; }
  }catch(e){}
}
function computeLenses(){
  // Browser-side scoring (rulebook v0.2, 7 lenses, BOTH tabs) from the
  // loaded data files. No pre-computed lens.json any more. If the logic
  // file or a data file failed to load, leave the lenses empty (grey
  // dots, "data not available yet") rather than breaking the page.
  if(typeof LensLogic==="undefined"||!FUND||!REAL){ LENS_WL=null; LENS_N500=null; RANK_WL=null; RANK_N500=null; return; }
  // Pledging is live for both tabs (v17): pledging.json covers the
  // 554-symbol union (Stocks Sena), so both tabs pass PLEDGE.
  LENS_WL=LensLogic.compute(FUND,REAL,WP,SECTORS,WL_SYMS,PLEDGE);
  LENS_N500=LensLogic.compute(FUND,REAL,WP,SECTORS,N500_SYMS,PLEDGE);
  LENS_ASOF=FUND_ASOF;
  LENS_SESSION=REAL_SESSION;
  // Combined rank (v12): same data files, same pledging rule as the
  // lenses — PLEDGE on both tabs since v17.
  if(typeof LensLogic.computeRank==="function"){
    RANK_WL=LensLogic.computeRank(FUND,REAL,WP,SECTORS,WL_SYMS,PLEDGE,DELIVERY);
    RANK_N500=LensLogic.computeRank(FUND,REAL,WP,SECTORS,N500_SYMS,PLEDGE,DELIVERY);
  } else { RANK_WL=null; RANK_N500=null; }
}
function lensDots(sym){
  // Lens verdicts as dots: green=1, red=0, neutral/no-verdict=null (grey).
  // 7 dots on BOTH tabs (rulebook v0.2, computed in the browser).
  // No lens data yet -> all grey dots.
  const L=activeLens();
  const order=activeOrder();
  if(!L||!L[sym]) return order.map(function(){return null;});
  const v=L[sym].verdicts||{};
  return order.map(function(k){ return v[k]==="green"?1:v[k]==="red"?0:null; });
}
function realRow(sym){
  if(REAL&&REAL[sym]){ const rec=REAL[sym]; return {pct:rec.c, dots:lensDots(sym), real:true}; }
  const dots=[]; for(let k=5;k>=1;k--){dots.push(dayUp(sym,k)?1:0);}
  return {pct:samplePct(sym), dots:lensDots(sym), real:false};
}
function countsHtml(counts){
  // Five rating counts, each in its own colour, ALWAYS shown including
  // 0 — never collapsed or hidden. Order: strong buy, buy, hold, sell,
  // strong sell. Colours come from LensLogic.ANALYST_COLORS.
  // Layout (v14): five equal-width flex cells (.acounts) with NO "·"
  // separators — the old "0 · 9 · 8 · 6 · 2" string was wider than the
  // tile and clipped the outer numbers on phones. Each cell is 1/5 of
  // the tile's inner width, so even five two-digit counts fit.
  const cols=(typeof LensLogic!=="undefined"&&LensLogic.ANALYST_COLORS)||{strongBuy:"#15803d",buy:"#4ade80",hold:"#6b7280",sell:"#f87171",strongSell:"#b91c1c"};
  const keys=["strongBuy","buy","hold","sell","strongSell"];
  return '<span class="acounts">'+keys.map(function(k){
    return '<span style="color:'+cols[k]+'">'+counts[k]+'</span>';
  }).join("")+'</span>';
}
function cellHtml(r){
  const pctTxt=(r.pct>=0?"+":"")+r.pct.toFixed(2)+"%";
  // Very small amber dot on Nifty 500 tiles for stocks that are also in
  // My watchlist (watchlist tab needs none — every tile there is one).
  const badge=(TAB==="n500"&&WL_SET.has(r.sym))?'<span class="wlbadge" title="In My watchlist"></span>':"";
  // ALL-IN-ONE TILE (v19): every tile shows all three views' info, in
  // every mode, both tabs — name, day %, 7 lens dots, rank # + combined
  // score, Q/V/M sub-ranks, the five analyst counts, upside %. The
  // Lenses / Rank / Analysts View pills no longer switch what the tile
  // shows; they only switch the SORT. Rows reuse the v14/v15 flex-cell
  // implementations (no separators, sized to fit by construction).
  // Rank row (as Rank mode showed it): #N · combined score; "—" where
  // a stock has no rank (no market data to rank on).
  const rkTxt=r.rk===null?"—":"#"+r.rk;
  const scTxt=r.score===null?"—":r.score.toFixed(0);
  // Sub-ranks (v15): three equal-width flex cells (.subrank), label +
  // value together per cell, no "·" separators.
  const sub='<span class="subrank">'+
    '<span>Q '+(r.q===null?"–":r.q.toFixed(0))+'</span>'+
    '<span>V '+(r.v===null?"–":r.v.toFixed(0))+'</span>'+
    '<span>M '+(r.m===null?"–":r.m.toFixed(0))+'</span></span>';
  // Analyst rows (as Analysts View showed them): five counts in their
  // colours + weighted avg upside %. No coverage -> the counts line
  // reads "No analyst coverage"; fewer than 3 analysts -> grey "upside
  // N/A" (counts still show — they are factual). The % weighted score
  // is NOT on the tile; it lives in the popup detail only.
  const av=r.an;
  let countsLine, upsideLine;
  if(!av||!av.coverage){
    countsLine='<span class="acov">No analyst coverage</span>';
    upsideLine="";
  } else {
    countsLine=countsHtml(av.counts);
    upsideLine=av.upside===null?
      '<span class="aupside" style="color:#6b7280">upside N/A</span>':
      '<span class="aupside">upside '+(av.upside>=0?"+":"")+av.upside.toFixed(1)+'%</span>';
  }
  const dots=r.dots.map(function(v){
    return '<span class="dot '+(v===1?"up":v===0?"dn":"flat")+'"></span>';
  }).join("");
  return '<div class="cell" data-sym="'+r.sym+'" style="background:'+colorFor(r.pct)+'">'+badge+'<span class="sym">'+r.sym+
    '</span><span class="ret">'+pctTxt+'</span><span class="dots">'+dots+'</span><span class="rankline">'+rkTxt+' · '+scTxt+'</span>'+sub+countsLine+upsideLine+'</div>';
}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
// Grey placeholder tile: name + label ("Unlisted" or "No data"),
// no price, no return, no dots, no sample values. kind is "unlisted"
// (watchlist tab) or "nodata" (Nifty 500 tab, e.g. BAGMANE — sym given).
function greyCellHtml(name,label,kind,sym){
  const attr=kind==="nodata"?'data-nodata="1" data-sym="'+esc(sym||"")+'"':'data-unlisted="1"';
  return '<div class="cell grey" '+attr+' data-name="'+esc(name)+'"><span class="uname">'+esc(name)+'</span><span class="ulabel">'+esc(label)+'</span></div>';
}
function render(){
  // The dot filter applies in every mode now (v19): the 7 lens dots are
  // always on the tile, so there is always something to filter on. The
  // Lenses / Rank / Analysts View pills only change the SORT, never what
  // the tile shows.
  const grid=document.getElementById("grid");
  grid.style.gridTemplateColumns="repeat(25,1fr)";
  let fallback=0;
  // No-data symbols (e.g. BAGMANE) are NOT priced rows: they render only
  // as grey "No data" tiles below, never as sample-valued cells.
  // (nodataList() computes them at runtime from the loaded market data.)
  const ndSet=new Set(nodataList().map(function(x){return x.sym;}));
  const SYMS=(TAB==="n500"?N500_SYMS:WL_SYMS).filter(function(s){return !ndSet.has(s);});
  const full=SYMS.map(function(sym){
    const r=realRow(sym); if(!r.real) fallback++;
    let g=0,rd=0;
    r.dots.forEach(function(d){ if(d===1)g++; else if(d===0)rd++; });
    const rk=activeRank();
    const rec=rk?rk[sym]:null;
    // Analysts View data for the tile: counts + upside, computed from
    // analysts.json (Yahoo consensus). Missing file or no record ->
    // no coverage (the tile says so, never a made-up number).
    const av=(typeof LensLogic!=="undefined"&&LensLogic.analystView&&ANALYSTS)?LensLogic.analystView(ANALYSTS[sym]||null):null;
    return {sym:sym,pct:r.pct,dots:r.dots,g:g,r:rd,rk:rec?rec.rank:null,score:rec?rec.score:null,q:rec?rec.q:null,v:rec?rec.v:null,m:rec?rec.m:null,an:av};
  }).sort(function(a,b){return b.pct-a.pct||(a.sym<b.sym?-1:1);});
  FULL_ROWS=full;
  // Lens sort: green count desc, then red count asc, then today's return desc.
  const lensCmp=function(a,b){return b.g-a.g||a.r-b.r||b.pct-a.pct||(a.sym<b.sym?-1:1);};
  // Rank sort: combined rank asc (#1 first); unranked (no data) last.
  const rankCmp=function(a,b){return (a.rk===null?1e9:a.rk)-(b.rk===null?1e9:b.rk)||(a.sym<b.sym?-1:1);};
  // Analysts sort (v14): upside % desc. Stocks with no upside number
  // (thin coverage <3 analysts -> upside null, or no coverage at all)
  // sort last, keeping day-% order among themselves. Ties on upside
  // keep day-% order. Applies in Analysts View only, both tabs.
  const analystCmp=function(a,b){
    const au=a.an?a.an.upside:null, bu=b.an?b.an.upside:null;
    if(au===null&&bu===null) return b.pct-a.pct||(a.sym<b.sym?-1:1);
    if(au===null) return 1;
    if(bu===null) return -1;
    return bu-au||b.pct-a.pct||(a.sym<b.sym?-1:1);
  };
  const disp=ANALYST_MODE?full.slice().sort(analystCmp):RANK_MODE?full.slice().sort(rankCmp):LENS_MODE?full.slice().sort(lensCmp):AZ_MODE?full.slice().sort(function(a,b){return a.sym<b.sym?-1:1;}):full;
  // The dot filter applies in every mode (v19 — dots are always shown).
  const rows=disp.filter(function(r){
    return FILTER.every(function(f,i){
      if(f===0||i>=r.dots.length) return true;
      return f===1?r.dots[i]===1:r.dots[i]===0;
    });
  });
  LAST_FALLBACK=fallback; LAST_COUNT=SYMS.length;
  // Settings legend describes the active sort.
  document.getElementById("orderLine").innerHTML=RANK_MODE?
    'Top-left = <b>#1 rank</b> \u00b7 Bottom-right = <b>lowest rank</b>':
    ANALYST_MODE?
    'Top-left = <b>highest upside</b> \u00b7 Bottom-right = <b>lowest upside</b> (stocks with no upside last)':
    LENS_MODE?
    'Top-left = <b>most lens greens</b> \u00b7 Bottom-right = <b>most lens reds</b>':
    'Top-left = <b>biggest gainer</b> \u00b7 Bottom-right = <b>biggest loser</b>';
  // Grey placeholder tiles: priced tiles first, grey tiles at the end.
  // Watchlist tab: confirmed-unlisted names ("Unlisted"). Nifty 500 tab:
  // symbols with no market data at all ("No data", e.g. BAGMANE).
  // Grey tiles are not part of rows/FULL_ROWS, so the dot filter and
  // the feed-gap count never touch them.
  const greyKind=TAB==="n500"?"nodata":"unlisted";
  const greyLabel=TAB==="n500"?"No data":"Unlisted";
  const greyRows=TAB==="n500"?nodataList():UNLISTED.slice();
  const greyHtml=greyRows.map(function(x){
    return TAB==="n500"?greyCellHtml(x.name,greyLabel,greyKind,x.sym):greyCellHtml(x,greyLabel,greyKind,null);
  }).join("");
  const greyHead=greyRows.length?'<div class="sechead"><span>'+greyLabel+'</span><span>'+greyRows.length+' stocks &middot; no market data</span></div>'+greyHtml:"";
  const main=document.querySelector("main");
  if(rows.length===0&&greyRows.length===0){
    grid.style.height=""; grid.style.gridAutoRows=""; main.style.overflowY="";
    grid.innerHTML='<div class="nomatch">No matches</div>';
  } else if(SECTOR_MODE){
    grid.style.height="auto"; grid.style.gridAutoRows="auto"; main.style.overflowY="auto";
    const groups={};
    rows.forEach(function(r){ const s=SECTORS[r.sym]||"Other"; (groups[s]=groups[s]||[]).push(r); });
    const avg=function(g){ return g.reduce(function(t,r){return t+r.pct;},0)/g.length; };
    const avgG=function(g){ return g.reduce(function(t,r){return t+r.g;},0)/g.length; };
    const avgR=function(g){ return g.reduce(function(t,r){return t+r.r;},0)/g.length; };
    // Sector-block order follows the active sort: rank mode ranks
    // sectors by average combined score; lens mode by average greens
    // (then fewest reds, then average return); A–Z is alphabetical;
    // default is average return desc.
    const avgScore=function(g){ const s=g.map(function(r){return r.score;}).filter(function(x){return x!==null;}); return s.length?s.reduce(function(t,x){return t+x;},0)/s.length:0; };
    const order=Object.keys(groups).sort(function(a,b){
      if(RANK_MODE) return avgScore(groups[b])-avgScore(groups[a])||avg(groups[b])-avg(groups[a]);
      if(LENS_MODE) return avgG(groups[b])-avgG(groups[a])||avgR(groups[a])-avgR(groups[b])||avg(groups[b])-avg(groups[a]);
      return AZ_MODE?(a<b?-1:1):avg(groups[b])-avg(groups[a]);
    });
    grid.innerHTML=order.map(function(s){
      const g=groups[s]; const a=avg(g);
      const head='<div class="sechead"><span>'+s+'</span><span>'+g.length+' stocks &middot; <span class="avg" style="color:'+(a>=0?"#22c55e":"#ef4444")+'">'+(a>=0?"+":"")+a.toFixed(2)+'% avg</span></span></div>';
      return head+g.map(cellHtml).join("");
    }).join("")+greyHead;
  } else {
    grid.style.height=""; grid.style.gridAutoRows=""; main.style.overflowY="";
    grid.innerHTML=rows.map(cellHtml).join("")+greyHtml;
  }
  document.getElementById("gearBtn").classList.toggle("on-filter",FILTER.some(function(f){return f!==0;}));
  updateSettings();
}
function openStock(sym){
  const idx=FULL_ROWS.findIndex(function(r){return r.sym===sym;});
  if(idx<0) return;
  const row=FULL_ROWS[idx];
  const price=(REAL&&REAL[sym])?REAL[sym].p:null;
  document.getElementById("stName").textContent=NAMES[sym]||sym;
  document.getElementById("stSym").textContent=sym;
  document.getElementById("stPrice").textContent=price===null?"\u2014":"\u20B9"+fmtINR(price);
  const chg=document.getElementById("stChange");
  chg.textContent=(row.pct>=0?"+":"")+row.pct.toFixed(2)+"%"+(price===null?"":" ("+(row.pct>=0?"+":"")+"\u20B9"+fmtINR(Math.abs(price*row.pct/100))+")");
  chg.style.color=row.pct>=0?"#22c55e":"#ef4444";
  // Last 5 days as actual % moves with dates (market-data "m").
  const mv=(REAL&&REAL[sym]&&REAL[sym].m)||[];
  document.getElementById("stMoves").innerHTML=mv.length?mv.map(function(p){
    const pct=p[1];
    return '<span class="mv"><span class="md">'+esc(p[0])+'</span><span style="color:'+(pct>=0?"#22c55e":"#ef4444")+'">'+(pct>=0?"+":"")+pct.toFixed(2)+'%</span></span>';
  }).join(""):'<span class="dim">No recent moves</span>';
  // Popup sections (v16): Lenses, Rank, Analysts — ALWAYS all three,
  // identical in every mode (Lenses / Rank / Analysts View / A–Z,
  // Sector, both tabs). None of the three section builders reads a
  // mode flag, so the popup is consistent by construction. (The old
  // "Rank today: #N" one-liner was the row's position in the
  // return-sorted list, not the combined rank — replaced by the full
  // rank section below.)
  document.getElementById("stLens").innerHTML=lensHtml(sym);
  document.getElementById("stRank").innerHTML=rankHtml(sym);
  document.getElementById("stAnalysts").innerHTML=analystHtml(sym);
  const pills=SUB.filter(function(t){return t.list.indexOf(sym)>=0;}).map(function(t){return t.label;});
  if(WL_SYMS.indexOf(sym)>=0) pills.push("My watchlist");
  document.getElementById("stIndices").innerHTML=pills.map(function(p){return '<span class="pill">'+p+'</span>';}).join("");
  document.getElementById("stAsof").textContent=REAL?REAL_ASOF:"\u2014";
  document.getElementById("stGf").href="https://www.google.com/finance/quote/"+encodeURIComponent(sym)+":NSE";
  document.getElementById("stockOverlay").classList.add("open");
  notePopupOpened();
  lockScroll();
}
function lensHtml(sym){
  // Per-lens breakdown: overall verdict + score, then per check (name,
  // threshold, stock value, pass/fail). Lenses are labelled "Buffett
  // lens" etc., never "Buffett's view". A lens with no verdict (more than
  // half its checks N/A) shows "No verdict — insufficient data"; an N/A
  // check shows "N/A" with the reason noted under its lens.
  const L=activeLens();
  if(!L||!L[sym]){
    return '<div class="lens"><div class="dim">Investor lenses — data not available yet.</div></div>';
  }
  const rec=L[sym];
  const lenses=(typeof LensLogic!=="undefined"?LensLogic.LENSES:[]);
  let h='<div style="border-top:1px solid #374151;padding-top:10px;margin-top:10px"><div style="font-weight:800;margin-bottom:2px">Investor lenses <span class="dim" style="font-weight:400">— as of '+(LENS_SESSION||"\u2014")+'</span></div>'+
    '<div class="dim" style="font-size:11px;margin-bottom:4px">A mechanical reading of each investor\u2019s framework — \u201cBuffett lens\u201d, not \u201cBuffett\u2019s view\u201d.</div>';
  lenses.forEach(function(info){
    const k=info.key;
    const v=(rec.verdicts&&rec.verdicts[k])||null;
    const sc=(rec.scores&&rec.scores[k])||[0,0];
    const vcol=v==="green"?"#22c55e":v==="red"?"#ef4444":"#9ca3af";
    const vword=v==="green"?"Green":v==="red"?"Red":v===null?"No verdict":"Neutral";
    const scoreTxt=v===null?"":' '+sc[0]+'/'+sc[1];
    h+='<div class="lens"><div class="lhead"><span class="bdot '+(v==="green"?"up":v==="red"?"dn":"flat")+'"></span>'+esc(info.label||k+" lens")+' — <span style="color:'+vcol+'">'+vword+scoreTxt+'</span></div>';
    if(v===null) h+='<div class="lnote">Insufficient data — most checks don\u2019t apply to this stock yet.</div>';
    const naReasons=[];
    (rec.checks[k]||[]).forEach(function(c){
      const mk=c.na?"na":c.m?"na":(c.p?"ok":"no");
      const mark=c.na||c.m?"\u2014":(c.p?"\u2713":"\u2717");
      if(c.na&&naReasons.indexOf(c.na)<0) naReasons.push(c.na);
      h+='<div class="lcheck"><span>'+esc(c.n)+'</span><span class="thr">'+esc(c.t)+'</span><span class="val">'+(c.v===null||c.v===undefined?"\u2014":esc(c.v))+'</span><span class="mk '+mk+'">'+mark+'</span></div>';
    });
    if(naReasons.length) h+='<div class="lnote">Not applicable: '+esc(naReasons.join("; "))+'.</div>';
    if(info.note) h+='<div class="lnote">'+esc(info.note)+'.</div>';
    h+='</div>';
  });
  if(rec.flags&&rec.flags.length){
    const fl=rec.flags.map(function(f){
      return f==="thin history"?"Thin history: 5y growth not available, 3y used":f==="loss-making"?"Loss-making: no P/E":f;
    }).join(" \u00b7 ");
    h+='<div class="lflag">\u26A0 '+esc(fl)+'</div>';
  }
  h+='</div>';
  return h;
}
// Rank section of the popup (v16): the combined percentile rank, the
// three sub-rank scores, and the per-parameter breakdown — which
// parameters feed each sub-rank, their values, and the percentile each
// one scores. Shown for EVERY stock in EVERY mode (Shiva: the popup
// must be consistent irrespective of the filter/button clicked). Since
// v19 the tile also always shows the rank row + sub-ranks (all-in-one
// tile); this popup section is the in-depth version of the same numbers.
function rankHtml(sym){
  // No rank logic loaded (e.g. a stale cached script) -> say so, never
  // a made-up rank.
  if(typeof LensLogic==="undefined"||typeof LensLogic.computeRank!=="function"){
    return '<div style="border-top:1px solid #374151;padding-top:10px;margin-top:10px"><div style="font-weight:800;margin-bottom:2px">Rank</div><div class="dim">Rank data not available — the page could not load the rank logic.</div></div>';
  }
  const rk=activeRank();
  const rec=rk?rk[sym]:null;
  if(!rec){
    return '<div style="border-top:1px solid #374151;padding-top:10px;margin-top:10px"><div style="font-weight:800;margin-bottom:2px">Rank</div><div class="dim">Not ranked — no market data for this stock, so there is no combined rank.</div></div>';
  }
  const N=FULL_ROWS.length;
  const subs=[["Quality","quality",rec.q],["Value","value",rec.v],["Momentum","momentum",rec.m]];
  const avail=subs.filter(function(s){return s[2]!==null;});
  let h='<div style="border-top:1px solid #374151;padding-top:10px;margin-top:10px"><div style="font-weight:800;margin-bottom:2px">Rank — #'+rec.rank+' of '+N+' <span class="dim" style="font-weight:400">· combined '+(rec.score===null?"—":rec.score.toFixed(1))+'</span></div>';
  h+='<div class="dim" style="font-size:12px;margin-bottom:4px">Combined = mean of the available sub-ranks: '+avail.map(function(s){return s[0]+' '+(s[2]===null?"—":s[2].toFixed(1));}).join(', ')+'. Each parameter is ranked 0–100 against every stock in this tab (100 = best); a sub-rank is the mean of its available parameters. N/A parameters are skipped, never scored zero.</div>';
  subs.forEach(function(s){
    const name=s[0], key=s[1], score=s[2];
    const rows=(rec.detail&&rec.detail[key])||[];
    const nAvail=rows.filter(function(r){return r.pct!==null;}).length;
    h+='<div class="lens"><div class="lhead">'+name+' — '+(score===null?"—":score.toFixed(1))+' <span class="dim" style="font-weight:400">('+nAvail+' of '+rows.length+' params)</span></div>';
    rows.forEach(function(r){
      const val=r.disp===null?"N/A":esc(r.disp);
      const pct=r.pct===null?"—":"scores "+r.pct.toFixed(1);
      h+='<div class="rcheck"><span>'+esc(r.label)+'</span><span class="val" style="color:'+(r.disp===null?"#6b7280":"#d1d5db")+'">'+val+'</span><span class="pct" style="color:'+(r.pct===null?"#6b7280":"#d1d5db")+'">'+pct+'</span></div>';
    });
    h+='</div>';
  });
  h+='<div class="lnote">P/E, P/B, PEG, Debt/Equity and pledging are lower-is-better — a low value scores high. Percentiles are within this tab ('+(TAB==="wl"?"My watchlist":"Nifty 500")+').</div>';
  h+='</div>';
  return h;
}
// Analysts section of the popup (v14): the full analyst breakdown —
// the five counts in their colours, mean rating + Yahoo verdict key,
// average target + upside %, target range, the 3-month trend, and the
// % weighted score (popup only, never on the tile). Per-firm calls
// render when broker-calls.json exists (v18: Moneycontrol archive,
// weekly Saturday fetch, last 3 months only). v16: the upside uses
// the thin-rule value (grey N/A under 3 analysts) so tile and popup
// agree.
function analystHtml(sym){
  // analystView needs analysts.json AND the v14 lenses-logic.js — if
  // either is missing (e.g. a stale cached script), the section stays
  // empty rather than breaking the popup.
  if(!ANALYSTS||typeof LensLogic==="undefined"||!LensLogic.analystView) return "";
  const rec=ANALYSTS[sym]||null;
  if(!rec) return "<b>Analysts</b> — no analyst coverage.";
  const av=LensLogic.analystView(rec);
  if(!av.coverage) return "<b>Analysts</b> — no analyst coverage.";
  const keyMap={strong_buy:"Strong buy",buy:"Buy",hold:"Hold",underperform:"Underperform",sell:"Sell",none:"—"};
  const key=(rec.recommendationKey&&keyMap[rec.recommendationKey])||"—";
  const mean=(rec.recommendationMean===null||rec.recommendationMean===undefined)?"—":rec.recommendationMean.toFixed(2);
  const n=(rec.numberOfAnalystOpinions===null||rec.numberOfAnalystOpinions===undefined)?av.n:rec.numberOfAnalystOpinions;
  let h='<div style="border-top:1px solid #374151;padding-top:10px;margin-top:10px"><div style="font-weight:800;margin-bottom:2px">Analysts <span class="dim" style="font-weight:400">— Yahoo consensus, '+n+' analysts</span></div>';
  h+='<div>'+countsHtml(av.counts)+'</div>';
  h+='<div>Mean rating '+mean+' ('+key+')';
  if(av.score!==null) h+=' · score '+Math.round(av.score)+'% <span class="dim">(strong buy 4, buy 3, hold 2, sell 1, strong sell 0)</span>';
  h+='</div>';
  if(rec.targetMeanPrice!==null&&rec.targetMeanPrice!==undefined&&rec.currentPrice){
    // Upside here uses the THIN-RULE value (av.upside — null under 3
    // analysts), not the raw helper: the v13 tile hid TURTLEMINT's
    // +50.3% but the popup showed it. Now tile and popup agree: grey N/A.
    const up=av.upside;
    h+='<div>Average target ₹'+fmtINR(rec.targetMeanPrice);
    if(up===null) h+=' <span style="color:#6b7280">(upside N/A — '+(n!==null&&n!==undefined?('only '+n+' analyst'+(n===1?'':'s')):'too few analysts')+')</span>';
    else h+=' ('+(up>=0?"+":"")+up.toFixed(1)+"% upside)";
    if(rec.targetLowPrice!==null&&rec.targetLowPrice!==undefined&&rec.targetHighPrice!==null&&rec.targetHighPrice!==undefined){
      h+=' · range ₹'+fmtINR(rec.targetLowPrice)+'–₹'+fmtINR(rec.targetHighPrice);
    }
    h+='</div>';
  }
  const tr=LensLogic.analystTrend(rec);
  if(tr.length){
    h+='<div>3-month trend — buys: '+tr.map(function(t){return t.buys;}).join(" → ")+
      ' · sells: '+tr.map(function(t){return t.sells;}).join(" → ")+
      ' <span class="dim">('+tr.map(function(t){return t.period;}).join(", ")+', oldest first)</span></div>';
  }
  if(BROKER&&BROKER[sym]&&BROKER[sym].length){
    h+='<div>Recent broker calls (last 3 months):</div>';
    BROKER[sym].forEach(function(c){
      h+='<div>• '+esc(c.firm)+' — '+esc(c.rating)+' ₹'+fmtINR(c.target)+' ('+esc(c.date)+')</div>';
    });
  }
  h+='</div>';
  return h;
}
function openUnlisted(name){
  document.getElementById("unName").textContent=name;
  document.getElementById("unSub").textContent="Not listed yet \u2014 no market data";
  document.getElementById("unlistedOverlay").classList.add("open");
  notePopupOpened();
  lockScroll();
}
// No-data tile (Nifty 500 tab, e.g. BAGMANE): the symbol exists but the
// feed carries no price for it — honest empty state, never a made-up
// value or lens verdict.
function openNodata(sym){
  document.getElementById("unName").textContent=(NAMES[sym]||sym)+" ("+sym+")";
  document.getElementById("unSub").textContent="No market data yet \u2014 Yahoo doesn\u2019t carry this symbol, so there\u2019s no price and no lens verdicts";
  document.getElementById("unlistedOverlay").classList.add("open");
  notePopupOpened();
  lockScroll();
}
document.getElementById("grid").addEventListener("click",function(e){
  const c=e.target.closest(".cell");
  if(!c) return;
  if(c.dataset.nodata){ openNodata(c.dataset.sym); return; }
  if(c.dataset.unlisted){ openUnlisted(c.dataset.name); return; }
  if(c.dataset.sym) openStock(c.dataset.sym);
});
const fcWrap=document.getElementById("fcircles");
let fcBtns=[];
function resetFilter(){
  FILTER=activeOrder().map(function(){return 0;});
  paintCircles();
}
function buildFilterUI(){
  // Dot-filter circles: one per lens (7 on both tabs, incl. DRU),
  // labelled. Tap cycles any -> green -> red -> any. Rebuilt on tab
  // switch — the stock set differs per tab, so the filter resets.
  fcWrap.innerHTML="";
  fcBtns=[];
  const order=activeOrder();
  FILTER=order.map(function(){return 0;});
  for(let i=0;i<order.length;i++){
    const wrap=document.createElement("div"); wrap.className="fcol";
    const b=document.createElement("button");
    b.className="fc";
    const lk=order[i];
    b.setAttribute("aria-label",lk+" lens");
    const lab=document.createElement("span"); lab.className="fclab"; lab.textContent=LENS_SHORT[lk];
    wrap.appendChild(b); wrap.appendChild(lab);
    b.onclick=function(){
      FILTER[i]=FILTER[i]===0?1:FILTER[i]===1?-1:0;
      paintCircles(); render();
    };
    fcWrap.appendChild(wrap); fcBtns.push(b);
  }
  const clearBtn=document.createElement("button");
  clearBtn.id="clearFilter"; clearBtn.textContent="Clear";
  clearBtn.onclick=function(){ resetFilter(); render(); };
  fcWrap.appendChild(clearBtn);
  paintCircles();
}
function paintCircles(){
  fcBtns.forEach(function(b,i){
    b.classList.toggle("green",FILTER[i]===1);
    b.classList.toggle("red",FILTER[i]===-1);
  });
}
const overlay=document.getElementById("overlay");
const stockOverlay=document.getElementById("stockOverlay");
const unlistedOverlay=document.getElementById("unlistedOverlay");
// While any popup is open the page behind stays locked; closeAll restores
// it, so the list is visible and scrollable again. (Mobile has no Esc and
// a tall panel can cover the backdrop, so the visible ‹ Back button at the
// top of the panel is the primary way back.)
function lockScroll(){ document.body.style.overflow="hidden"; document.documentElement.style.overflow="hidden"; }
function unlockScroll(){ document.body.style.overflow=""; document.documentElement.style.overflow=""; }
// Popup back navigation (v19): opening a tile popup pushes a history
// state, so the phone's own back button / back gesture clears the popup
// instead of leaving the page. The visible ‹ Back button does the same:
// closeAll() consumes the pushed state with history.back(). The grid
// scroll position is saved on open and restored on close, so "back"
// lands exactly where the tap happened.
let POPUP_OPEN=false, POPUP_STATE=false, SAVED_SCROLL=[0,0];
function notePopupOpened(){
  try{ SAVED_SCROLL=[window.scrollY||0, (document.querySelector("main")||{scrollTop:0}).scrollTop]; }catch(e){ SAVED_SCROLL=[0,0]; }
  if(POPUP_OPEN) return;
  POPUP_OPEN=true;
  try{ history.pushState({lensPopup:true},""); POPUP_STATE=true; }catch(e){ POPUP_STATE=false; }
}
function restoreScroll(){
  try{ window.scrollTo(0,SAVED_SCROLL[0]); const m=document.querySelector("main"); if(m) m.scrollTop=SAVED_SCROLL[1]; }catch(e){}
}
function closePopupDom(){ overlay.classList.remove("open"); stockOverlay.classList.remove("open"); unlistedOverlay.classList.remove("open"); unlockScroll(); restoreScroll(); }
function closeAll(){
  if(POPUP_OPEN){ POPUP_OPEN=false; if(POPUP_STATE){ POPUP_STATE=false; try{ history.back(); }catch(e){} } }
  closePopupDom();
}
window.addEventListener("popstate",function(){
  if(POPUP_OPEN){ POPUP_OPEN=false; POPUP_STATE=false; closePopupDom(); }
});
document.getElementById("gearBtn").onclick=function(){ overlay.classList.add("open"); lockScroll(); };
document.getElementById("closeSettings").onclick=closeAll;
document.getElementById("closeStock").onclick=closeAll;
document.getElementById("closeUnlisted").onclick=closeAll;
document.getElementById("backStock").onclick=closeAll;
document.getElementById("backUnlisted").onclick=closeAll;
document.getElementById("sectorToggleHdr").onclick=function(){
  SECTOR_MODE=!SECTOR_MODE;
  this.classList.toggle("on",SECTOR_MODE);
  render();
};
document.getElementById("azToggleHdr").onclick=function(){
  AZ_MODE=!AZ_MODE;
  if(AZ_MODE){ LENS_MODE=false; RANK_MODE=false; ANALYST_MODE=false; document.getElementById("lensToggleHdr").classList.remove("on"); document.getElementById("rankToggleHdr").classList.remove("on"); document.getElementById("analystToggleHdr").classList.remove("on"); }
  this.classList.toggle("on",AZ_MODE);
  render();
};
// Lenses, Rank, Analysts View and A–Z are mutually exclusive SORTS (v19:
// the pills no longer switch what the tile shows — every tile always
// shows everything; a pill only changes the order). Tapping the active
// pill again returns to the default return sort. No flip to worst-first.
document.getElementById("lensToggleHdr").onclick=function(){
  LENS_MODE=!LENS_MODE;
  if(LENS_MODE){ AZ_MODE=false; RANK_MODE=false; ANALYST_MODE=false; document.getElementById("azToggleHdr").classList.remove("on"); document.getElementById("rankToggleHdr").classList.remove("on"); document.getElementById("analystToggleHdr").classList.remove("on"); }
  this.classList.toggle("on",LENS_MODE);
  render();
};
// Rank pill (v19): sorts by combined rank (#1 first). The tile always
// shows the rank row — the pill only changes the order.
document.getElementById("rankToggleHdr").onclick=function(){
  RANK_MODE=!RANK_MODE;
  if(RANK_MODE){ LENS_MODE=false; AZ_MODE=false; ANALYST_MODE=false; document.getElementById("lensToggleHdr").classList.remove("on"); document.getElementById("azToggleHdr").classList.remove("on"); document.getElementById("analystToggleHdr").classList.remove("on"); }
  this.classList.toggle("on",RANK_MODE);
  render();
};
// Analysts View pill (v19): sorts by upside % (highest first; no-upside
// stocks last). The tile always shows the counts + upside — the pill
// only changes the order.
document.getElementById("analystToggleHdr").onclick=function(){
  ANALYST_MODE=!ANALYST_MODE;
  if(ANALYST_MODE){ LENS_MODE=false; AZ_MODE=false; RANK_MODE=false; document.getElementById("lensToggleHdr").classList.remove("on"); document.getElementById("azToggleHdr").classList.remove("on"); document.getElementById("rankToggleHdr").classList.remove("on"); }
  this.classList.toggle("on",ANALYST_MODE);
  render();
};
// Tabs: Nifty 500 vs My watchlist (default). The lens dot filter resets
// on a tab switch (the stock set differs); Sector / A–Z / Lenses-sort
// modes carry over and apply to the tab now showing.
function switchTab(tab){
  if(TAB===tab) return;
  TAB=tab;
  document.getElementById("tabN500").classList.toggle("on",tab==="n500");
  document.getElementById("tabWl").classList.toggle("on",tab==="wl");
  buildFilterUI();
  render();
}
document.getElementById("tabN500").onclick=function(){ switchTab("n500"); };
document.getElementById("tabWl").onclick=function(){ switchTab("wl"); };
overlay.addEventListener("click",function(e){ if(e.target===overlay) closeAll(); });
stockOverlay.addEventListener("click",function(e){ if(e.target===stockOverlay) closeAll(); });
unlistedOverlay.addEventListener("click",function(e){ if(e.target===unlistedOverlay) closeAll(); });
document.addEventListener("keydown",function(e){ if(e.key==="Escape"){ closeAll(); } });
Promise.all([loadReal(),loadFundamentals(),loadWeeklyPrices(),loadPledging(),loadAnalysts(),loadBrokerCalls(),loadDelivery()]).then(function(){ computeLenses(); buildFilterUI(); render(); });
</script>
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
</script>
</body>
</html>
`;
fs.writeFileSync(__dirname + '/lenses.html', html);
console.log('wrote lenses.html,', html.length, 'bytes,', 'N500', n500Syms.length, 'watchlist', wlSyms.length);

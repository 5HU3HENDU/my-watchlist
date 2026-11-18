// Generate lenses.html — the standalone investor-lenses page: two tabs,
// "Nifty 500" (500 stocks) and "My watchlist" (151 stocks). Each cell
// carries lens dots; tap-a-stock popup shows last-5-days % moves and
// per-lens check detail. Same controls per tab: Sector, A–Z, Lenses
// sort pill, lens dot filter, settings. Default tab is My watchlist —
// the page is still his watchlist page first.
// DATA / LOGIC / VIEW (v10, 18 Nov 2026): the background jobs only update
// DATA files (market-data.json, fundamentals-v2.json, weekly-prices.json,
// pledging.json).
// PWA (v10): the page is installable — manifest.json + sw.js + SVG icons
// (PIL-rendered PNG embedded as base64, since push-files can't push
// binary). The worker is NETWORK-FIRST and only handles the lens page's
// own URLs; Shiva's index.html and his numbered files pass through
// untouched and are never cached. Bump the sw.js cache name when the
// page version bumps.
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
<!-- my-watchlist-lenses-v11 -->
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
  .cell{container-type:inline-size;position:relative;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:0;padding:2px 3px;line-height:1.25;cursor:pointer}
  .wlbadge{position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:#fbbf24}
  .sym{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-size:14cqw;font-weight:700;white-space:nowrap;overflow:hidden;max-width:100%}
  .ret{font-size:10.5px;font-size:12cqw;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;opacity:.95}
  .dots{display:flex;gap:2px;gap:max(2px,1cqw);justify-content:center}
  .dot{width:5px;height:5px;width:max(5px,3cqw);height:max(5px,3cqw);border-radius:50%}
  .dot.up{background:#22c55e}.dot.dn{background:#ef4444}.dot.flat{background:#4b5563}
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
    .sym{font-size:15cqw}
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
  <div class="srow"><div style="font-size:17px;font-weight:800" id="stName"></div><div class="dim" id="stSym"></div></div>
  <div class="srow"><span style="font-size:20px;font-weight:800" id="stPrice"></span> <span id="stChange" style="font-weight:700"></span></div>
  <div class="srow"><div class="dim" style="font-size:12px">Last 5 days</div><div id="stMoves" class="moves"></div></div>
  <div id="stLens"></div>
  <div class="srow" id="stRank"></div>
  <div class="srow" id="stIndices"></div>
  <div class="srow dim" style="font-size:12px">Data as of <span id="stAsof">\u2014</span></div>
  <div class="srow"><a id="stGf" href="#" target="_blank" rel="noopener" style="color:#fbbf24;font-weight:700;text-decoration:none">Google Finance \u2197</a></div>
</div></div>
<div id="unlistedOverlay"><button class="pclose" id="closeUnlisted" aria-label="Close">✕</button><div id="unlistedPanel">
  <div style="font-size:17px;font-weight:800" id="unName"></div>
  <div class="dim" style="margin-top:6px" id="unSub">Not listed yet \u2014 no market data</div>
</div></div>
<script src="scripts/lenses-logic.js"></script>
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
let FUND=null, FUND_ASOF="", WP=null, RUPEE=null, PLEDGE=null;
let LENS_ASOF="", LENS_SESSION="";
const ORDER=["Berkshire","Burry","Axelrod","Jhunjhunwala","Lynch","Marks","Druckenmiller"];
const LENS_SHORT={Berkshire:"BUF",Burry:"BRY",Axelrod:"AXL",Jhunjhunwala:"RJ",Lynch:"LYN",Marks:"MRK",Druckenmiller:"DRU"};
function activeOrder(){ return ORDER; }
function activeLens(){ return TAB==="wl"?LENS_WL:LENS_N500; }
let FILTER=[0,0,0,0,0,0,0];
let SECTOR_MODE=false;
let AZ_MODE=false;
let LENS_MODE=false;
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
  // Legend: 7 lens dots on both tabs (rulebook v0.2).
  document.getElementById("legendLine").innerHTML="7 lens dots \u2014 Buffett, Burry, Axelrod, Jhunjhunwala, Lynch, Marks, Druckenmiller (<span style='color:#22c55e'>\u25cf</span> lens likes it, <span style='color:#ef4444'>\u25cf</span> lens avoids it, <span style='color:#6b7280'>\u25cf</span> neutral)";
  // Pledging: the Jhunjhunwala pledging check is live for My watchlist
  // (Stocks Sena, v10); Nifty 500 gets it after Saturday's refresh.
  document.getElementById("pledgeLine").textContent="Jhunjhunwala lens: promoter pledging is live for My watchlist (Stocks Sena) — Nifty 500 gets it after Saturday's refresh, its stocks show N/A until then.";
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
function computeLenses(){
  // Browser-side scoring (rulebook v0.2, 7 lenses, BOTH tabs) from the
  // loaded data files. No pre-computed lens.json any more. If the logic
  // file or a data file failed to load, leave the lenses empty (grey
  // dots, "data not available yet") rather than breaking the page.
  if(typeof LensLogic==="undefined"||!FUND||!REAL){ LENS_WL=null; LENS_N500=null; return; }
  // Pledging is live for My watchlist only (v10): pledging.json covers
  // the 151 watchlist symbols. Nifty 500 gets pledging after the
  // Saturday refresh fetches the union — pass PLEDGE for N500 then.
  LENS_WL=LensLogic.compute(FUND,REAL,WP,SECTORS,WL_SYMS,PLEDGE);
  LENS_N500=LensLogic.compute(FUND,REAL,WP,SECTORS,N500_SYMS,null);
  LENS_ASOF=FUND_ASOF;
  LENS_SESSION=REAL_SESSION;
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
function cellHtml(r){
  const pctTxt=(r.pct>=0?"+":"")+r.pct.toFixed(2)+"%";
  const dots=r.dots.map(function(v){
    return '<span class="dot '+(v===1?"up":v===0?"dn":"flat")+'"></span>';
  }).join("");
  // Very small amber dot on Nifty 500 tiles for stocks that are also in
  // My watchlist (watchlist tab needs none — every tile there is one).
  const badge=(TAB==="n500"&&WL_SET.has(r.sym))?'<span class="wlbadge" title="In My watchlist"></span>':"";
  return '<div class="cell" data-sym="'+r.sym+'" style="background:'+colorFor(r.pct)+'">'+badge+'<span class="sym">'+r.sym+
    '</span><span class="ret">'+pctTxt+'</span><span class="dots">'+dots+'</span></div>';
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
    return {sym:sym,pct:r.pct,dots:r.dots,g:g,r:rd};
  }).sort(function(a,b){return b.pct-a.pct||(a.sym<b.sym?-1:1);});
  FULL_ROWS=full;
  // Lens sort: green count desc, then red count asc, then today's return desc.
  const lensCmp=function(a,b){return b.g-a.g||a.r-b.r||b.pct-a.pct||(a.sym<b.sym?-1:1);};
  const disp=LENS_MODE?full.slice().sort(lensCmp):AZ_MODE?full.slice().sort(function(a,b){return a.sym<b.sym?-1:1;}):full;
  const rows=disp.filter(function(r){
    return FILTER.every(function(f,i){
      if(f===0||i>=r.dots.length) return true;
      return f===1?r.dots[i]===1:r.dots[i]===0;
    });
  });
  LAST_FALLBACK=fallback; LAST_COUNT=SYMS.length;
  // Settings legend describes the active sort.
  document.getElementById("orderLine").innerHTML=LENS_MODE?
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
    // Sector-block order follows the active sort: lens mode ranks sectors
    // by average greens (then fewest reds, then average return); A–Z is
    // alphabetical; default is average return desc.
    const order=Object.keys(groups).sort(function(a,b){
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
  // Lens breakdown.
  document.getElementById("stLens").innerHTML=lensHtml(sym);
  document.getElementById("stRank").textContent="Rank today: #"+(idx+1)+" of "+FULL_ROWS.length;
  const pills=SUB.filter(function(t){return t.list.indexOf(sym)>=0;}).map(function(t){return t.label;});
  if(WL_SYMS.indexOf(sym)>=0) pills.push("My watchlist");
  document.getElementById("stIndices").innerHTML=pills.map(function(p){return '<span class="pill">'+p+'</span>';}).join("");
  document.getElementById("stAsof").textContent=REAL?REAL_ASOF:"\u2014";
  document.getElementById("stGf").href="https://www.google.com/finance/quote/"+encodeURIComponent(sym)+":NSE";
  document.getElementById("stockOverlay").classList.add("open");
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
function openUnlisted(name){
  document.getElementById("unName").textContent=name;
  document.getElementById("unSub").textContent="Not listed yet \u2014 no market data";
  document.getElementById("unlistedOverlay").classList.add("open");
  lockScroll();
}
// No-data tile (Nifty 500 tab, e.g. BAGMANE): the symbol exists but the
// feed carries no price for it — honest empty state, never a made-up
// value or lens verdict.
function openNodata(sym){
  document.getElementById("unName").textContent=(NAMES[sym]||sym)+" ("+sym+")";
  document.getElementById("unSub").textContent="No market data yet \u2014 Yahoo doesn\u2019t carry this symbol, so there\u2019s no price and no lens verdicts";
  document.getElementById("unlistedOverlay").classList.add("open");
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
// a tall panel can cover the backdrop, so the visible ✕ button is the
// primary way back.)
function lockScroll(){ document.body.style.overflow="hidden"; document.documentElement.style.overflow="hidden"; }
function unlockScroll(){ document.body.style.overflow=""; document.documentElement.style.overflow=""; }
function closeAll(){ overlay.classList.remove("open"); stockOverlay.classList.remove("open"); unlistedOverlay.classList.remove("open"); unlockScroll(); }
document.getElementById("gearBtn").onclick=function(){ overlay.classList.add("open"); lockScroll(); };
document.getElementById("closeSettings").onclick=closeAll;
document.getElementById("closeStock").onclick=closeAll;
document.getElementById("closeUnlisted").onclick=closeAll;
document.getElementById("sectorToggleHdr").onclick=function(){
  SECTOR_MODE=!SECTOR_MODE;
  this.classList.toggle("on",SECTOR_MODE);
  render();
};
document.getElementById("azToggleHdr").onclick=function(){
  AZ_MODE=!AZ_MODE;
  if(AZ_MODE){ LENS_MODE=false; document.getElementById("lensToggleHdr").classList.remove("on"); }
  this.classList.toggle("on",AZ_MODE);
  render();
};
// Lenses and A–Z are mutually exclusive sorts; tapping Lenses again
// returns to the default return sort. No flip to worst-first.
document.getElementById("lensToggleHdr").onclick=function(){
  LENS_MODE=!LENS_MODE;
  if(LENS_MODE){ AZ_MODE=false; document.getElementById("azToggleHdr").classList.remove("on"); }
  this.classList.toggle("on",LENS_MODE);
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
Promise.all([loadReal(),loadFundamentals(),loadWeeklyPrices(),loadPledging()]).then(function(){ computeLenses(); buildFilterUI(); render(); });
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

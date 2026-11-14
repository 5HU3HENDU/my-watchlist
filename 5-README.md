# My watchlist

A public, dependency-free static website: 759-company Indian stock directory, industry filters, 144-company selected watchlist from 146 original rows, sector/industry coverage and 191 separate same-industry comparison candidates.

## Run

Serve this folder with any static HTTP server, for example `python3 -m http.server 8000`, then open http://localhost:8000. No install, keys, build service, external script or account is required. GitHub Pages serves the same project files.

## Files

- `index.html`: live entry point, responsive layout and styles. It maps the data URLs to the source filenames below.
- `1-index.html`: original layout template retained for reference; use index.html to run the site.
- `2-app.js`: search, industry filters, navigation, coverage counts, pagination and copy controls.
- `3-stocks.json`: all original directory entries, original stable numbers, NSE symbols, multi-industry labels, descriptions, company source URLs, Nifty 500/volume-universe badges and average daily volume fields.
- `4-watchlist.json`: exact submitted company names and row order, identity mapping, duplicate handling, NSE exception, matched-industry reasons and comparison candidate symbols.
- `6-prices.json`: price-check snapshot for the 144 watchlist companies (Yahoo Finance daily prices, 13 November 2026 close): latest close, oldest past daily low-high range containing that close, 52-week high and percentage below it, with coverage flags.

## Scope and freshness

The inherited directory is Nifty 500 union the NSE top 500 by average daily share volume, 13 August to 13 November 2026 (64 trading sessions). Company profiles and universe data are the original 13 November snapshot, not re-verified or refreshed by this update. Watchlist mapping updated 14 November 2026. No live market prices or automatic refresh.

Two verified duplicates merge only in display: Anand Rathi Wealth Ltd / Anand Rathi Wealth, and Ather Energy Ltd / Ather Energy. The raw 146 rows remain intact in 4-watchlist.json; 144 unique companies remain, 143 within the original directory. Sources for duplicate identities:
- https://stockanalysis.com/quote/nse/ANANDRATHI/company/
- https://stockanalysis.com/quote/nse/ATHERENERG/company/

NSE itself is retained outside the NSE directory as National Stock Exchange of India Ltd, BSE equity scrip544937, ISIN INE721I01024. The BSE profile shows Category Listed, Equity, Group A/T+1 and Exchange and Data Platform. The company's October30 governance filing confirms legal entity, matching scrip and ISIN, type Equity and no NSE/MSEI symbol. No effective listing date is asserted.
- https://www.bseindia.com/stock-share-price/national-stock-exchange-of-ind/nse/544937/
- https://nsearchives.nseindia.com/web/mediaattachment/2026-10/Integrated_Governance_Q2_2026-27_20261030162630.pdf

## Price check

Added 14 November 2026. For each of the 144 watchlist companies: latest available daily close with its date, the oldest past trading day (strictly before the latest day) whose low-high range included that price, searching back to the start of available history, the split/bonus-adjusted 52-week high, and (high - latest) / high x 100. Source: Yahoo Finance daily OHLC via its public chart endpoint, 13 November 2026 close, tickers `<symbol>.NS` and `NSE.BO` for the BSE-listed NSE exception; closes cross-checked against NSE's official bhavdata for the day.

History is the provider's split/bonus-adjusted daily series; continuity across every recorded split event was verified, so old prices are comparable to today's share basis. Every latest close was cross-checked against NSE's official 13 November 2026 bhavdata (https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_13112026.csv); RCOM's close uses the official 0.83 where Yahoo showed 0.82, and the row says so. Dividends, rights issues and demergers are not adjusted; a large demerger can make an old adjusted range misleading. Every oldest date is the oldest in the provider's available data, not a since-listing record: each row shows where its history starts, listing dates are not independently verified, and no row claims complete since-listing coverage. The 52-week high covers available days only where history starts within the last 52 weeks, marked "available data from <date>". This table is display research, not investment advice or a trading signal.

## Suggested additions

These are comparison candidates, not investment recommendations or edits to the selected watchlist. A candidate must be in the original directory, absent from the selected list, and share at least one narrower source industry tag with a selected company. Broad labels alone, listed in `broadTags` in 4-watchlist.json, never qualify. Every candidate retains its exact shared-tag reason. The rule yields191 candidates, sorted in directory order, not ranked by price, merit or suitability. No companies outside this universe or new sectors are suggested.

Coverage counts all source tags and counts companies, not holdings, allocation or money. Tags overlap and mix broad sectors with narrower industries; labels are not silently harmonized. Watchlist groups use the first source tag within the displayed page. Company numbers never change when filtered.

## Publication

This repository and its GitHub Pages site are publicly viewable. Only this project's authored website, stock data, original selected company rows and source notes are included. No financial account data, credentials or unrelated private files are required. Public availability does not grant rights over third-party source material; company profiles link to their sources. This project makes no claim that stock selections are suitable for investment.

Project notes are in `5-README.md`. The numbered filenames are the actual source filenames in this repository; the live entry point resolves the app's logical data URLs to these paths. No external build or installation is needed.

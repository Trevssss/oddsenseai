# OddSense

OddSense is a responsive football match-analysis workspace. Its dashboard loads live football fixtures from GOAL API and does not fall back to demo data or claim that predictions are certain.

## Run locally

Use Node.js 18 or later. In PowerShell, from this folder:

```powershell
$env:GOAL_API_KEY = "your-key-from-GOAL-API"
node .\server.js
```

Open `http://localhost:4173` and keep the server terminal open. Provider keys stay in the server environment; do not put them in browser code or committed files. If you already have a server running, stop it with Ctrl+C before restarting it with the key set.

## Publish on Vercel

The project is configured for Vercel's static hosting and Node.js serverless functions. Push this project folder to a GitHub repository, import that repository in Vercel, and set the project root to this folder if it is nested inside the repository. Choose **Other** as the framework preset and leave the build command and output directory empty. Vercel detects the API routes in the `api` folder automatically. In the Vercel project settings, add `GOAL_API_KEY` as an environment variable for the environments you plan to use, then deploy. Never add the key to frontend files or expose it with a `NEXT_PUBLIC_` prefix.

The `/api/sports`, `/api/fixtures`, and `/api/fixtures/:fixtureId/analysis` functions forward to the same handler used by the local Node server. Provider access and request limits still depend on your GOAL API plan.

GOAL API is a football (soccer) provider. The dashboard supports date ranges of 1, 3, 7, or 14 days; requests are capped at 14 days and paginated. Basketball, tennis, and other sports need a separate data provider.

The dashboard offers Home Win, Draw, and Away Win selections without requiring bookmaker odds. Users choose their outcome, add it to a manual-entry betslip, and enter a stake. Total odds and payout are deliberately left to the betting app; OddSense does not invent booking codes or submit wagers.

The dashboard's country filter includes England and countries represented by senior fixtures in the selected competitions. Selecting England filters to fixtures from English competitions; competition names remain unchanged (for example, Premier League · England). The dashboard shows senior fixtures from prioritized major competitions and excludes Bangladesh fixtures and youth/reserve sides (U17–U23, academy, reserve, B, and II teams). Fixtures in a multi-day range are grouped under their provider calendar date, with popular leagues ordered first within each day; displayed dates use UTC to match the API date range and avoid browser-timezone shifts. Statistics load when a match is opened to avoid requesting stats for every fixture; available form, head-to-head, season records, and lineup data come from GOAL API and may be unavailable for some competitions or plans. The **Paste games to analyze** box matches pasted team names against eligible fixtures in the selected date range and automatically reloads the full 14-day range if there is no match and the current range is shorter. Matches not listed by GOAL API or outside the 14-day range cannot be found. The feature cannot decode SportyBet, Bet9ja, or MSport booking/reference codes; paste readable fixture names or selections instead.

Open **Ask OddSense AI** on a match to request GOAL API current-season team statistics, recent form, head-to-head results, and lineup/availability data. This can make up to four provider requests per match analysis; successful responses are cached by the local server for five minutes. These are provider-backed statistical summaries, not a guaranteed or calibrated prediction. A directional lean is produced only when both teams have adequate home/away samples and the strongest historical signal is separated from the alternatives; otherwise the analyst says there is no clear pick. Team stats, head-to-head, and lineups can be unavailable for some competitions or plans; per-source errors are shown rather than replaced with invented data.

A selected outcome is marked as won or lost only after GOAL API returns a final fixture result.

SportyBet, Bet9ja, and MSport do not share a universal booking-code format. OddSense copies/shares a manual-entry slip; it does not invent a code or submit a bet. Users must enter selections in the official app and check its current prices.

Betting involves financial risk. Set limits and only wager money you can afford to lose.

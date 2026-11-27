const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT) || 4173;
const goalApiKey = process.env.GOAL_API_KEY;
const goalApiBase = "https://api.goal-api.com/v1/";
const fixturePageSize = 100;
const maxFixturePages = 100;
const analysisCache = new Map();

function formatProviderDetail(value) {
  if (typeof value === "string") return value.slice(0, 500);
  if (value && typeof value === "object") {
    const message = value.message || value.description || value.reason || value.error_description;
    const code = value.code || value.errorCode;
    if (typeof message === "string") {
      return `${message}${typeof code === "string" || typeof code === "number" ? ` (code: ${code})` : ""}`;
    }
    return JSON.stringify(value).slice(0, 500);
  }
  return String(value).slice(0, 500);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

async function goalApiRequest(pathname) {
  const response = await fetch(new URL(pathname, goalApiBase), {
    headers: {
      Authorization: `Bearer ${goalApiKey}`,
      accept: "application/json"
    }
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`GOAL API returned an invalid JSON response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const detail = body?.message || body?.error;
    const extra = body?.details || body?.issues || body?.errors;
    const detailText = detail ? `: ${formatProviderDetail(detail)}` : "";
    const extraText = extra ? ` Details: ${JSON.stringify(extra).slice(0, 500)}` : "";
    throw new Error(`GOAL API returned HTTP ${response.status}${detailText}${extraText}.`);
  }
  if (body?.success !== true || !Object.prototype.hasOwnProperty.call(body, "data")) {
    throw new Error("GOAL API returned an unexpected data response.");
  }
  return body;
}

function getFixtureStatus(event) {
  const status = String(event.matchStatus || event.status || "").toUpperCase();
  if (status === "LIVE") return "live";
  if (["FINISHED", "FULL_TIME", "FT", "AFTER_ET", "AFTER_PEN", "AET", "PEN", "AWARDED"].includes(status)) {
    return "finished";
  }
  return "upcoming";
}

const leagueCountryRules = [
  { pattern: /^(?:english|england) premier league$|^premier league$|\b(?:efl )?championship\b|\bfa cup\b/i, country: "England" },
  { pattern: /\b(?:la ?liga|primera division)\b/i, country: "Spain" },
  { pattern: /\bbundesliga\b/i, country: "Germany" },
  { pattern: /\bbrazilian serie a\b|\bbrasileirao\b|\bcampeonato brasileiro\b/i, country: "Brazil" },
  { pattern: /\bserie a\b/i, country: "Italy" },
  { pattern: /\bligue 1\b/i, country: "France" },
  { pattern: /\beredivisie\b/i, country: "Netherlands" },
  { pattern: /\bprimeira liga\b|\bportuguese league\b/i, country: "Portugal" },
  { pattern: /\bturkish super lig\b|\bsuper lig\b/i, country: "Türkiye" },
  { pattern: /\bscottish premiership\b/i, country: "Scotland" },
  { pattern: /\bmajor league soccer\b|\bmls\b/i, country: "United States" },
  { pattern: /\bsaudi pro league\b/i, country: "Saudi Arabia" },
  { pattern: /\bargentina primera\b/i, country: "Argentina" },
  { pattern: /\b(?:champions|europa|conference) league\b/i, country: "Europe" }
];

function getLeagueCountry(league, providerCountry) {
  const providedCountry = String(providerCountry || "").trim();
  if (providedCountry) return providedCountry;
  const normalizedLeague = String(league || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const knownCountry = leagueCountryRules.find(rule => rule.pattern.test(normalizedLeague))?.country;
  return knownCountry || "";
}

function normalizeFixture(event) {
  const homeName = event.homeTeamName || event.homeTeam?.name || "";
  const awayName = event.awayTeamName || event.awayTeam?.name || "";
  if (!event.id || !homeName || !awayName) return null;

  const status = getFixtureStatus(event);
  const homeScore = event.homeTeamScore ?? null;
  const awayScore = event.awayTeamScore ?? null;
  const hasFinalScore = status === "finished" &&
    homeScore !== null && homeScore !== "" &&
    awayScore !== null && awayScore !== "" &&
    Number.isFinite(Number(homeScore)) && Number.isFinite(Number(awayScore));
  const kickoff = event.kickoffUtc || event.date || event.matchDate || "";
  const league = event.leagueName || event.league?.name || "Football";
  const elapsed = event.matchElapsed ?? event.elapsed;

  const fixture = {
    id: `football-${event.id}`,
    providerFixtureId: String(event.id),
    sport: "football",
    source: "goal-api",
    date: kickoff,
    league,
    country: getLeagueCountry(league, event.countryName || event.league?.country?.name),
    badge: league.slice(0, 3).toUpperCase(),
    time: status === "live" && elapsed !== undefined && elapsed !== null
      ? `${elapsed}'`
      : event.matchTime || event.time || "",
    status,
    home: {
      name: homeName,
      short: homeName.slice(0, 3).toUpperCase(),
      logo: event.teamHomeBadge || event.homeTeam?.badge || "",
      providerTeamId: event.homeTeamId || event.homeTeam?.id || "",
      score: homeScore
    },
    away: {
      name: awayName,
      short: awayName.slice(0, 3).toUpperCase(),
      logo: event.teamAwayBadge || event.awayTeam?.badge || "",
      providerTeamId: event.awayTeamId || event.awayTeam?.id || "",
      score: awayScore
    },
    marketLabel: "CHOOSE AN OUTCOME · 1X2",
    markets: [
      { key: "home", label: `${homeName} Win` },
      { key: "draw", label: "Draw" },
      { key: "away", label: `${awayName} Win` }
    ],
    recommendation: null,
    analysis: {
      form: "Recent form is not included in this fixture response.",
      h2h: "Head-to-head data is not included in this fixture response.",
      metrics: "Open the analyst to load current-season team statistics.",
      availability: "Lineup and availability information has not been requested."
    }
  };

  if (hasFinalScore) {
    const home = Number(homeScore);
    const away = Number(awayScore);
    fixture.result = {
      verified: true,
      provider: "GOAL API",
      marketKeys: [home > away ? "home" : home < away ? "away" : "draw"],
      label: `Final ${home}–${away}`
    };
  }
  return fixture;
}

function percentage(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function teamForm(stats) {
  if (typeof stats?.form === "string" && stats.form.trim()) return stats.form.trim().slice(-5).toUpperCase();
  const recent = Array.isArray(stats?.recentFixtures) ? stats.recentFixtures.slice(0, 5) : [];
  const results = recent.map(match => String(match.result || "").toUpperCase()).filter(result => ["W", "D", "L"].includes(result));
  return results.length ? results.join(" · ") : "Not available";
}

function validRecentMatches(matches) {
  if (!Array.isArray(matches)) return [];
  return matches.filter(match => {
    const status = String(match.match_status || match.matchStatus || "").toLowerCase();
    const rawHome = match.match_hometeam_score ?? match.homeTeamScore;
    const rawAway = match.match_awayteam_score ?? match.awayTeamScore;
    const home = Number(rawHome);
    const away = Number(rawAway);
    return (!status || /finish|full time|after/.test(status)) &&
      rawHome !== null && rawHome !== undefined && rawHome !== "" &&
      rawAway !== null && rawAway !== undefined && rawAway !== "" &&
      Number.isFinite(home) && Number.isFinite(away);
  }).slice(0, 10);
}

function summarizeHeadToHead(data, homeName, awayName) {
  const matches = validRecentMatches(data?.directMatches);
  if (!matches.length) return { text: "No completed head-to-head matches are available.", rates: null, count: 0 };
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  const normalizedHome = String(data.team1Name || homeName).trim().toLowerCase();
  for (const match of matches) {
    const homeScore = Number(match.match_hometeam_score ?? match.homeTeamScore);
    const awayScore = Number(match.match_awayteam_score ?? match.awayTeamScore);
    const matchHome = String(match.match_hometeam_name || match.homeTeamName || "").trim().toLowerCase();
    const homeIsCurrentHome = matchHome === normalizedHome;
    const currentHomeScore = homeIsCurrentHome ? homeScore : awayScore;
    const currentAwayScore = homeIsCurrentHome ? awayScore : homeScore;
    if (currentHomeScore > currentAwayScore) homeWins += 1;
    else if (currentHomeScore < currentAwayScore) awayWins += 1;
    else draws += 1;
  }
  const count = matches.length;
  return {
    text: `${homeName}: ${homeWins} wins · ${draws} draws · ${awayName}: ${awayWins} wins (${count} completed meetings)`,
    rates: { home: homeWins / count * 100, draw: draws / count * 100, away: awayWins / count * 100 },
    count
  };
}

function buildStatisticalLean(homeStats, awayStats, headToHead, homeName, awayName) {
  const homeSplit = homeStats?.home || homeStats?.overall || {};
  const awaySplit = awayStats?.away || awayStats?.overall || {};
  const homePlayed = Number(homeSplit.played);
  const awayPlayed = Number(awaySplit.played);
  const homeWin = percentage(homeSplit.winPercentage);
  const homeDraw = percentage(homeSplit.drawPercentage);
  const homeLoss = percentage(homeSplit.lossPercentage);
  const awayWin = percentage(awaySplit.winPercentage);
  const awayDraw = percentage(awaySplit.drawPercentage);
  const awayLoss = percentage(awaySplit.lossPercentage);
  if (![homeWin, homeDraw, homeLoss, awayWin, awayDraw, awayLoss].every(value => value !== null) ||
      !Number.isFinite(homePlayed) || !Number.isFinite(awayPlayed) || homePlayed < 5 || awayPlayed < 5) {
    return null;
  }

  const seasonal = {
    home: (homeWin + awayLoss) / 2,
    draw: (homeDraw + awayDraw) / 2,
    away: (awayWin + homeLoss) / 2
  };
  const seasonalTotal = seasonal.home + seasonal.draw + seasonal.away;
  if (!seasonalTotal) return null;
  for (const key of Object.keys(seasonal)) seasonal[key] = seasonal[key] / seasonalTotal * 100;

  const h2hWeight = headToHead.count >= 3 ? 0.2 : 0;
  const historicalShare = Object.fromEntries(Object.keys(seasonal).map(key => [
    key,
    Math.round(seasonal[key] * (1 - h2hWeight) + (headToHead.rates?.[key] || 0) * h2hWeight)
  ]));
  const ranked = Object.entries(historicalShare).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] - ranked[1][1] < 5) return null;
  const labels = { home: `${homeName} Win`, draw: "Draw", away: `${awayName} Win` };
  return {
    marketKey: ranked[0][0],
    label: labels[ranked[0][0]],
    historicalShare: ranked[0][1],
    type: "statistical-lean",
    sample: {
      homeMatches: homePlayed,
      awayMatches: awayPlayed,
      headToHeadMatches: headToHead.count
    }
  };
}

function formatTeamStats(name, stats, splitName) {
  if (!stats || typeof stats !== "object") return `${name}: current-season statistics unavailable.`;
  const split = stats[splitName] || stats.overall || {};
  const played = Number(split.played);
  const win = percentage(split.winPercentage);
  const draw = percentage(split.drawPercentage);
  const loss = percentage(split.lossPercentage);
  const scored = split.avgGoalsScored == null ? NaN : Number(split.avgGoalsScored);
  const conceded = split.avgGoalsConceded == null ? NaN : Number(split.avgGoalsConceded);
  const record = [win, draw, loss].every(value => value !== null)
    ? `W/D/L ${win.toFixed(0)}% / ${draw.toFixed(0)}% / ${loss.toFixed(0)}%`
    : "win/draw/loss rates unavailable";
  const goalAverage = Number.isFinite(scored) && Number.isFinite(conceded)
    ? ` · avg goals ${scored.toFixed(2)} scored / ${conceded.toFixed(2)} conceded`
    : "";
  return `${name} (${splitName}, ${Number.isFinite(played) ? played : 0} matches): ${record}${goalAverage}`;
}

async function optionalGoalData(pathname) {
  try {
    const result = await goalApiRequest(pathname);
    return { data: result.data, error: "" };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

async function getFixtureAnalysis(fixtureId, homeTeamId, awayTeamId, homeName, awayName) {
  const cacheKey = [fixtureId, homeTeamId, awayTeamId].join(":");
  const cached = analysisCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [homeStatsResult, awayStatsResult, h2hResult, lineupsResult] = await Promise.all([
    optionalGoalData(`teams/${encodeURIComponent(homeTeamId)}/statistics`),
    optionalGoalData(`teams/${encodeURIComponent(awayTeamId)}/statistics`),
    optionalGoalData(`h2h/${encodeURIComponent(homeTeamId)}/${encodeURIComponent(awayTeamId)}`),
    optionalGoalData(`fixtures/${encodeURIComponent(fixtureId)}/lineups`)
  ]);
  const homeStats = homeStatsResult.data;
  const awayStats = awayStatsResult.data;
  const h2hData = h2hResult.data;
  const h2h = summarizeHeadToHead(h2hData, homeName, awayName);
  const homeForm = teamForm(homeStats);
  const awayForm = teamForm(awayStats);
  const lineups = lineupsResult.data;
  const missingPlayers = [lineups?.home?.missingPlayers, lineups?.away?.missingPlayers]
    .flat()
    .filter(Boolean)
    .map(player => player.player?.name || player.name || player.playerName || player.lineupPlayer)
    .filter(Boolean);
  const availability = lineups?.hasLineups
    ? missingPlayers.length
      ? `Lineups available; reported unavailable players: ${missingPlayers.join(", ")}.`
      : "Lineups available; no unavailable players were listed."
    : "Lineups or injury data are not available for this fixture.";
  const recommendation = buildStatisticalLean(homeStats, awayStats, h2h, homeName, awayName);
  const errors = [homeStatsResult.error, awayStatsResult.error, h2hResult.error, lineupsResult.error].filter(Boolean);
  const value = {
    analysis: {
      form: `${homeName}: ${homeForm} · ${awayName}: ${awayForm}`,
      h2h: h2h.text,
      metrics: [
        formatTeamStats(homeName, homeStats, "home"),
        formatTeamStats(awayName, awayStats, "away"),
        recommendation
          ? `Historical signal: ${recommendation.label} ${recommendation.historicalShare}% (not a calibrated probability).`
          : "No clear statistical lean; the available historical rates are too close or incomplete."
      ].join(" "),
      availability,
      sources: [
        ...(homeStats || awayStats ? ["GOAL API team statistics"] : []),
        ...(h2hData ? ["GOAL API head-to-head"] : []),
        ...(lineups ? ["GOAL API lineups"] : [])
      ],
      errors
    },
    recommendation
  };
  if (value.analysis.sources.length) {
    analysisCache.set(cacheKey, { value, expiresAt: Date.now() + 5 * 60 * 1000 });
  }
  return value;
}

function expandDateRange(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
      start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to || end < start) {
    const error = new Error("from and to must be valid dates in YYYY-MM-DD format, with to on or after from.");
    error.statusCode = 400;
    throw error;
  }
  const days = Math.round((end - start) / 86400000) + 1;
  if (days > 14) {
    const error = new Error("Date ranges are limited to 14 days to protect GOAL API request quotas.");
    error.statusCode = 400;
    throw error;
  }
}

async function getFixtures(from, to) {
  expandDateRange(from, to);
  if (!goalApiKey) {
    const error = new Error("Set GOAL_API_KEY in the server environment to load live data.");
    error.statusCode = 503;
    throw error;
  }

  const events = [];
  let offset = 0;
  for (let page = 0; page < maxFixturePages; page += 1) {
    const query = new URLSearchParams({
      from,
      to,
      limit: String(fixturePageSize),
      offset: String(offset)
    });
    const result = await goalApiRequest(`fixtures?${query}`);
    if (!Array.isArray(result.data)) {
      throw new Error("GOAL API returned an unexpected fixtures list.");
    }
    const total = Number(result.pagination?.total);
    if (Number.isInteger(total) && total > fixturePageSize * maxFixturePages) {
      throw new Error(`GOAL API reports ${total} fixtures in this date range, above OddSense's ${fixturePageSize * maxFixturePages}-fixture limit. Try a shorter date range.`);
    }
    events.push(...result.data);
    if (result.pagination?.hasMore !== true) break;
    const nextOffset = Number(result.pagination.offset) + Number(result.pagination.limit);
    if (!Number.isInteger(nextOffset) || nextOffset <= offset) {
      throw new Error("GOAL API returned invalid fixture pagination data.");
    }
    offset = nextOffset;
    if (page === maxFixturePages - 1) {
      throw new Error(`GOAL API returned more fixtures than OddSense can load in one request (${maxFixturePages * fixturePageSize}). Try a shorter date range.`);
    }
  }

  return { fixtures: events.map(normalizeFixture).filter(Boolean) };
}

function serveFile(requestPath, response) {
  const pathname = decodeURIComponent(requestPath);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (!["index.html", "dashboard.html", "styles.css", "landing.css", "script.js", "landing.js"].includes(relative)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const filePath = path.resolve(root, relative);
  const relativePath = path.relative(root, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Could not read requested file");
      return;
    }
    response.writeHead(200, {
      "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "x-content-type-options": "nosniff"
    });
    response.end(contents);
  });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/api/sports") {
    sendJson(response, 200, { provider: "GOAL API", sports: ["football"] });
    return;
  }
  const analysisRoute = url.pathname.match(/^\/api\/fixtures\/([^/]+)\/analysis$/);
  if (request.method === "GET" && analysisRoute) {
    const fixtureId = decodeURIComponent(analysisRoute[1]);
    const homeTeamId = url.searchParams.get("homeTeamId") || "";
    const awayTeamId = url.searchParams.get("awayTeamId") || "";
    const homeName = url.searchParams.get("homeName") || "";
    const awayName = url.searchParams.get("awayName") || "";
    if (![fixtureId, homeTeamId, awayTeamId].every(value => /^[\w-]{1,100}$/.test(value)) ||
        !homeName.trim() || !awayName.trim() || homeName.length > 100 || awayName.length > 100) {
      sendJson(response, 400, { error: "This fixture is missing valid GOAL API team IDs or names for analysis." });
      return;
    }
    if (!goalApiKey) {
      sendJson(response, 503, { error: "Set GOAL_API_KEY in the server environment to load match statistics." });
      return;
    }
    try {
      const result = await getFixtureAnalysis(fixtureId, homeTeamId, awayTeamId, homeName, awayName);
      sendJson(response, 200, result);
    } catch (error) {
      console.error(`GOAL API analysis request failed for fixture ${fixtureId}: ${error.message}`);
      sendJson(response, error.statusCode || 502, { error: error.message });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/fixtures") {
    const from = url.searchParams.get("from") || url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const to = url.searchParams.get("to") || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      sendJson(response, 400, { error: "from and to must use YYYY-MM-DD format." });
      return;
    }
    try {
      const result = await getFixtures(from, to);
      sendJson(response, 200, { provider: "GOAL API", ...result });
    } catch (error) {
      console.error(`GOAL API fixture request failed: ${error.message}`);
      sendJson(response, error.statusCode || 502, { error: error.message });
    }
    return;
  }
  if (request.method !== "GET") {
    response.writeHead(405, { allow: "GET" });
    response.end("Method not allowed");
    return;
  }
  serveFile(url.pathname, response);
}

if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(port, "127.0.0.1", () => {
    console.log(`OddSense listening at http://localhost:${port}`);
  });
}

module.exports = handleRequest;

(function () {
  const data = window.CHAMPIONSHIP_DATA;
  const teams = new Map(data.teams.map((team) => [team.name, team]));
  const money = new Intl.NumberFormat("pt-BR");

  const byDate = (a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "");
  let officialMatches = [];
  let completedSchedule = [];
  let upcomingSchedule = [];
  let activeStatsCategory = "A";

  function el(selector) {
    return document.querySelector(selector);
  }

  function formatDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short"
    });
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (quoted && char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (!quoted && char === ",") {
        row.push(cell);
        cell = "";
      } else if (!quoted && (char === "\n" || char === "\r")) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    return rows;
  }

  async function loadEditableScores() {
    try {
      const response = await fetch("./data/placares.csv", { cache: "no-store" });
      if (!response.ok) return;
      const rows = parseCsv(await response.text());
      const headers = rows.shift();
      const index = Object.fromEntries(headers.map((header, i) => [header, i]));
      rows.forEach((row) => {
        const category = row[index.Categoria]?.trim();
        const round = Number(row[index.Rodada]);
        const date = row[index["Data Cronograma"]]?.trim();
        const home = row[index.Mandante]?.trim();
        const away = row[index.Visitante]?.trim();
        const game = data.schedule.find(
          (item) =>
            item.category === category &&
            item.round === round &&
            item.date === date &&
            item.home === home &&
            item.away === away
        );
        if (!game) return;
        const homeScore = Number(row[index["Placar Mandante"]]);
        const awayScore = Number(row[index["Placar Visitante"]]);
        const status = row[index.Status]?.trim() || "Agendado";
        game.time = row[index.Horario]?.trim() || game.time;
        game.actualDate = row[index["Data Real"]]?.trim() || null;
        game.status = status;
        if (status === "Final" && Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
          game.homeScore = homeScore;
          game.awayScore = awayScore;
        } else {
          delete game.homeScore;
          delete game.awayScore;
        }
      });
    } catch (error) {
      console.warn("Placares editaveis indisponiveis; usando dados embutidos.", error);
    }
  }

  function recomputeStandings() {
    data.standings = [];
    ["A", "B"].forEach((category) => {
      const names = Array.from(
        new Set(
          data.schedule
            .filter((game) => game.category === category)
            .flatMap((game) => [game.home, game.away])
        )
      ).sort();
      const rows = Object.fromEntries(
        names.map((name) => [
          name,
          {
            team: name,
            abbr: teams.get(name)?.abbr || "",
            category,
            played: 0,
            wins: 0,
            losses: 0,
            pf: 0,
            pa: 0,
            diff: 0,
            points: 0,
            status: "Playoffs"
          }
        ])
      );
      data.schedule
        .filter((game) => game.category === category && Number.isFinite(game.homeScore))
        .forEach((game) => {
          const home = rows[game.home];
          const away = rows[game.away];
          home.played += 1;
          away.played += 1;
          home.pf += game.homeScore;
          home.pa += game.awayScore;
          away.pf += game.awayScore;
          away.pa += game.homeScore;
          home.wins += game.homeScore > game.awayScore ? 1 : 0;
          home.losses += game.homeScore < game.awayScore ? 1 : 0;
          away.wins += game.awayScore > game.homeScore ? 1 : 0;
          away.losses += game.awayScore < game.homeScore ? 1 : 0;
          home.points += game.homeScore > game.awayScore ? 2 : 1;
          away.points += game.awayScore > game.homeScore ? 2 : 1;
        });
      const sorted = Object.values(rows)
        .map((row) => ({ ...row, diff: row.pf - row.pa }))
        .sort((a, b) => b.wins - a.wins || b.diff - a.diff || b.pf - a.pf || a.team.localeCompare(b.team));
      sorted.forEach((row, index) => {
        row.rank = index + 1;
        data.standings.push(row);
      });
    });
  }

  function refreshDerivedData() {
    recomputeStandings();
    completedSchedule = data.schedule.filter((game) => Number.isFinite(game.homeScore));
    upcomingSchedule = data.schedule.filter((game) => !Number.isFinite(game.homeScore)).sort(byDate);
    officialMatches = completedSchedule.map((game) => ({
      ...game,
      official: true,
      date: game.actualDate || game.date,
      phase: "Classificacao"
    }));
    data.teamStats = ["A", "B"].flatMap((category) => {
      const names = Array.from(
        new Set(
          data.schedule
            .filter((game) => game.category === category)
            .flatMap((game) => [game.home, game.away])
        )
      ).sort();
      return names.map((team) => {
        const games = data.schedule.filter(
          (game) => game.category === category && Number.isFinite(game.homeScore) && [game.home, game.away].includes(team)
        );
        const scored = [];
        const allowed = [];
        games.forEach((game) => {
          if (game.home === team) {
            scored.push(game.homeScore);
            allowed.push(game.awayScore);
          } else {
            scored.push(game.awayScore);
            allowed.push(game.homeScore);
          }
        });
        return {
          category,
          team,
          abbr: teams.get(team)?.abbr || "",
          games: games.length,
          ppg: scored.length ? Number((scored.reduce((sum, value) => sum + value, 0) / scored.length).toFixed(1)) : 0,
          papg: allowed.length ? Number((allowed.reduce((sum, value) => sum + value, 0) / allowed.length).toFixed(1)) : 0,
          diffAvg: scored.length
            ? Number(((scored.reduce((sum, value) => sum + value, 0) - allowed.reduce((sum, value) => sum + value, 0)) / scored.length).toFixed(1))
            : 0,
          high: scored.length ? Math.max(...scored) : 0
        };
      });
    });
  }

  function teamLogo(name) {
    const team = teams.get(name);
    const bg = team ? team.primary : "#071b3a";
    return `<span class="team-logo" style="background:${bg}">${team ? team.abbr : name.slice(0, 3)}</span>`;
  }

  function teamCell(name) {
    const team = teams.get(name);
    return `
      <span class="team-cell">
        ${teamLogo(name)}
        <span class="team-name">
          <strong>${name}</strong>
          <small>${team ? team.abbr : ""}</small>
        </span>
      </span>
    `;
  }

  function setMetrics() {
    const points = officialMatches.reduce((sum, game) => sum + game.homeScore + game.awayScore, 0);
    const next = upcomingSchedule[0];
    el("#metric-games").textContent = completedSchedule.length;
    el("#metric-points").textContent = money.format(points);
    el("#metric-teams").textContent = data.standings.length;
    el("#metric-next").textContent = next ? formatDate(next.date) : "Final";
  }

  function renderStandings(target, category, limit) {
    const rows = data.standings
      .filter((row) => row.category === category)
      .slice(0, limit || 99)
      .map((row) => `
        <tr>
          <td>${row.rank}</td>
          <td>${teamCell(row.team)}</td>
          <td>${row.played}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${row.pf}</td>
          <td>${row.pa}</td>
          <td class="${row.diff >= 0 ? "winner" : "scheduled"}">${row.diff > 0 ? "+" : ""}${row.diff}</td>
        </tr>
      `)
      .join("");
    el(target).innerHTML = rows;
  }

  function renderLatestResults() {
    const latest = officialMatches
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
    el("#latest-results").innerHTML = latest
      .map((game) => `
        <article class="result-card">
          <div>${teamCell(game.home)}</div>
          <div class="score">${game.homeScore} - ${game.awayScore}</div>
          <div>${teamCell(game.away)}</div>
        </article>
      `)
      .join("");
  }

  function topBy(metric, count, category = activeStatsCategory) {
    return data.players
      .filter((player) => player.games > 0 && player.category === category)
      .slice()
      .sort((a, b) => b[metric] - a[metric] || b.games - a.games)
      .slice(0, count);
  }

  function renderOverviewLeaders() {
    const leaders = [
      ["Pontos", "ptsAvg"],
      ["Rebotes", "rebAvg"],
      ["Assistencias", "astAvg"],
      ["Eficiencia", "effAvg"]
    ];
    el("#overview-leaders").innerHTML = leaders
      .map(([label, metric]) => {
        const player = data.players
          .filter((item) => item.games > 0)
          .slice()
          .sort((a, b) => b[metric] - a[metric] || b.games - a.games)[0];
        return `
          <article class="leader-card">
            <span>${label}</span>
            <strong>${player ? player[metric].toFixed(1) : "0.0"}</strong>
            <small>${player ? `${player.name} - ${player.abbr} / Cat. ${player.category}` : "Sem dados"}</small>
          </article>
        `;
      })
      .join("");
  }

  function renderLeaderTable(target, metric) {
    el(target).innerHTML = topBy(metric, 8)
      .map((player, index) => `
        <div class="leader-row">
          <div class="game-teams">
            ${teamLogo(player.team)}
            <span>
              <strong>${index + 1}. ${player.name}</strong>
              <small>${player.team} - ${player.games} jogo${player.games === 1 ? "" : "s"}</small>
            </span>
          </div>
          <span class="leader-value">${player[metric].toFixed(1)}</span>
        </div>
      `)
      .join("");
  }

  function renderStatsCategory(category = activeStatsCategory) {
    activeStatsCategory = category;
    document.querySelectorAll("[data-stats-category]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.statsCategory === category);
    });
    const label = `Categoria ${category}`;
    const players = data.players.filter((player) => player.category === category);
    const games = data.schedule.filter((game) => game.category === category && Number.isFinite(game.homeScore));
    const totalPoints = games.reduce((sum, game) => sum + game.homeScore + game.awayScore, 0);
    el("#stats-category-label").textContent = label;
    el("#stats-command-title").textContent = `Leaders da ${label}`;
    el("#stat-games").textContent = games.length;
    el("#stat-players").textContent = players.length;
    el("#stat-ppg").textContent = games.length ? (totalPoints / games.length).toFixed(1) : "0.0";
    renderLeaderTable("#points-leaders", "ptsAvg");
    renderLeaderTable("#rebounds-leaders", "rebAvg");
    renderLeaderTable("#assists-leaders", "astAvg");
    renderLeaderTable("#steals-leaders", "stlAvg");
    renderLeaderTable("#blocks-leaders", "blkAvg");
    requestAnimationFrame(drawCharts);
  }

  function gameCard(game) {
    const final = Number.isFinite(game.homeScore);
    const label = game.category === "TI" ? "Torneio Inicio" : `Categoria ${game.category}`;
    return `
      <article class="game-card" data-category="${game.category}" data-upcoming="${final ? "false" : "true"}">
        <header>
          <span class="badge">${label}</span>
          <span class="meta">${formatDate(game.date)}${game.time ? ` - ${game.time}` : ""}</span>
        </header>
        <div class="game-line">
          <span class="game-teams">${teamLogo(game.home)}<strong>${game.home}</strong></span>
          <span class="score-value ${final && game.homeScore > game.awayScore ? "winner" : ""}">
            ${final ? game.homeScore : "-"}
          </span>
        </div>
        <div class="game-line">
          <span class="game-teams">${teamLogo(game.away)}<strong>${game.away}</strong></span>
          <span class="score-value ${final && game.awayScore > game.homeScore ? "winner" : ""}">
            ${final ? game.awayScore : "-"}
          </span>
        </div>
        <p class="meta">${final ? "Final" : "Agendado"}${game.actualDate ? ` - remarcado para ${formatDate(game.actualDate)}` : ""}</p>
      </article>
    `;
  }

  function renderGames(filter = "all") {
    const completed = data.schedule
      .filter((game) => Number.isFinite(game.homeScore))
      .map((game) => ({ ...game, official: true }));
    const upcoming = upcomingSchedule.map((game) => ({ ...game }));
    const tournament = data.matches
      .filter((game) => game.category === "TI")
      .map((game) => ({ ...game }));
    let games = [...completed, ...upcoming, ...tournament].sort(byDate);
    if (filter === "upcoming") games = games.filter((game) => !Number.isFinite(game.homeScore));
    if (["A", "B", "TI"].includes(filter)) games = games.filter((game) => game.category === filter);
    el("#games-grid").innerHTML = games.map(gameCard).join("");
  }

  function renderRules() {
    const blocks = [
      ...data.rules.categories,
      ...data.rules.format,
      ...data.rules.eligibility,
      ...data.rules.participation,
      ...data.rules.punishment
    ];
    el("#rules-list").innerHTML = blocks.map((item) => `<div class="rule-item">${item}</div>`).join("");
    el("#tie-list").innerHTML = data.rules.tiebreakers.map((item) => `<li>${item}</li>`).join("");
  }

  function drawBarChart(canvasId, rows, valueKey, options = {}) {
    const canvas = el(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.scale(ratio, ratio);

    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);
    const pad = { top: 22, right: 20, bottom: 54, left: 48 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const values = rows.map((row) => row[valueKey]);
    const min = Math.min(0, ...values);
    const max = Math.max(...values, 1);
    const span = max - min || 1;

    ctx.strokeStyle = "#d9e2ef";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
    }

    const barGap = 8;
    const barW = Math.max(16, (plotW - barGap * (rows.length - 1)) / rows.length);
    const zeroY = pad.top + plotH - ((0 - min) / span) * plotH;
    rows.forEach((row, index) => {
      const x = pad.left + index * (barW + barGap);
      const y = pad.top + plotH - ((row[valueKey] - min) / span) * plotH;
      const h = Math.abs(zeroY - y);
      const team = teams.get(row.team);
      ctx.fillStyle = row[valueKey] < 0 ? "#c73737" : team?.primary || "#0757c7";
      ctx.fillRect(x, Math.min(y, zeroY), barW, Math.max(2, h));
      ctx.fillStyle = "#071b3a";
      ctx.font = "800 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(row.abbr, x + barW / 2, height - 26);
      ctx.fillStyle = "#64748b";
      ctx.fillText(options.suffix ? `${row[valueKey]}${options.suffix}` : row[valueKey], x + barW / 2, Math.min(y, zeroY) - 8);
    });
  }

  function bindNavigation() {
    document.querySelectorAll("[data-tab], [data-jump]").forEach((control) => {
      control.addEventListener("click", (event) => {
        const target = control.dataset.tab || control.dataset.jump;
        if (!target) return;
        event.preventDefault();
        document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === target));
        document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === target));
        if (target === "overview") el(".hero").style.display = "grid";
        else el(".hero").style.display = "none";
        window.history.replaceState(null, "", `#${target}`);
        window.scrollTo({ top: 0, behavior: "smooth" });
        requestAnimationFrame(drawCharts);
      });
    });

    document.querySelectorAll("[data-game-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-game-filter]").forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        renderGames(button.dataset.gameFilter);
      });
    });

    document.querySelectorAll("[data-stats-category]").forEach((button) => {
      button.addEventListener("click", () => renderStatsCategory(button.dataset.statsCategory));
    });
  }

  function drawCharts() {
    drawBarChart("#team-ppg-chart", data.teamStats.filter((row) => row.games && row.category === "A").sort((a, b) => b.ppg - a.ppg), "ppg");
    drawBarChart(
      "#team-diff-chart",
      data.teamStats.filter((row) => row.games && row.category === activeStatsCategory).sort((a, b) => b.diffAvg - a.diffAvg),
      "diffAvg"
    );
  }

  function initFromHash() {
    const hash = window.location.hash.replace("#", "");
    const valid = ["overview", "games", "standings", "stats", "rules"].includes(hash) ? hash : "overview";
    document.querySelector(`[data-tab="${valid}"]`)?.click();
  }

  async function init() {
    await loadEditableScores();
    refreshDerivedData();
    setMetrics();
    renderStandings("#overview-standings-a", "A", 8);
    renderStandings("#standings-a", "A");
    renderStandings("#standings-b", "B");
    renderLatestResults();
    renderOverviewLeaders();
    renderStatsCategory("A");
    renderGames();
    renderRules();
    bindNavigation();
    initFromHash();
    window.addEventListener("resize", drawCharts);
  }

  init();
})();

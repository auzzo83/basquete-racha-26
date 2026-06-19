(function () {
  const data = window.CHAMPIONSHIP_DATA;
  const teams = new Map(data.teams.map((team) => [team.name, team]));
  const money = new Intl.NumberFormat("pt-BR");
  function localTodayIso() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const byDate = (a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "");
  let officialMatches = [];
  let completedSchedule = [];
  let upcomingSchedule = [];
  let activeStatsCategory = "A";

  function el(selector) {
    return document.querySelector(selector);
  }

  function safe(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
    data.schedule.forEach((game) => {
      const candidates = data.matches.filter(
        (item) =>
          item.official &&
          item.category === game.category &&
          [item.home, item.away].includes(game.home) &&
          [item.home, item.away].includes(game.away)
      );
      const match = candidates.find((item) => item.date === (game.actualDate || game.date)) || candidates[0];
      if (match) game.id = match.id;
    });
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
    const todayIso = localTodayIso();
    const next = upcomingSchedule.find((game) => game.date >= todayIso);
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
          <td>
            <button class="team-button" type="button" data-team-name="${safe(row.team)}" data-team-category="${safe(category)}">
              ${teamCell(row.team)}
            </button>
          </td>
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
    bindDetailClicks();
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
      .filter((player) => player.games >= 2 && player.category === category)
      .slice()
      .sort((a, b) => b[metric] - a[metric] || b.games - a.games)
      .slice(0, count);
  }

  function mvpScore(player) {
    return Number(
      (
        player.ptsAvg * 1.0 +
        player.rebAvg * 1.15 +
        player.astAvg * 1.35 +
        player.stlAvg * 2.2 +
        player.blkAvg * 2.0 +
        player.effAvg * 0.55
      ).toFixed(1)
    );
  }

  function renderMvpRace() {
    const top = data.players
      .filter((player) => player.games >= 2 && player.category === activeStatsCategory)
      .map((player) => ({ ...player, mvp: mvpScore(player) }))
      .sort((a, b) => b.mvp - a.mvp || b.games - a.games)
      .slice(0, 3);
    el("#mvp-race").innerHTML = top
      .map((player, index) => `
        <button class="mvp-card rank-${index + 1}" type="button" data-player-key="${safe(player.playerKey)}" data-player-category="${safe(player.category)}">
          <span class="mvp-rank">#${index + 1}</span>
          <span class="mvp-name">${safe(player.name)}</span>
          <span class="mvp-team">${safe(player.abbr)} · Cat. ${safe(player.category)} · ${player.games} jogos</span>
          <span class="mvp-score">${player.mvp.toFixed(1)}</span>
          <span class="mvp-line">${player.ptsAvg.toFixed(1)} PTS · ${player.rebAvg.toFixed(1)} REB · ${player.astAvg.toFixed(1)} AST · ${player.effAvg.toFixed(1)} EFF</span>
        </button>
      `)
      .join("");
  }

  function renderOverviewLeaders() {
    const metrics = [
      ["Pontos", "ptsAvg"],
      ["Rebotes", "rebAvg"],
      ["Assist.", "astAvg"],
      ["Efic.", "effAvg"]
    ];
    el("#overview-leaders").innerHTML = ["A", "B"]
      .map((category) => `
        <article class="leader-card overview-category-leaders">
          <span>Categoria ${category}</span>
          ${metrics.map(([label, metric]) => {
            const player = data.players
              .filter((item) => item.games >= 2 && item.category === category)
              .slice()
              .sort((a, b) => b[metric] - a[metric] || b.games - a.games)[0];
            return `
              <button type="button" class="mini-leader" data-player-key="${safe(player?.playerKey || "")}" data-player-category="${category}">
                <b>${label}</b>
                <strong>${player ? player[metric].toFixed(1) : "0.0"}</strong>
                <small>${player ? `${safe(player.name)} - ${safe(player.abbr)}` : "Sem dados"}</small>
              </button>
            `;
          }).join("")}
        </article>
      `)
      .join("");
    bindDetailClicks();
  }

  function renderLeaderTable(target, metric) {
    el(target).innerHTML = topBy(metric, 8)
      .map((player, index) => `
        <button class="leader-row" type="button" data-player-key="${safe(player.playerKey)}" data-player-category="${safe(player.category)}">
          <div class="game-teams">
            ${teamLogo(player.team)}
            <span>
              <strong>${index + 1}. ${safe(player.name)}</strong>
              <small>${safe(player.team)} - ${player.games} jogo${player.games === 1 ? "" : "s"}</small>
            </span>
          </div>
          <span class="leader-value">${player[metric].toFixed(1)}</span>
        </button>
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
    renderMvpRace();
    bindDetailClicks();
    requestAnimationFrame(drawCharts);
  }

  function gameCard(game) {
    const final = Number.isFinite(game.homeScore);
    const label = game.category === "TI" ? "Torneio Inicio" : `Categoria ${game.category}`;
    return `
      <button class="game-card" type="button" data-game-id="${safe(game.id || game.scheduleId || "")}" data-category="${game.category}" data-upcoming="${final ? "false" : "true"}">
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
        <p class="meta">${final ? "Final" : "Agendado"}</p>
      </button>
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
    bindDetailClicks();
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

    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeModal();
    });
  }

  function bindDetailClicks() {
    document.querySelectorAll("[data-game-id]").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", () => openGameDetail(button.dataset.gameId));
    });
    document.querySelectorAll("[data-player-key]").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", () => openPlayerDetail(button.dataset.playerKey, button.dataset.playerCategory));
    });
    document.querySelectorAll("[data-team-name]").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", () => openTeamDetail(button.dataset.teamName, button.dataset.teamCategory));
    });
  }

  function openModal(html) {
    el("#modal-content").innerHTML = html;
    const modal = el("#detail-modal");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    bindDetailClicks();
  }

  function closeModal() {
    const modal = el("#detail-modal");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  function statPill(label, value) {
    return `<div class="detail-stat"><strong>${value}</strong><small>${label}</small></div>`;
  }

  function openGameDetail(gameId) {
    const match = data.matches.find((item) => item.id === gameId);
    if (!match) return;
    const players = data.playerGames
      .filter((player) => player.gameId === gameId)
      .sort((a, b) => b.pts - a.pts || b.reb - a.reb || b.ast - a.ast);
    const rosterRows = (team) => players
      .filter((player) => player.team === team)
      .sort((a, b) => Number(a.number) - Number(b.number))
      .map((player) => `
        <button class="box-row full-stat" type="button" data-player-key="${safe(player.playerKey)}" data-player-category="${safe(player.category)}">
          <span><strong>${safe(player.name)}</strong><small>#${safe(player.number)} · ${safe(player.min)} min</small></span>
          <b>${player.pts}</b><b>${player.oreb}</b><b>${player.dreb}</b><b>${player.reb}</b><b>${player.ast}</b><b>${player.stl}</b><b>${player.blk}</b><b>${player.turnovers}</b><b>${player.eff}</b>
        </button>
      `)
      .join("");
    const homeTotal = match.teamTotals.find((team) => team.team === match.home) || {};
    const awayTotal = match.teamTotals.find((team) => team.team === match.away) || {};
    const quarterLine = match.quarters.length
      ? match.quarters.map((q, index) => `<span>Q${index + 1}: ${q.home}-${q.away}</span>`).join("")
      : "<span>Parciais indisponiveis</span>";
    openModal(`
      <header class="detail-hero">
        <span class="badge">Categoria ${safe(match.category)}</span>
        <h2 id="modal-title">${safe(match.home)} ${match.homeScore} - ${match.awayScore} ${safe(match.away)}</h2>
        <p>${formatDate(match.date)} · ${safe(match.phase)} · ${safe(match.file)}</p>
      </header>
      <div class="detail-score-grid">
        <article>${teamCell(match.home)}<strong>${match.homeScore}</strong></article>
        <article>${teamCell(match.away)}<strong>${match.awayScore}</strong></article>
      </div>
      <div class="quarter-strip">${quarterLine}</div>
      <div class="detail-grid">
        <section>
          <h3>Totais do jogo</h3>
          <div class="detail-stats">
            ${statPill(`${homeTotal.abbr || "CASA"} REB`, homeTotal.reb ?? "-")}
            ${statPill(`${awayTotal.abbr || "FORA"} REB`, awayTotal.reb ?? "-")}
            ${statPill(`${homeTotal.abbr || "CASA"} AST`, homeTotal.ast ?? "-")}
            ${statPill(`${awayTotal.abbr || "FORA"} AST`, awayTotal.ast ?? "-")}
            ${statPill(`${homeTotal.abbr || "CASA"} EFF`, homeTotal.eff ?? "-")}
            ${statPill(`${awayTotal.abbr || "FORA"} EFF`, awayTotal.eff ?? "-")}
          </div>
        </section>
      </div>
      <section class="full-boxscore">
        <h3>${safe(match.home)}</h3>
        <div class="box-head full-stat"><span>Jogador</span><b>PTS</b><b>RO</b><b>RD</b><b>RT</b><b>AS</b><b>BR</b><b>TO</b><b>ER</b><b>EF</b></div>
        <div class="box-table">${rosterRows(match.home)}</div>
      </section>
      <section class="full-boxscore">
        <h3>${safe(match.away)}</h3>
        <div class="box-head full-stat"><span>Jogador</span><b>PTS</b><b>RO</b><b>RD</b><b>RT</b><b>AS</b><b>BR</b><b>TO</b><b>ER</b><b>EF</b></div>
        <div class="box-table">${rosterRows(match.away)}</div>
      </section>
    `);
  }

  function openPlayerDetail(playerKey, category) {
    const player = data.players.find((item) => item.playerKey === playerKey && item.category === category);
    if (!player) return;
    const games = data.playerGames
      .filter((item) => item.playerKey === playerKey && item.category === category)
      .sort((a, b) => b.date.localeCompare(a.date));
    openModal(`
      <header class="detail-hero player-detail">
        <span class="badge">Categoria ${safe(category)}</span>
        <h2 id="modal-title">${safe(player.name)}</h2>
        <p>${safe(player.team)} · camisa ${safe(player.number)} · ${player.games} jogo${player.games === 1 ? "" : "s"}</p>
      </header>
      <div class="detail-stats player-summary">
        ${statPill("PTS", player.ptsAvg.toFixed(1))}
        ${statPill("REB", player.rebAvg.toFixed(1))}
        ${statPill("AST", player.astAvg.toFixed(1))}
        ${statPill("BR", player.stlAvg.toFixed(1))}
        ${statPill("TO", player.blkAvg.toFixed(1))}
        ${statPill("EFF", player.effAvg.toFixed(1))}
      </div>
      <section>
        <h3>Jogo a jogo</h3>
        <div class="box-head"><span></span><b>PTS</b><b>REB</b><b>AST</b><b>BR</b><b>TO</b><b>EFF</b></div>
        <div class="box-table player-games">
          ${games.map((game) => {
            const match = data.matches.find((item) => item.id === game.gameId);
            const opponent = match ? (match.home === game.team ? match.away : match.home) : "";
            return `
              <button class="box-row" type="button" data-game-id="${safe(game.gameId)}">
                <span><strong>${formatDate(game.date)} vs ${safe(opponent)}</strong><small>${safe(game.abbr)} · ${safe(game.min)} min</small></span>
                <b>${game.pts}</b><b>${game.reb}</b><b>${game.ast}</b><b>${game.stl}</b><b>${game.blk}</b><b>${game.eff}</b>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    `);
  }

  function openTeamDetail(teamName, category) {
    const row = data.standings.find((item) => item.team === teamName && item.category === category);
    const games = data.schedule
      .filter((game) => game.category === category && [game.home, game.away].includes(teamName))
      .sort((a, b) => b.date.localeCompare(a.date));
    const leaders = data.players
      .filter((player) => player.category === category && player.team === teamName && player.games >= 2)
      .sort((a, b) => b.effAvg - a.effAvg)
      .slice(0, 5);
    openModal(`
      <header class="detail-hero">
        <span class="badge">Categoria ${safe(category)}</span>
        <h2 id="modal-title">${safe(teamName)}</h2>
        <p>${row ? `${row.wins}V · ${row.losses}D · saldo ${row.diff > 0 ? "+" : ""}${row.diff}` : "Resumo da equipe"}</p>
      </header>
      <div class="detail-stats player-summary">
        ${statPill("Jogos", row?.played ?? 0)}
        ${statPill("Pontos pro", row?.pf ?? 0)}
        ${statPill("Pontos contra", row?.pa ?? 0)}
        ${statPill("Saldo", row ? `${row.diff > 0 ? "+" : ""}${row.diff}` : 0)}
        ${statPill("Vitorias", row?.wins ?? 0)}
        ${statPill("Derrotas", row?.losses ?? 0)}
      </div>
      <div class="detail-grid">
        <section>
          <h3>Jogos da equipe</h3>
          <div class="team-games">
            ${games.map((game) => {
              const final = Number.isFinite(game.homeScore);
              const score = final ? `${game.homeScore} - ${game.awayScore}` : "Agendado";
              const opponent = game.home === teamName ? game.away : game.home;
              return `
                <button class="team-game-row" type="button" data-game-id="${safe(game.id || "")}">
                  <span><strong>${formatDate(game.actualDate || game.date)} vs ${safe(opponent)}</strong><small>${safe(game.home)} x ${safe(game.away)}</small></span>
                  <b>${safe(score)}</b>
                </button>
              `;
            }).join("")}
          </div>
        </section>
        <section>
          <h3>Principais medias</h3>
          <div class="box-head"><span></span><b>PTS</b><b>REB</b><b>AST</b><b>BR</b><b>TO</b><b>EFF</b></div>
          <div class="box-table">
            ${leaders.map((player) => `
              <button class="box-row" type="button" data-player-key="${safe(player.playerKey)}" data-player-category="${safe(player.category)}">
                <span><strong>${safe(player.name)}</strong><small>#${safe(player.number)} · ${player.games} jogos</small></span>
                <b>${player.ptsAvg.toFixed(1)}</b><b>${player.rebAvg.toFixed(1)}</b><b>${player.astAvg.toFixed(1)}</b><b>${player.stlAvg.toFixed(1)}</b><b>${player.blkAvg.toFixed(1)}</b><b>${player.effAvg.toFixed(1)}</b>
              </button>
            `).join("")}
          </div>
        </section>
      </div>
    `);
  }

  function drawCharts() {
    drawBarChart("#team-ppg-chart", data.teamStats.filter((row) => row.games && row.category === "A").sort((a, b) => b.ppg - a.ppg), "ppg");
    drawBarChart(
      "#team-defense-overview-chart",
      data.teamStats.filter((row) => row.games && row.category === "A").sort((a, b) => a.papg - b.papg),
      "papg"
    );
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
    renderStandings("#overview-standings-b", "B", 4);
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

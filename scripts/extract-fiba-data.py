import glob
import csv
import datetime
import json
import os
import re
import unicodedata

import pdfplumber

PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PDFS_DIR = os.path.join(PROJECT_DIR, "pdfs")

MONTHS = {
    "abril": 4,
    "abr": 4,
    "maio": 5,
    "mai": 5,
    "junho": 6,
    "jun": 6,
    "julho": 7,
    "jul": 7,
}

TEAM_NAMES = [
    "North Carolina Tar Heels",
    "Michigan State Spartans",
    "Michigan Wolverines",
    "Duke Blue Devils",
    "UCLA Bruins",
    "Florida Gators",
    "Houston Cougars",
    "Indiana Hoosiers",
]

TEAM_ABBR = {
    "Duke Blue Devils": "DBD",
    "Michigan Wolverines": "MWS",
    "UCLA Bruins": "UCB",
    "Michigan State Spartans": "MSS",
    "Florida Gators": "FGT",
    "Houston Cougars": "HOU",
    "North Carolina Tar Heels": "NCT",
    "Indiana Hoosiers": "IHS",
}

CODE_TEAM = {
    "DBD": "Duke Blue Devils",
    "DUK": "Duke Blue Devils",
    "MWS": "Michigan Wolverines",
    "MWV": "Michigan Wolverines",
    "UCB": "UCLA Bruins",
    "UCL": "UCLA Bruins",
    "MSS": "Michigan State Spartans",
    "FGT": "Florida Gators",
    "FLG": "Florida Gators",
    "FLO": "Florida Gators",
    "HOU": "Houston Cougars",
    "HCG": "Houston Cougars",
    "CTH": "North Carolina Tar Heels",
    "CRH": "North Carolina Tar Heels",
    "NCT": "North Carolina Tar Heels",
    "NOR": "North Carolina Tar Heels",
    "IHS": "Indiana Hoosiers",
    "INH": "Indiana Hoosiers",
    "IND": "Indiana Hoosiers",
}

TEAM_COLORS = {
    "Duke Blue Devils": ["#003087", "#ffffff"],
    "Michigan Wolverines": ["#00274c", "#ffcb05"],
    "UCLA Bruins": ["#2774ae", "#ffd100"],
    "Michigan State Spartans": ["#18453b", "#ffffff"],
    "Florida Gators": ["#0021a5", "#fa4616"],
    "Houston Cougars": ["#c8102e", "#ffffff"],
    "North Carolina Tar Heels": ["#4b9cd3", "#13294b"],
    "Indiana Hoosiers": ["#990000", "#ffffff"],
}


def strip_accents(value):
    return "".join(
        char for char in unicodedata.normalize("NFD", value) if unicodedata.category(char) != "Mn"
    )


def clean(value):
    return re.sub(r"\s+", " ", value).strip()


def norm(value):
    return re.sub(r"[^A-Z0-9]+", " ", strip_accents(value).upper()).strip()


def canonical_team(value):
    normalized = norm(value)
    aliases = {norm(team): team for team in TEAM_NAMES}
    aliases.update(
        {
            "NORTH CAROLINA": "North Carolina Tar Heels",
            "TAR HEELS": "North Carolina Tar Heels",
            "MICHIGAN STATE": "Michigan State Spartans",
            "SPARTANS": "Michigan State Spartans",
            "MICHIGAN": "Michigan Wolverines",
            "WOLVERINES": "Michigan Wolverines",
            "DUKE": "Duke Blue Devils",
            "BLUE DEVILS": "Duke Blue Devils",
            "UCLA": "UCLA Bruins",
            "BRUINS": "UCLA Bruins",
            "FLORIDA": "Florida Gators",
            "GATORS": "Florida Gators",
            "HOUSTON": "Houston Cougars",
            "COUGARS": "Houston Cougars",
            "INDIANA": "Indiana Hoosiers",
            "HOOSIERS": "Indiana Hoosiers",
        }
    )
    if normalized in aliases:
        return aliases[normalized]
    for key, team in aliases.items():
        if normalized.startswith(key) or normalized.endswith(key):
            return team
    return None


def title_name(value):
    small = {"da", "de", "do", "dos", "das", "e"}
    words = []
    for word in clean(value).replace(" (C)", "").split():
        lower = word.lower()
        words.append(lower if lower in small else lower.capitalize())
    return " ".join(words)


def date_iso(day, month):
    month_key = strip_accents(month.lower()).replace(".", "")
    return f"2026-{MONTHS[month_key]:02d}-{int(day):02d}"


def file_codes(path):
    match = re.search(r"FIBA\s+([A-Za-z]{3})\s+vs\s+([A-Za-z]{3})", os.path.basename(path), re.I)
    if not match:
        return None, None
    return CODE_TEAM.get(match.group(1).upper()), CODE_TEAM.get(match.group(2).upper())


def parse_schedule():
    classification_pdf = glob.glob(os.path.join(PDFS_DIR, "*classifica*2026*.pdf"))[0]
    schedule = []
    with pdfplumber.open(classification_pdf) as pdf:
        text = "\n".join(page.extract_text(x_tolerance=1, y_tolerance=3) or "" for page in pdf.pages)
    for raw in text.splitlines():
        line = clean(raw)
        match = re.match(r"^(\d+).?\s+(\d{2})/(\w+)\s+(\d{2}:\d{2})\s+hs\s+(.+)$", line)
        if not match:
            continue
        round_no, day, month, time, rest = match.groups()
        category = "B" if "(B)" in rest else "A"
        rest = rest.replace(" (B)", "")
        home = away = None
        for team in TEAM_NAMES:
            if rest.startswith(team):
                home = team
                away = clean(rest[len(team) :])
                break
        if home and away in TEAM_NAMES:
            schedule.append(
                {
                    "round": int(round_no),
                    "date": date_iso(day, month),
                    "time": time,
                    "category": category,
                    "home": home,
                    "away": away,
                    "status": "Agendado",
                }
            )
    return schedule


def parse_score(text, path):
    lines = [clean(line) for line in text.splitlines() if clean(line)]
    for index, line in enumerate(lines):
        options = [line]
        if index + 1 < len(lines):
            options.append(f"{line} {lines[index + 1]}")
        for option in options:
            match = re.match(r"^(.+?)\s+(\d{1,3})\s+\D+\s+(\d{1,3})\s+(.+)$", option)
            if not match:
                continue
            left, score_left, score_right, right = match.groups()
            home = canonical_team(left)
            away = canonical_team(right)
            if home and away:
                return home, int(score_left), int(score_right), away
    home, away = file_codes(path)
    score = re.search(r"(\d{1,3})\s+\D+\s+(\d{1,3})", text)
    if home and away and score:
        return home, int(score.group(1)), int(score.group(2)), away
    return None


def parse_date(text, path):
    simplified = strip_accents(text.lower())
    match = re.search(r"(\d{1,2})\s+([a-z]{3,5})\.?,?\s+2026", simplified)
    if match:
        return date_iso(match.group(1), match.group(2))
    fallback = re.search(r"(\d{2})\s+(abril|maio|junho|julho|abr|mai|jun|jul)", os.path.basename(path).lower())
    return date_iso(fallback.group(1), fallback.group(2)) if fallback else ""


def parse_quarters(text):
    match = re.search(
        r"\((\d+)-(\d+)(?:,\s*(\d+)-(\d+))?(?:,\s*(\d+)-(\d+))?(?:,\s*(\d+)-(\d+))?(?:,\s*(\d+)-(\d+))?\)",
        text,
    )
    if not match:
        return []
    values = [int(value) for value in match.groups() if value]
    return [{"home": values[index], "away": values[index + 1]} for index in range(0, len(values), 2)]


def parse_players(text):
    players = []
    current_team = None
    for line in text.splitlines():
        line = clean(line)
        team_match = re.match(r"^(.+?) \(([A-Z]{2,4})\)", line)
        if team_match:
            team = canonical_team(team_match.group(1))
            if team:
                current_team = team
                continue
        if (
            not current_team
            or line.startswith(("Totais", "Equipe/", "Legenda"))
            or " NJ" in line
            or not re.match(r"^\*?\d+\s+", line)
        ):
            continue

        parts = line.split()
        minute_index = next((i for i, token in enumerate(parts) if re.match(r"^\d{1,2}:\d{2}$", token)), None)
        if minute_index is None:
            continue

        raw_name = " ".join(parts[1:minute_index])
        ints = [int(token) for token in parts[minute_index + 1 :] if re.fullmatch(r"-?\d+", token)]
        stats = {
            "oreb": 0,
            "dreb": 0,
            "reb": 0,
            "ast": 0,
            "turnovers": 0,
            "stl": 0,
            "blk": 0,
            "fouls": 0,
            "foulsDrawn": 0,
            "plusMinus": 0,
            "eff": 0,
            "pts": 0,
        }
        if len(ints) >= 12:
            stats.update(
                {
                    "oreb": ints[0],
                    "dreb": ints[1],
                    "reb": ints[2],
                    "ast": ints[3],
                    "turnovers": ints[4],
                    "stl": ints[5],
                    "blk": ints[6],
                    "fouls": ints[7],
                    "foulsDrawn": ints[8],
                    "plusMinus": ints[-3],
                    "eff": ints[-2],
                    "pts": ints[-1],
                }
            )
        elif len(ints) >= 2:
            stats.update({"eff": ints[-2], "pts": ints[-1]})

        players.append(
            {
                "team": current_team,
                "abbr": TEAM_ABBR[current_team],
                "number": parts[0].replace("*", ""),
                "name": title_name(raw_name),
                "starter": parts[0].startswith("*"),
                "min": parts[minute_index],
                **stats,
            }
        )
    return players


def parse_totals(text):
    totals = []
    current_team = None
    for line in text.splitlines():
        line = clean(line)
        team_match = re.match(r"^(.+?) \(([A-Z]{2,4})\)", line)
        if team_match:
            team = canonical_team(team_match.group(1))
            if team:
                current_team = team
                continue
        if current_team and line.startswith("Totais"):
            parts = line.split()
            ints = [int(token) for token in parts if re.fullmatch(r"-?\d+", token)]
            totals.append(
                {
                    "team": current_team,
                    "abbr": TEAM_ABBR[current_team],
                    "fg": parts[2] if len(parts) > 2 else "",
                    "two": parts[4] if len(parts) > 4 else "",
                    "three": parts[6] if len(parts) > 6 else "",
                    "ft": parts[8] if len(parts) > 8 else "",
                    "oreb": ints[0] if len(ints) > 0 else 0,
                    "dreb": ints[1] if len(ints) > 1 else 0,
                    "reb": ints[2] if len(ints) > 2 else 0,
                    "ast": ints[3] if len(ints) > 3 else 0,
                    "turnovers": ints[4] if len(ints) > 4 else 0,
                    "stl": ints[5] if len(ints) > 5 else 0,
                    "blk": ints[6] if len(ints) > 6 else 0,
                    "eff": ints[-2] if len(ints) >= 2 else 0,
                    "pts": ints[-1] if ints else 0,
                }
            )
    return totals


def unique_box_files():
    files = sorted(
        os.path.join(PDFS_DIR, name)
        for name in os.listdir(PDFS_DIR)
        if name.startswith("Box Score FIBA") and name.lower().endswith(".pdf")
    )
    unique = []
    seen = set()
    for file_path in files:
        filename = os.path.basename(file_path)
        key = re.sub(r"\s*\(1\)(?=\.pdf$)", "", filename, flags=re.I)
        key = re.sub(r"\s+", " ", key).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(file_path)
    return unique


def category_from_box_date(date, official):
    if not official:
        return "TI"
    year, month, day = [int(part) for part in date.split("-")]
    return "B" if datetime.date(year, month, day).weekday() >= 5 else "A"


def date_distance(left, right):
    left_date = datetime.date.fromisoformat(left)
    right_date = datetime.date.fromisoformat(right)
    return abs((left_date - right_date).days)


def match_schedule(schedule, home, away, date, official, preferred_category):
    if not official:
        return None
    candidates = [
        game
        for game in schedule
        if {game["home"], game["away"]} == {home, away} and "homeScore" not in game
    ]
    exact = [game for game in candidates if game["date"] == date]
    if exact:
        return exact[0]
    if not candidates:
        return None
    candidates.sort(
        key=lambda game: (
            date_distance(game["date"], date),
            0 if game["category"] == preferred_category else 1,
        )
    )
    return candidates[0]


def compute_standings(schedule):
    standings = []
    for category in ["A", "B"]:
        names = sorted(
            {game["home"] for game in schedule if game["category"] == category}
            | {game["away"] for game in schedule if game["category"] == category}
        )
        rows = {
            name: {
                "team": name,
                "abbr": TEAM_ABBR[name],
                "category": category,
                "played": 0,
                "wins": 0,
                "losses": 0,
                "pf": 0,
                "pa": 0,
                "diff": 0,
                "points": 0,
                "status": "Playoffs",
            }
            for name in names
        }
        for game in schedule:
            if game["category"] != category or "homeScore" not in game:
                continue
            home = rows[game["home"]]
            away = rows[game["away"]]
            home_score = game["homeScore"]
            away_score = game["awayScore"]
            for row, scored, allowed in [(home, home_score, away_score), (away, away_score, home_score)]:
                row["played"] += 1
                row["pf"] += scored
                row["pa"] += allowed
                row["diff"] = row["pf"] - row["pa"]
                row["points"] += 2 if scored > allowed else 1
            home["wins"] += int(home_score > away_score)
            home["losses"] += int(home_score < away_score)
            away["wins"] += int(away_score > home_score)
            away["losses"] += int(away_score < home_score)
        ordered = sorted(rows.values(), key=lambda row: (-row["wins"], -row["diff"], -row["pf"], row["team"]))
        for index, row in enumerate(ordered, 1):
            row["rank"] = index
        standings.extend(ordered)
    return standings


def latest_name_map(raw_players):
    latest_names = {}
    for player in raw_players:
        if not player["official"] or player["category"] == "TI":
            continue
        name_key = (player["category"], player["team"], player["number"])
        if name_key not in latest_names or player["date"] >= latest_names[name_key]["date"]:
            latest_names[name_key] = {"date": player["date"], "name": player["name"]}
    return latest_names


def compute_players(raw_players):
    grouped = {}
    latest_names = latest_name_map(raw_players)
    for player in raw_players:
        if not player["official"] or player["category"] == "TI":
            continue
        key = (player["category"], player["team"], player["number"])
        current = grouped.setdefault(
            key,
            {
                "category": player["category"],
                "team": player["team"],
                "abbr": TEAM_ABBR[player["team"]],
                "number": player["number"],
                "playerKey": f'{player["team"]}::{player["number"]}',
                "name": player["name"],
                "lastDate": player["date"],
                "games": 0,
                "pts": 0,
                "oreb": 0,
                "dreb": 0,
                "reb": 0,
                "ast": 0,
                "stl": 0,
                "blk": 0,
                "turnovers": 0,
                "eff": 0,
            },
        )
        if player["date"] >= current["lastDate"]:
            current["name"] = player["name"]
            current["lastDate"] = player["date"]
        current["games"] += 1
        for stat in ["pts", "oreb", "dreb", "reb", "ast", "stl", "blk", "turnovers", "eff"]:
            current[stat] += player[stat]

    players = []
    for player in grouped.values():
        player["name"] = latest_names[(player["category"], player["team"], player["number"])]["name"]
        for stat in ["pts", "oreb", "dreb", "reb", "ast", "stl", "blk", "turnovers", "eff"]:
            player[f"{stat}Avg"] = round(player[stat] / player["games"], 1) if player["games"] else 0
        players.append(player)
    return players


def normalize_player_games(raw_players):
    latest_names = latest_name_map(raw_players)
    rows = []
    for player in raw_players:
        if not player["official"] or player["category"] == "TI":
            continue
        player = dict(player)
        player["playerKey"] = f'{player["team"]}::{player["number"]}'
        player["name"] = latest_names.get(
            (player["category"], player["team"], player["number"]), {"name": player["name"]}
        )["name"]
        rows.append(player)
    return rows


def write_placares_csv(schedule):
    output = os.path.join(PROJECT_DIR, "data", "placares.csv")
    headers = [
        "Categoria",
        "Rodada",
        "Data Cronograma",
        "Data Real",
        "Horario",
        "Mandante",
        "Placar Mandante",
        "Visitante",
        "Placar Visitante",
        "Status",
        "Observacoes",
    ]
    with open(output, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for game in schedule:
            writer.writerow(
                {
                    "Categoria": game.get("category", ""),
                    "Rodada": game.get("round", ""),
                    "Data Cronograma": game.get("date", ""),
                    "Data Real": "",
                    "Horario": game.get("time", ""),
                    "Mandante": game.get("home", ""),
                    "Placar Mandante": game.get("homeScore", ""),
                    "Visitante": game.get("away", ""),
                    "Placar Visitante": game.get("awayScore", ""),
                    "Status": game.get("status", "Agendado"),
                    "Observacoes": "",
                }
            )


def compute_team_stats(schedule):
    rows = []
    for category in ["A", "B"]:
        names = sorted(
            {game["home"] for game in schedule if game["category"] == category}
            | {game["away"] for game in schedule if game["category"] == category}
        )
        for team in names:
            played = [
                game
                for game in schedule
                if game["category"] == category and "homeScore" in game and team in (game["home"], game["away"])
            ]
            scored = []
            allowed = []
            for game in played:
                if game["home"] == team:
                    scored.append(game["homeScore"])
                    allowed.append(game["awayScore"])
                else:
                    scored.append(game["awayScore"])
                    allowed.append(game["homeScore"])
            rows.append(
                {
                    "category": category,
                    "team": team,
                    "abbr": TEAM_ABBR[team],
                    "games": len(played),
                    "ppg": round(sum(scored) / len(scored), 1) if scored else 0,
                    "papg": round(sum(allowed) / len(allowed), 1) if allowed else 0,
                    "diffAvg": round((sum(scored) - sum(allowed)) / len(scored), 1) if scored else 0,
                    "high": max(scored) if scored else 0,
                }
            )
    return rows


def main():
    schedule = parse_schedule()
    matches = []
    raw_players = []

    for file_path in unique_box_files():
        with pdfplumber.open(file_path) as pdf:
            text = "\n".join(page.extract_text(x_tolerance=1, y_tolerance=3) or "" for page in pdf.pages)
        score = parse_score(text, file_path)
        if not score:
            continue
        home, home_score, away_score, away = score
        date = parse_date(text, file_path)
        official = "TORNEIO INICIO" not in norm(text)
        preferred_category = category_from_box_date(date, official)
        game = match_schedule(schedule, home, away, date, official, preferred_category)
        category = game["category"] if game else preferred_category
        if game:
            game["status"] = "Final"
            game["date"] = date
            if game["home"] == home:
                game["homeScore"] = home_score
                game["awayScore"] = away_score
            else:
                game["homeScore"] = away_score
                game["awayScore"] = home_score

        game_id = (
            os.path.splitext(os.path.basename(file_path))[0]
            .replace("Box Score FIBA ", "")
            .replace(" (1)", "")
            .replace(" ", "-")
            .lower()
        )
        matches.append(
            {
                "id": game_id,
                "date": date,
                "home": home,
                "away": away,
                "homeScore": home_score,
                "awayScore": away_score,
                "winner": home if home_score > away_score else away,
                "official": official,
                "phase": "Classificacao" if official else "Torneio Inicio",
                "quarters": parse_quarters(text),
                "file": os.path.basename(file_path),
                "category": category,
                "round": game["round"] if game else None,
                "time": game["time"] if game else None,
                "teamTotals": parse_totals(text),
            }
        )
        for player in parse_players(text):
            player.update({"gameId": game_id, "date": date, "category": category, "official": official})
            raw_players.append(player)

    data = {
        "generatedAt": datetime.date.today().isoformat(),
        "sourceNotes": [
            "Agenda extraida do PDF de classificacao alteracoes 14/04.",
            "Resultados e estatisticas extraidos dos box scores FIBA enviados.",
            "Jogos de 25/abril identificados como Torneio Inicio ficam separados da classificacao oficial.",
            "Categoria oficial dos box scores: dias uteis entram como A; sabado/domingo entram como B.",
            "Atletas sao consolidados por categoria + time + numero, mantendo o nome mais recente do box score.",
        ],
        "teams": [
            {"name": team, "abbr": TEAM_ABBR[team], "primary": TEAM_COLORS[team][0], "secondary": TEAM_COLORS[team][1]}
            for team in TEAM_NAMES
        ],
        "schedule": schedule,
        "matches": matches,
        "standings": compute_standings(schedule),
        "players": compute_players(raw_players),
        "playerGames": normalize_player_games(raw_players),
        "teamStats": compute_team_stats(schedule),
        "rules": {
            "categories": ["Categoria A: 8 equipes", "Categoria B: 4 equipes"],
            "format": [
                "Categoria A: turno unico, todas as equipes avancam aos playoffs",
                "Categoria B: turno e returno, todas as equipes avancam aos playoffs",
            ],
            "tiebreakers": [
                "Maior numero de vitorias",
                "Confronto direto",
                "Saldo de pontos",
                "Pontos marcados",
                "Sorteio",
            ],
            "eligibility": [
                "Obrigatorio ter participado de 4 jogos na fase de classificacao para poder disputar o playoff"
            ],
            "participation": [
                "Todos os jogadores devem atuar no minimo 10 minutos em cada partida",
                "Atletas com idade inferior a 30 anos devem cumprir 10 minutos por quarto, sob controle da arbitragem ou da mesa",
            ],
            "punishment": [
                "Descumprimento das regras pode gerar perda do jogo",
                "Situacoes adversas ou nao previstas serao decididas pela organizacao do campeonato",
            ],
        },
    }

    output = os.path.join(PROJECT_DIR, "data", "championship-data.js")
    with open(output, "w", encoding="utf-8") as handle:
        handle.write("window.CHAMPIONSHIP_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n")

    write_placares_csv(schedule)

    print(
        json.dumps(
            {
                "matches": len(matches),
                "official": sum(1 for match in matches if match["official"]),
                "scheduleFinals": sum(1 for game in schedule if "homeScore" in game),
                "players": len(data["players"]),
                "playersA": sum(1 for player in data["players"] if player["category"] == "A"),
                "playersB": sum(1 for player in data["players"] if player["category"] == "B"),
                "maxReb": max((player["rebAvg"] for player in data["players"]), default=0),
                "maxAst": max((player["astAvg"] for player in data["players"]), default=0),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

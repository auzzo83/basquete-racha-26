import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const workbookPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(projectDir, "placares-editaveis.xlsx");
const dataFile = path.join(projectDir, "data", "championship-data.js");
const csvFile = path.join(projectDir, "data", "placares.csv");

const source = await fs.readFile(dataFile, "utf8");
const jsonText = source.match(/window\.CHAMPIONSHIP_DATA\s*=\s*([\s\S]*);?\s*$/)[1].replace(/;\s*$/, "");
const data = JSON.parse(jsonText);

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItem("Editar placares");
const used = sheet.getUsedRange(true).values;
const headers = used[0].map((item) => String(item).trim());
const rows = used.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== ""));
const index = Object.fromEntries(headers.map((header, i) => [header, i]));

function value(row, name) {
  const cell = row[index[name]];
  return cell === null || cell === undefined ? "" : cell;
}

function score(row, name) {
  const raw = value(row, name);
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(raw) {
  if (!raw) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const text = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return text;
}

const updates = rows.map((row) => ({
  category: String(value(row, "Categoria")).trim(),
  round: Number(value(row, "Rodada")),
  date: normalizeDate(value(row, "Data Cronograma")),
  actualDate: normalizeDate(value(row, "Data Real")),
  time: String(value(row, "Horario")).trim(),
  home: String(value(row, "Mandante")).trim(),
  homeScore: score(row, "Placar Mandante"),
  away: String(value(row, "Visitante")).trim(),
  awayScore: score(row, "Placar Visitante"),
  status: String(value(row, "Status")).trim() || "Agendado",
  notes: String(value(row, "Observacoes")).trim()
}));

for (const update of updates) {
  const game = data.schedule.find(
    (item) =>
      item.category === update.category &&
      item.round === update.round &&
      item.date === update.date &&
      item.home === update.home &&
      item.away === update.away
  );
  if (!game) continue;
  game.time = update.time || game.time;
  game.status = update.status;
  game.actualDate = update.actualDate || null;
  if (update.homeScore !== null && update.awayScore !== null && update.status === "Final") {
    game.homeScore = update.homeScore;
    game.awayScore = update.awayScore;
  } else {
    delete game.homeScore;
    delete game.awayScore;
  }
}

data.generatedAt = new Date().toISOString().slice(0, 10);
await fs.writeFile(dataFile, `window.CHAMPIONSHIP_DATA = ${JSON.stringify(data, null, 2)};\n`, "utf8");

const csvHeaders = [
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
  "Observacoes"
];
function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
const csvRows = updates.map((row) =>
  [
    row.category,
    row.round,
    row.date,
    row.actualDate,
    row.time,
    row.home,
    row.homeScore ?? "",
    row.away,
    row.awayScore ?? "",
    row.status,
    row.notes
  ].map(csvEscape).join(",")
);
await fs.writeFile(csvFile, `${csvHeaders.join(",")}\n${csvRows.join("\n")}\n`, "utf8");
console.log(`Updated ${dataFile}`);
console.log(`Updated ${csvFile}`);

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const dataFile = path.join(projectDir, "data", "championship-data.js");
const outputFile = path.join(projectDir, "placares-editaveis.xlsx");

const source = await fs.readFile(dataFile, "utf8");
const jsonText = source.match(/window\.CHAMPIONSHIP_DATA\s*=\s*([\s\S]*);?\s*$/)[1].replace(/;\s*$/, "");
const data = JSON.parse(jsonText);

const workbook = Workbook.create();
const readme = workbook.worksheets.add("Leia-me");
const scores = workbook.worksheets.add("Editar placares");
const teams = workbook.worksheets.add("Times");

readme.showGridLines = false;
readme.getRange("A1:F1").merge();
readme.getRange("A1").values = [["Racha Basquete 2026 - Planilha de placares"]];
readme.getRange("A3:F8").values = [
  ["Como usar", "", "", "", "", ""],
  ["1", "Edite apenas as colunas Placar Mandante, Placar Visitante, Status, Data Real e Observacoes.", "", "", "", ""],
  ["2", "Use Status = Final para jogos encerrados e Agendado para jogos futuros.", "", "", "", ""],
  ["3", "Depois de editar, rode o atualizador do projeto para recriar os dados do site.", "", "", "", ""],
  ["4", "No GitHub, publique somente os arquivos do projeto. O site nao grava nada e nao usa senha no navegador.", "", "", "", ""],
  ["Seguranca", "Quem pode alterar o placar publicado e quem tem permissao de escrita no repositorio ou acesso a esta planilha.", "", "", "", ""]
];
readme.getRange("A1").format = {
  fill: "#071B3A",
  font: { bold: true, color: "#FFFFFF", size: 18 }
};
readme.getRange("A3:F3").format = {
  fill: "#0757C7",
  font: { bold: true, color: "#FFFFFF" }
};
readme.getRange("A4:A8").format = { font: { bold: true, color: "#0757C7" } };
readme.getRange("A1:F8").format.wrapText = true;
readme.getRange("A:F").format.columnWidthPx = 150;
readme.getRange("B:B").format.columnWidthPx = 620;

const headers = [
  "ID",
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

const rows = data.schedule.map((game, index) => [
  `J${String(index + 1).padStart(3, "0")}`,
  game.category,
  game.round,
  game.date,
  game.actualDate || "",
  game.time,
  game.home,
  Number.isFinite(game.homeScore) ? game.homeScore : "",
  game.away,
  Number.isFinite(game.awayScore) ? game.awayScore : "",
  Number.isFinite(game.homeScore) ? "Final" : "Agendado",
  game.actualDate ? "Jogo remarcado no box score" : ""
]);

scores.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
scores.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;
scores.tables.add(`A1:L${rows.length + 1}`, true, "TabelaPlacares");
scores.freezePanes.freezeRows(1);
scores.getRange("A1:L1").format = {
  fill: "#071B3A",
  font: { bold: true, color: "#FFFFFF" }
};
scores.getRange(`A2:L${rows.length + 1}`).format.borders = {
  preset: "inside",
  style: "thin",
  color: "#D9E2EF"
};
scores.getRange(`D2:E${rows.length + 1}`).setNumberFormat("yyyy-mm-dd");
scores.getRange(`H2:H${rows.length + 1}`).dataValidation = {
  rule: { type: "whole", operator: "between", formula1: 0, formula2: 200 }
};
scores.getRange(`J2:J${rows.length + 1}`).dataValidation = {
  rule: { type: "whole", operator: "between", formula1: 0, formula2: 200 }
};
scores.getRange(`K2:K${rows.length + 1}`).dataValidation = {
  rule: { type: "list", values: ["Agendado", "Final"] }
};
scores.getRange("A:A").format.columnWidthPx = 72;
scores.getRange("B:C").format.columnWidthPx = 86;
scores.getRange("D:F").format.columnWidthPx = 118;
scores.getRange("G:G").format.columnWidthPx = 230;
scores.getRange("H:H").format.columnWidthPx = 132;
scores.getRange("I:I").format.columnWidthPx = 230;
scores.getRange("J:J").format.columnWidthPx = 132;
scores.getRange("K:K").format.columnWidthPx = 110;
scores.getRange("L:L").format.columnWidthPx = 260;

const teamRows = [["Equipe", "Sigla", "Cor principal"], ...data.teams.map((team) => [team.name, team.abbr, team.primary])];
teams.getRangeByIndexes(0, 0, teamRows.length, 3).values = teamRows;
teams.tables.add(`A1:C${teamRows.length}`, true, "TabelaTimes");
teams.getRange("A1:C1").format = {
  fill: "#071B3A",
  font: { bold: true, color: "#FFFFFF" }
};
teams.getRange("A:C").format.columnWidthPx = 190;

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "formula error scan"
});
console.log(errors.ndjson);

const preview = await workbook.render({ sheetName: "Editar placares", autoCrop: "all", scale: 1, format: "png" });
await fs.writeFile(path.join(projectDir, "placares-editaveis-preview.png"), new Uint8Array(await preview.arrayBuffer()));

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputFile);
console.log(`Workbook saved: ${outputFile}`);

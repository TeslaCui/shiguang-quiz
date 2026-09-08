import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const dir = "D:/myApp/刷刷题";
const jsonPath = `${dir}/questions.json`;
const outXlsx = `${dir}/中华文化考研题库_官方+教材补充.xlsx`;
const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

let bank = JSON.parse(await fs.readFile(jsonPath, "utf8"));
// idempotent: drop any previously merged 教材命题 records
const official = bank.filter((q) => q.source === "2023港澳台中华文化知识大赛");
const extraFiles = (await fs.readdir(`${dir}/outputs`)).filter((f) => f.startsWith("scratch_vision_q") && f.endsWith(".json")).sort().map((f) => `${dir}/outputs/${f}`);
const extra = [];
for (const f of extraFiles) {
  const arr = JSON.parse(await fs.readFile(f, "utf8"));
  for (const q of arr) {
    q.id = `教材-${extra.length + 1}`;
    extra.push(q);
  }
}
const merged = [...official, ...extra];
await fs.writeFile(jsonPath, JSON.stringify(merged));
console.log("questions.json total:", merged.length, "official:", official.length, "textbook:", extra.length);

// validation
const bad = [];
const dup = new Set();
for (const q of merged) {
  if (q.type !== "single") bad.push(`${q.id} type ${q.type}`);
  if (!/^[A-D]$/.test(q.answer || "")) bad.push(`${q.id} answer ${q.answer}`);
  if ((q.options || []).length !== 4 || q.options.some((o) => !o)) bad.push(`${q.id} options ${JSON.stringify(q.options)}`);
  const k = norm(q.question) + "|" + (q.options || []).join("|");
  if (dup.has(k)) bad.push(`${q.id} dup`);
  dup.add(k);
}
console.log("validation issues:", bad.length, bad.slice(0, 5));

// export combined xlsx
const headers = ["序号", "题库", "来源", "题型", "题目", "选项A", "选项B", "选项C", "选项D", "正确答案", "解析", "质量状态"];
const sourceName = (s) => (s === "2023港澳台中华文化知识大赛" ? "2023全国港澳台大学生中华文化知识大赛" : "中国文化史概要·教材命题（视觉识别）");
const rows = merged.map((q, i) => [
  i + 1, "中华文化题库", sourceName(q.source), "单选题",
  q.question, q.options[0], q.options[1], q.options[2], q.options[3],
  q.answer, q.explanation, q.quality ?? (q.source === "2023港澳台中华文化知识大赛" ? "官方原题" : "教材命题"),
]);
const wb = Workbook.create();
const sheet = wb.worksheets.add("题库");
sheet.showGridLines = false;
sheet.getRangeByIndexes(0, 0, rows.length + 1, headers.length).values = [headers, ...rows];
sheet.freezePanes.freezeRows(1);
sheet.freezePanes.freezeColumns(2);
const used = sheet.getRangeByIndexes(0, 0, rows.length + 1, headers.length);
used.format.font = { name: "Microsoft YaHei", size: 10, color: "#1F2937" };
used.format.verticalAlignment = "center";
used.format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
sheet.getRange("A1:L1").format = { fill: "#1F4E78", font: { name: "Microsoft YaHei", size: 11, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
sheet.getRange(`F2:L${rows.length + 1}`).format.wrapText = true;
for (const [c, w] of [["A", 8], ["B", 14], ["C", 30], ["D", 18], ["E", 48], ["F", 24], ["G", 24], ["H", 24], ["I", 24], ["J", 10], ["K", 60], ["L", 26]]) sheet.getRange(`${c}1:${c}${rows.length + 1}`).format.columnWidth = w;
const table = sheet.tables.add(`A1:L${rows.length + 1}`, true, "Bank");
table.style = "TableStyleMedium2";
table.showBandedRows = true;
wb.recalculate();
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outXlsx);
console.log("wrote", outXlsx, "rows", rows.length);

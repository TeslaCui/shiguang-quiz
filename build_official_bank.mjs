import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const SOURCE = "2023港澳台中华文化知识大赛";
const excelPath = "C:/Users/Tesla/Downloads/【题库】2023年全国港澳台大学生中华文化知识大赛.xlsx";
const projectDir = "D:/myApp/刷刷题";
const outXlsx = `${projectDir}/中华文化考研题库_2023全国港澳台大赛_官方版.xlsx`;
const outJson = `${projectDir}/questions.json`;
const legacyBackup = `${projectDir}/outputs/legacy_questions_2713.bak.json`;

const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const bigrams = (text) => {
  const compact = norm(text).replace(/[\p{P}\p{S}\s]/gu, "");
  const set = new Set();
  for (let i = 0; i < compact.length - 1; i++) set.add(compact.slice(i, i + 2));
  return set;
};
const overlap = (a, b) => {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return (2 * hit) / (a.size + b.size);
};

// ---------- read official workbook ----------
const book = await SpreadsheetFile.importXlsx(await fs.readFile(excelPath));
const rows = (sheetName) => {
  const values = book.worksheets.getItem(sheetName).getUsedRange(true).values;
  return values.slice(1).filter((r) => r.some((v) => v !== null && String(v).trim() !== ""));
};
const fillRows = rows("填空题");   // [编号,问题,正确答案,解析]
const singleRows = rows("单选题"); // [编号,问题,A,B,C,D,正确答案,解析]
const multipleRows = rows("多选题");
const judgeRows = rows("判断题");  // [编号,题干,正确答案,解析]

// ---------- assemble records ----------
const records = []; // {source,type,question,options,answer,explanation,generatedOptions,quality,origType}
let seq = 0;
const pushRec = (rec) => records.push({ id: `${SOURCE}-${seq++}`, ...rec });

for (const r of singleRows) {
  const opts = [2, 3, 4, 5].map((c) => norm(r[c])).filter(Boolean);
  pushRec({
    source: SOURCE, type: "single", question: norm(r[1]), options: opts,
    answer: norm(r[6]), explanation: norm(r[7]), generatedOptions: false,
    quality: "官方完整", origType: "单选题",
  });
}
for (const r of multipleRows) {
  const opts = [2, 3, 4, 5].map((c) => norm(r[c])).filter(Boolean);
  pushRec({
    source: SOURCE, type: "multiple", question: norm(r[1]), options: opts,
    answer: norm(r[6]).toUpperCase(), explanation: norm(r[7]), generatedOptions: false,
    quality: "官方完整", origType: "多选题",
  });
}
const judgeLetter = (t, expl) => {
  if (t === "正确") return "A";
  if (t === "错误") return "B";
  // source data glitches: a few rows contain "正确错误" etc. -> infer from explanation
  if (/(正确|对|√)/.test(t) && /(错误|错|×)/.test(t)) {
    if (/(应为|应是|应为…|而不是|并非|不是|实为|混淆|错在)/.test(expl)) return "B";
    if (/(故|因此|确认|无误|表述正确)/.test(expl)) return "A";
  }
  return t;
};
for (const r of judgeRows) {
  const ansText = norm(r[2]);
  pushRec({
    source: SOURCE, type: "judge", question: norm(r[1]), options: ["正确", "错误"],
    answer: judgeLetter(ansText, norm(r[3])), answerText: ansText === "正确" ? "正确" : "错误",
    explanation: norm(r[3]), generatedOptions: false,
    quality: "官方完整", origType: "判断题",
  });
}
for (const r of fillRows) {
  const ans = norm(r[2]);
  pushRec({
    source: SOURCE, type: "fill", question: norm(r[1]), options: [ans],
    answer: "A", answerText: ans, explanation: norm(r[3]), generatedOptions: false,
    quality: "官方填空", origType: "填空题",
  });
}

// ---------- validation ----------
const qKey = (q) => `${norm(q.question)}|${q.options.join("|")}|${q.answer}`;
const dupSet = new Set();
let dup = 0;
const badAnswer = [];
for (const q of records) {
  if (q.type === "single" && !/^[A-D]$/.test(q.answer)) badAnswer.push(q.id);
  if (q.type === "multiple" && !/^[A-D]{2,4}$/.test(q.answer)) badAnswer.push(q.id);
  if (q.type === "judge" && !/^[AB]$/.test(q.answer)) badAnswer.push(q.id);
  if (q.type === "fill" && q.options.length !== 1) badAnswer.push(`${q.id}:fillopts=${q.options.length}`);
  if (q.type === "single" && q.options.length !== 4) badAnswer.push(`${q.id}:opts=${q.options.length}`);
  if (q.type === "multiple" && q.options.length !== 4) badAnswer.push(`${q.id}:multiopts=${q.options.length}`);
  if (q.type === "judge" && q.options[0] !== "正确") badAnswer.push(`${q.id}:judgeopts`);
  const k = qKey(q);
  if (dupSet.has(k)) dup++;
  dupSet.add(k);
}
console.log("RECORDS", records.length, "dup", dup, "badAnswer", badAnswer.length, badAnswer.slice(0, 5));

// ---------- export questions.json (with backup of legacy) ----------
await fs.mkdir(path.dirname(legacyBackup), { recursive: true });
try { await fs.copyFile(outJson, legacyBackup); console.log("backed up legacy to", legacyBackup); } catch { /* first run */ }
const jsonOut = records.map((q) => {
  const out = {
    source: q.source, type: q.type, question: q.question, options: q.options,
    answer: q.answer, explanation: q.explanation, id: q.id,
    generatedOptions: q.generatedOptions, needsReview: false, quality: q.quality,
  };
  if (q.answerText) out.answerText = q.answerText;
  return out;
});
await fs.writeFile(outJson, JSON.stringify(jsonOut));
console.log("wrote", outJson, jsonOut.length, "questions");

// ---------- export styled xlsx ----------
const headers = ["序号", "题库", "来源", "题型", "题目", "选项A", "选项B", "选项C", "选项D", "正确答案", "解析", "质量状态"];
const typeLabel = { single: "单选题", multiple: "多选题", judge: "判断题", fill: "填空题" };
const outputRows = records.map((q, i) => {
  let ansCell = q.answer;
  if (q.type === "judge") ansCell = q.answer === "A" ? "正确" : "错误";
  const qType = typeLabel[q.type] ?? q.type;
  let quality;
  if (q.type === "fill") {
    ansCell = q.answerText;
    quality = "官方原题（填空题：答案为词，本身无选项；网页端以填空模式刷题）";
  } else if (q.type === "judge") {
    quality = "官方原题（判断题：选项为 正确/错误）";
  } else {
    quality = "官方原题（题干/选项/答案/解析完整）";
  }
  return [i + 1, "中华文化题库", SOURCE, qType, q.question, q.options[0] ?? "", q.options[1] ?? "", q.options[2] ?? "", q.options[3] ?? "", ansCell, q.explanation, quality];
});

const wb = Workbook.create();
const sheet = wb.worksheets.add("题库");
sheet.showGridLines = false;
sheet.getRangeByIndexes(0, 0, outputRows.length + 1, headers.length).values = [headers, ...outputRows];
sheet.freezePanes.freezeRows(1);
sheet.freezePanes.freezeColumns(2);
const used = sheet.getRangeByIndexes(0, 0, outputRows.length + 1, headers.length);
used.format.font = { name: "Microsoft YaHei", size: 10, color: "#1F2937" };
used.format.verticalAlignment = "center";
used.format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
sheet.getRange("A1:L1").format = {
  fill: "#1F4E78", font: { name: "Microsoft YaHei", size: 11, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center", verticalAlignment: "center", wrapText: true,
  borders: { preset: "all", style: "thin", color: "#B4C7E7" },
};
sheet.getRange(`A2:E${outputRows.length + 1}`).format.horizontalAlignment = "center";
sheet.getRange(`F2:L${outputRows.length + 1}`).format.wrapText = true;
for (const [col, width] of [["A", 8], ["B", 14], ["C", 26], ["D", 26], ["E", 48], ["F", 26], ["G", 26], ["H", 26], ["I", 26], ["J", 11], ["K", 60], ["L", 40]]) {
  sheet.getRange(`${col}1:${col}${outputRows.length + 1}`).format.columnWidth = width;
}
sheet.getRange("A1:L1").format.rowHeight = 30;
sheet.getRange(`A2:L${outputRows.length + 1}`).format.rowHeight = 48;
const table = sheet.tables.add(`A1:L${outputRows.length + 1}`, true, "OfficialBank");
table.style = "TableStyleMedium2";
table.showFilterButton = true;
table.showBandedRows = true;
wb.recalculate();
const exported = await SpreadsheetFile.exportXlsx(wb);
await exported.save(outXlsx);
console.log("wrote", outXlsx);

// stats + sample check
const counts = {};
for (const q of records) counts[q.origType] = (counts[q.origType] ?? 0) + 1;
console.log("COUNTS", JSON.stringify(counts));
console.log("SAMPLE fill questions (first 6):");
for (const q of records.filter((x) => x.type === "fill").slice(0, 6)) {
  console.log(" Q:", q.question.slice(0, 70));
  console.log("  answer:", q.answerText, " expl:", (q.explanation || "").slice(0, 60));
}

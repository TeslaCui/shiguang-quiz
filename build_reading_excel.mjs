import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const dir = "D:/myApp/刷刷题";
const AUTHOR = {
  // 文言
  劝学: "荀子", 论语: "《论语》", 岳阳楼记: "范仲淹", 出师表: "诸葛亮", 桃花源记: "陶渊明",
  爱莲说: "周敦颐", 马说: "韩愈", 赤壁赋: "苏轼", 兰亭集序: "王羲之",
  // 白话
  寻根: "汪曾祺", 匆匆: "朱自清", 背影: "朱自清", 故都的秋: "郁达夫",
};
const SCOPE = {
  劝学: "文言节选", 论语: "文言选段", 岳阳楼记: "文言全文", 出师表: "文言节选", 桃花源记: "文言全文",
  爱莲说: "文言全文", 马说: "文言全文", 赤壁赋: "文言节选", 兰亭集序: "文言节选",
  寻根: "白话全文", 匆匆: "白话全文", 背影: "白话全文", 故都的秋: "白话全文",
};

async function scanRecords() {
  const out = [];
  const files = (await fs.readdir(`${dir}/outputs`)).filter((f) => f.startsWith("scratch_vision_q") && f.endsWith(".json")).sort();
  for (const f of files) {
    const arr = JSON.parse(await fs.readFile(`${dir}/outputs/${f}`, "utf8"));
    for (const q of arr) if (q.source === "Z002阅读题·精选") out.push(q);
  }
  return out;
}

function splitQ(q) {
  const t = q.question || "";
  const i = t.indexOf("【阅读材料】"), j = t.indexOf("【小题");
  const sub = (j >= 0 ? t.slice(j) : t).replace(/^【小题\s*\d+】?\s*/, "").trim();
  const no = (j >= 0 ? Number((t.slice(j + 5, j + 14).match(/\d/) || [1])[0]) : 1);
  return { sub, no };
}

const records = await scanRecords();
const byTitle = {};
for (const q of records) {
  (byTitle[q.group] = byTitle[q.group] || []).push(q);
}
const essays = [];
for (const title of Object.keys(byTitle).sort()) {
  const list = byTitle[title].slice().sort((a, b) => splitQ(a).no - splitQ(b).no);
  const first = list[0];
  const questions = list.map((q) => ({ ...splitQ(q), options: q.options || [], answer: q.answer || "", explanation: q.explanation || "", culture: q.culture || "", translation: q.translation || "" }));
  essays.push({
    title, rType: first.rType, author: AUTHOR[title] || "", scope: SCOPE[title] || "",
    full: first.full || "", questions,
  });
}
// additional curated essays (curriculum classics; texts verified against public sources)
const extraRaw = JSON.parse(await fs.readFile(`${dir}/outputs/reading_new7.json`, "utf8"));
const extra = extraRaw.map((e) => ({
  ...e,
  questions: e.questions.map((q) => ({ no: q.no, sub: q.stem || q.sub || "", options: q.options, answer: q.answer, explanation: q.explanation || "", culture: q.culture || "", translation: q.translation || "" })),
}));
essays.push(...extra);
// validations
const issues = [];
for (const e of essays) {
  if (e.questions.length < 3 || e.questions.length > 5) issues.push(`${e.title} 题数 ${e.questions.length}`);
  if ((e.full || "").length < 100) issues.push(`${e.title} 文章过短 ${(e.full || "").length}`);
  for (const q of e.questions) {
    if (!/^[A-D]$/.test(q.answer)) issues.push(`${e.title}#${q.no} answer`);
    if ((q.options || []).length < 2) issues.push(`${e.title}#${q.no} options`);
    if (q.sub.includes("【阅读材料】")) issues.push(`${e.title}#${q.no} stem残留材料`);
  }
}
console.log("essays:", essays.length, "文言:", essays.filter((e) => e.rType === "classical").length, "白话:", essays.filter((e) => e.rType === "modern").length);
console.log("issues:", issues.length, issues.slice(0, 8));

await fs.writeFile(`${dir}/outputs/reading_essays.json`, JSON.stringify(essays, null, 1));

// ---- export excel: one row per question, essay text on each row ----
const headers = ["序号", "文体", "篇目", "作者/出处", "文章范围", "完整文章", "题号", "题干", "选项A", "选项B", "选项C", "选项D", "正确答案", "解析", "备注（文言译文/文化补充）"];
let seq = 0;
const rows = [];
for (const e of essays) {
  for (const q of e.questions) {
    seq++;
    const opts = q.options.map((o, i) => [String.fromCharCode(65 + i), o]);
    const ans = opts.find(([l]) => l === q.answer);
    const extra = [e.rType === "classical" && q.translation ? `译文：${q.translation}` : "", q.culture ? `文化补充：${q.culture}` : ""].filter(Boolean).join("\n");
    rows.push([
      seq, e.rType === "classical" ? "文言文" : "白话文", e.title, e.author, e.scope, e.full, `第${q.no}题`,
      q.sub, ...opts.map(([, o]) => o),
      ans ? `${q.answer}. ${ans[1]}` : q.answer, q.explanation, extra,
    ]);
  }
}

const wb = Workbook.create();
const sheet = wb.worksheets.add("阅读题库");
sheet.showGridLines = false;
const totalCols = headers.length;
sheet.getRangeByIndexes(0, 0, rows.length + 1, totalCols).values = [headers, ...rows];
sheet.freezePanes.freezeRows(1);
sheet.freezePanes.freezeColumns(3);
const used = sheet.getRangeByIndexes(0, 0, rows.length + 1, totalCols);
used.format.font = { name: "Microsoft YaHei", size: 10, color: "#1F2937" };
used.format.verticalAlignment = "top";
used.format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
sheet.getRange("A1:O1").format = { fill: "#1F4E78", font: { name: "Microsoft YaHei", size: 11, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
for (const col of ["F", "H", "I", "J", "K", "L", "M", "N", "O"]) sheet.getRange(`${col}2:${col}${rows.length + 1}`).format.wrapText = true;
for (const [c, w] of [["A", 6], ["B", 10], ["C", 16], ["D", 14], ["E", 12], ["F", 70], ["G", 8], ["H", 46], ["I", 26], ["J", 26], ["K", 26], ["L", 26], ["M", 12], ["N", 46], ["O", 46]]) sheet.getRange(`${c}1:${c}${rows.length + 1}`).format.columnWidth = w;
const table = sheet.tables.add(`A1:O${rows.length + 1}`, true, "ReadingBank");
table.style = "TableStyleMedium2";
table.showBandedRows = true;
wb.recalculate();
const outPath = `${dir}/阅读题库.xlsx`;
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outPath);
console.log("wrote", outPath, "question rows:", rows.length);
console.log("sample stem:", essays[0].questions[0].sub.slice(0, 40));

import fs from "node:fs/promises";
// Mark core (priority=1) questions in the OFFICIAL part of questions.json
// based on Z002 high-frequency topic rules (literature/thinkers/exam systems/
// medicine/inventions/festivals/art/era titles). Textbook questions keep 1.
const p = "D:/myApp/刷刷题/questions.json";
const bank = JSON.parse(await fs.readFile(p, "utf8"));
const RULES = [
  /科举|进士|状元|举人|贡士|秀才|院试|乡试|会试|殿试|八股|连中三元|及第|题名/,
  /(诗圣|诗仙|诗史|四杰|八大家|豪放派|婉约派|书圣|画圣|吴带当风|三吏|三别|兰亭|醉翁|桃花源|孔雀东南飞|木兰|离骚|楚辞|乐府|传奇|章回|红楼梦|三国演义|水浒|西游|儒林外史)/,
  /(孔子|孟子|荀子|老子|庄子|墨子|韩非|儒家|道家|墨家|法家|仁政|性善|兼爱|无为而治|仁者爱人|己所不欲|知行合一|致良知|存天理|格物|理气|独尊儒术|天人感应)/,
  /(黄帝内经|本草纲目|伤寒杂病论|医圣|扁鹊|华佗|张仲景|李时珍|孙思邈|针灸|望闻问切)/,
  /(蔡伦|毕昇|活字|造纸术|指南针|火药|印刷术|司南|雕版)/,
  /(春节|元宵|清明|端午|中秋|重阳|除夕|寒食|腊八|七夕|二十四节气|节气)/,
  /(编钟|古琴|围棋|象棋|王羲之|颜真卿|柳公权|欧阳询|楷书|隶书|小篆|草书|行书|吴道子|顾恺之|清明上河图|敦煌|京剧|元曲)/,
  /(年号|庙号|谥号|干支|生肖|建元|贞观|开元盛世|文景之治|成康之治|太初历|三正|闰月|朔望)/,
  /(《[^》]{1,16}》|作者是|作者为|著作|典籍|代表作|出自|名句|一词|典故)/,
];
let core = 0;
for (const q of bank) {
  if (q.source !== "2023港澳台中华文化知识大赛") { q.priority = 1; continue; }
  const t = q.question + " " + (q.explanation || "");
  q.priority = RULES.some((re) => re.test(t)) ? 1 : 0;
  if (q.priority === 1) core++;
}
await fs.writeFile(p, JSON.stringify(bank));
console.log("official core:", core, "/2000; total:", bank.length, "priority1:", bank.filter((q) => q.priority === 1).length);

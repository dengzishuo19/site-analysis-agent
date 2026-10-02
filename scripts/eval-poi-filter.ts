// 在人工标注的测试集上度量噪点过滤：node scripts/eval-poi-filter.ts [--detail]
import fs from "node:fs";
import { evaluate, type LabeledGroup } from "../lib/poi-eval.ts";

const groups: LabeledGroup[] = JSON.parse(fs.readFileSync("docs/testset/labels.json", "utf8"));
const detail = process.argv.includes("--detail");
const pct = (x: number) => (x * 100).toFixed(1) + "%";

const all = evaluate(groups);
console.log(`测试集：${groups.length} 组、${all.total} 个点位（应保留 ${all.keep}，应去除 ${all.remove}）`);
console.log(`误杀 ${all.killed.length}/${all.keep} = ${pct(all.killRate)}；漏网 ${all.missed.length}/${all.remove} = ${pct(all.missRate)}\n`);

console.log("分组：");
for (const g of groups) {
  const m = evaluate([g]);
  console.log(`  ${g.siteName} · ${g.category}：应保留 ${m.keep}、应去除 ${m.remove}；误杀 ${m.killed.length}、漏网 ${m.missed.length}`);
}
if (detail) {
  console.log("\n误杀：");
  for (const r of all.killed) console.log(`  ${r.name}`);
  console.log("\n漏网：");
  for (const r of all.missed) console.log(`  [${r.label}] ${r.name}`);
}

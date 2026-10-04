// 在人工标注的测试集上度量噪点过滤：node scripts/eval-poi-filter.ts [--detail]
// 两组分开报告：北京（docs/testset/labels.json）与外地（docs/testset/labels-nationwide.json）
import fs from "node:fs";
import { evaluate, type LabeledGroup } from "../lib/poi-eval.ts";

const sets: [string, LabeledGroup[]][] = [
  ["北京", JSON.parse(fs.readFileSync("docs/testset/labels.json", "utf8"))],
  ["外地", JSON.parse(fs.readFileSync("docs/testset/labels-nationwide.json", "utf8"))],
];
const detail = process.argv.includes("--detail");
const pct = (x: number) => (x * 100).toFixed(1) + "%";

for (const [name, groups] of sets) {
  const all = evaluate(groups);
  console.log(`【${name}】${groups.length} 组、${all.total} 个点位（应保留 ${all.keep}，应去除 ${all.remove}）`);
  console.log(`  误杀 ${all.killed.length}/${all.keep} = ${pct(all.killRate)}；漏网 ${all.missed.length}/${all.remove} = ${pct(all.missRate)}`);
  for (const g of groups) {
    const m = evaluate([g]);
    if (detail || m.killed.length || m.missed.length) console.log(`    ${g.siteName} · ${g.category}：误杀 ${m.killed.length}、漏网 ${m.missed.length}`);
  }
  if (detail) {
    for (const r of all.killed) console.log(`    误杀  ${r.name}`);
    for (const r of all.missed) console.log(`    漏网  [${r.label}] ${r.name}`);
  }
  console.log("");
}

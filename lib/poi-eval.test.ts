import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { currentRule, evaluate, type LabeledGroup } from "./poi-eval.ts";

const groups: LabeledGroup[] = JSON.parse(fs.readFileSync("docs/testset/labels.json", "utf8"));

test("测试集完整：每个点位都有标注、坐标与父级编号字段", () => {
  assert.equal(groups.length, 15);
  for (const g of groups) {
    for (const r of g.pois) {
      assert.ok(["K", "S", "M"].includes(r.label), `${g.site}/${g.category}/${r.name} 标注无效：${r.label}`);
      assert.ok(Number.isFinite(r.lng) && Number.isFinite(r.lat), r.name);
      assert.equal(typeof r.parentId, "string");
    }
  }
});

test("度量：全部保留的规则漏网率为 100%、误杀率为 0", () => {
  const m = evaluate(groups, (pois) => new Set(pois.map((p) => p.id)));
  assert.equal(m.killed.length, 0);
  assert.equal(m.missed.length, m.remove);
});

test("度量：全部去除的规则误杀率为 100%、漏网率为 0", () => {
  const m = evaluate(groups, () => new Set());
  assert.equal(m.missed.length, 0);
  assert.equal(m.killed.length, m.keep);
});

// 防退化：改过滤规则后，这两个数只能变好，不能变差。规则改进后请同步下调。
test("当前规则的基线：误杀不超过 4，漏网不超过 48", () => {
  const m = evaluate(groups, currentRule);
  assert.ok(m.killed.length <= 4, `误杀 ${m.killed.length}：${m.killed.map((r) => r.name).join("、")}`);
  assert.ok(m.missed.length <= 48, `漏网 ${m.missed.length}`);
});

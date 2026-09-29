import { test } from "node:test";
import assert from "node:assert/strict";
import { extractNumbers, verifyReport, type VerifiableStats } from "./verify.ts";

// 测试用统计数据：地铁 32 个（最近 36 m），公交 24 个（最近 0 m），商业封顶 600，工业 0
const stats: VerifiableStats = {
  center: { lng: 116.459242, lat: 39.908658 },
  radius: 1000,
  categories: [
    { count: 32, nearest: { distanceM: 36 }, items: [{ distanceM: 36 }, { distanceM: 57 }] },
    { count: 24, nearest: { distanceM: 0 }, items: [{ distanceM: 0 }, { distanceM: 120 }] },
    { count: 600, nearest: { distanceM: 25 }, items: [{ distanceM: 25 }] },
    { count: 0, nearest: null, items: [] },
  ],
};

test("正常引用的数字通过校验", () => {
  const text = "半径 1000 m（即 1 km）范围内检索到地铁站出入口 32 个，最近的距离 36 m；公交站 24 个，最近 0 m。";
  assert.deepEqual(verifyReport(text, stats), { ok: true, violations: [] });
});

test("编造的数量被抓出", () => {
  const r = verifyReport("范围内共有地铁站出入口 45 个。", stats);
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations, ["45"]);
});

test("模型自行计算的百分比与总和被抓出", () => {
  const r = verifyReport("地铁与公交合计 56 个，占比 12.5%，平均距离 48 m。", stats);
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations.sort(), ["12.5", "48", "56"]);
});

test("「」内的设施名称含数字时不误报", () => {
  const r = verifyReport("最近的是「北辛安地铁站1号线A口」，距离 36 m；另有「10号线国贸站」。", stats);
  assert.deepEqual(r, { ok: true, violations: [] });
});

test("设施名称在「」之外出现的数字会被抓出（防止绕过）", () => {
  const r = verifyReport("最近的是国贸站10号线站台，距离 36 m。", stats);
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations, ["10"]);
});

test("已知局限：与允许数字同值的违规无法被发现（1 与 1 km 换算撞值）", () => {
  // 记录当前设计的边界：允许集合含 1（半径换算），故「」外的“1号线”不会报错
  assert.equal(verifyReport("最近的是北辛安地铁站1号线A口，距离 36 m。", stats).ok, true);
});

test("千位分隔符与小数的处理", () => {
  assert.deepEqual(extractNumbers("半径 1,000 米，中心 116.459242"), ["1000", "116.459242"]);
  assert.deepEqual(verifyReport("半径 1,000 米内。", stats), { ok: true, violations: [] });
});

test("封顶类别写“不少于 600”通过，写成 601 被抓出", () => {
  assert.equal(verifyReport("商业设施不少于 600 处。", stats).ok, true);
  assert.deepEqual(verifyReport("商业设施 601 处。", stats).violations, ["601"]);
});

test("数量为 0 的如实表述通过", () => {
  assert.equal(verifyReport("工业类设施 0 处，范围内未检索到。", stats).ok, true);
});

test("空文本视为不合规", () => {
  assert.deepEqual(verifyReport("   \n ", stats), { ok: false, violations: ["简报内容为空"] });
});

test("重复的违规数字只报告一次", () => {
  assert.deepEqual(verifyReport("共 99 个，其中 99 个为出入口。", stats).violations, ["99"]);
});

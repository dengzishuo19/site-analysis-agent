import { test } from "node:test";
import assert from "node:assert/strict";
import { extractNumbers, verifyNumbersOnly, verifyReport, type VerifiableStats } from "./verify.ts";

// 测试用统计数据：地铁 32 个（含同名出入口两个距离）、公交 24 个、商业封顶 600、教育 17 个、工业 0 个
const stats: VerifiableStats = {
  center: { lng: 116.459242, lat: 39.908658 },
  radius: 1000,
  categories: [
    {
      label: "地铁站出入口",
      count: 32,
      nearest: { name: "国贸地铁站A西北口", distanceM: 36 },
      items: [
        { name: "国贸地铁站A西北口", distanceM: 36 },
        { name: "国贸地铁站出入口", distanceM: 57 },
        { name: "国贸地铁站1号线A口", distanceM: 90 },
        { name: "国贸地铁站D西南口", distanceM: 106 },
        { name: "国贸地铁站出入口", distanceM: 127 },
      ],
    },
    {
      label: "公交站",
      count: 24,
      nearest: { name: "国贸地铁站(公交站)", distanceM: 0 },
      items: [
        { name: "国贸地铁站(公交站)", distanceM: 0 },
        { name: "国贸(公交站)", distanceM: 352 },
      ],
    },
    {
      label: "商业（购物+餐饮）",
      count: 600,
      nearest: { name: "EMPORIO ARMANI(国贸商城店)", distanceM: 25 },
      items: [
        { name: "EMPORIO ARMANI(国贸商城店)", distanceM: 25 },
        { name: "Mulberry(北京国贸商城店)", distanceM: 27 },
      ],
    },
    {
      label: "教育（学校）",
      count: 17,
      nearest: { name: "首尔科学综合大学院大学中国代表处", distanceM: 272 },
      items: [{ name: "首尔科学综合大学院大学中国代表处", distanceM: 272 }],
    },
    { label: "工业（工厂+产业园区）", count: 0, nearest: null, items: [] },
  ],
};

const GOOD =
  "范围内检索到地铁站出入口共 32 处，最近为「国贸地铁站A西北口」，距离 36 m，其后依次为「国贸地铁站出入口」距离 57 m、「国贸地铁站D西南口」距离 106 m（依据：地铁站出入口）。" +
  "公交站共 24 处，最近为「国贸地铁站(公交站)」，距离 0 m（依据：公交站）。";

// 取所有违规的类别
const kinds = (text: string) => verifyReport(text, stats).issues.map((i) => i.kind);

test("正确的断言全部通过，且全部被配对校验过", () => {
  const r = verifyReport(GOOD, stats);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
  assert.deepEqual([r.coverage.numbers, r.coverage.bound], [6, 6]);
});

test("编造的数量被抓出，并给出数据中的正确值", () => {
  const r = verifyReport("范围内共有地铁站出入口 45 个。", stats);
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations, ["地铁站出入口 45 个（数据中为 32 处）"]);
});

test("数量写成另一处设施的距离（旧校验器的漏洞）被新校验器抓出", () => {
  const text = "地铁站出入口共 36 处。";
  assert.equal(verifyNumbersOnly(text, stats).ok, true); // 旧的：36 在统计表里，放行
  assert.deepEqual(kinds(text), ["count-mismatch"]); // 新的：抓出
});

test("距离写成另一个设施的距离被抓出", () => {
  const text = "最近为「国贸地铁站A西北口」，距离 57 m。";
  assert.equal(verifyNumbersOnly(text, stats).ok, true);
  const r = verifyReport(text, stats);
  assert.deepEqual(r.violations, ["「国贸地铁站A西北口」距离 57 m（数据中为 36 m）"]);
});

test("互换两个设施的距离，两处都被抓出", () => {
  const text = "「国贸地铁站A西北口」距离 106 m、「国贸地铁站D西南口」距离 36 m。";
  assert.equal(verifyNumbersOnly(text, stats).ok, true);
  assert.deepEqual(kinds(text), ["distance-mismatch", "distance-mismatch"]);
});

test("同名设施有多个距离时，任一匹配即通过；都不匹配则给出全部合法值", () => {
  assert.equal(verifyReport("「国贸地铁站出入口」距离 57 m，「国贸地铁站出入口」距离 127 m。", stats).ok, true);
  const r = verifyReport("「国贸地铁站出入口」距离 106 m。", stats);
  assert.deepEqual(r.violations, ["「国贸地铁站出入口」距离 106 m（数据中为 57 或 127 m）"]);
});

test("设施名写错被抓出（旧校验器完全看不到名称）", () => {
  const text = "最近为「国贸地铁站A东北口」，距离 36 m。";
  assert.equal(verifyNumbersOnly(text, stats).ok, true);
  assert.deepEqual(verifyReport(text, stats).violations, ["「国贸地铁站A东北口」（数据中无此设施）"]);
});

test("数量写成另一个类别的数量被抓出", () => {
  const text = "公交站共 32 处。"; // 32 是地铁的数量
  assert.equal(verifyNumbersOnly(text, stats).ok, true);
  assert.deepEqual(verifyReport(text, stats).violations, ["公交站共 32 处（数据中为 24 处）"]);
});

test("封顶类别：写“不少于 600 处”通过，写成 601 只报一处配对违规（不重复报数字）", () => {
  assert.equal(verifyReport("商业（购物+餐饮）类别检索到不少于 600 处。", stats).ok, true);
  const r = verifyReport("商业（购物+餐饮）类别检索到不少于 601 处。", stats);
  assert.deepEqual(r.issues.map((i) => i.kind), ["count-mismatch"]);
});

test("类别名在前与数字在前两种语序都能绑定", () => {
  assert.equal(verifyReport("共检索到 32 处地铁站出入口。", stats).ok, true);
  assert.deepEqual(kinds("共检索到 36 处地铁站出入口。"), ["count-mismatch"]);
  assert.equal(verifyReport("其中 17 处的教育（学校）分布较散。", stats).ok, true);
});

test("一句话里出现多个类别时各自绑定，错一个只报一个", () => {
  assert.equal(verifyReport("地铁站出入口 32 处、公交站 24 处、教育（学校）17 处。", stats).ok, true);
  const r = verifyReport("地铁站出入口 32 处、公交站 25 处。", stats); // 25 是商业最近距离，在统计表里
  assert.deepEqual(r.violations, ["公交站 25 处（数据中为 24 处）"]);
});

test("类别与数字之间夹着另一个类别名时不误绑", () => {
  assert.equal(verifyReport("地铁站出入口与公交站共 24 处。", stats).ok, true); // 24 绑定到公交站
});

test("支持简称：去掉括号、去掉“出入口”后缀", () => {
  assert.equal(verifyReport("教育 17 处，地铁站 32 处，商业 600 处。", stats).ok, true);
  assert.deepEqual(kinds("教育 18 处。"), ["count-mismatch"]);
});

test("「」内含数字的设施名不参与数字检查，且名称需存在", () => {
  const r = verifyReport("最近为「国贸地铁站1号线A口」，距离 90 m。", stats);
  assert.deepEqual(r, { ...r, ok: true, violations: [] });
  assert.deepEqual(r.coverage.numbers, 1); // 名称里的 1 没有计入
});

test("场地中心恰好也是数据里的设施名时，其后的“半径 1000 m”不是它的距离（真实简报中出现过的误报）", () => {
  const text = "本次分析以「国贸地铁站(公交站)」为中心，分析半径 1000 m。";
  const r = verifyReport(text, stats);
  assert.equal(r.ok, true);
  assert.deepEqual([r.coverage.numbers, r.coverage.bound], [1, 1]); // 1000 被识别为半径
  // 但真正的距离断言仍然会被检查
  assert.deepEqual(kinds("「国贸地铁站(公交站)」，距离 1000 m。"), ["distance-mismatch"]);
});

test("名称后的数字若不带 m 单位，不当作距离绑定", () => {
  const r = verifyReport("「国贸地铁站A西北口」共 3 处。", stats);
  assert.deepEqual(r.issues.map((i) => i.kind), ["unknown-number"]); // 3 不在统计表里
});

test("名称与数字相隔太远时不绑定", () => {
  const far = "「国贸地铁站A西北口」是一处位于国贸核心区域内部的重要交通节点设施，距离 57 m。";
  const r = verifyReport(far, stats);
  assert.equal(r.ok, true); // 57 在统计表里；因为相隔过远没有绑定，所以只是未绑定
  assert.deepEqual(r.coverage.unbound.map((u) => u.text), ["57"]);
});

test("下标 span 与原文位置一致（名称在前时也不偏移）", () => {
  const text = "「国贸地铁站A西北口」，距离 57 m；地铁站出入口共 45 处；另有 99。";
  const r = verifyReport(text, stats);
  const found = r.issues.map((i) => [i.kind, text.slice(i.span[0], i.span[1])]);
  assert.deepEqual(found, [
    ["distance-mismatch", "57"],
    ["count-mismatch", "45"],
    ["unknown-number", "99"],
  ]);
});

test("未绑定的合法数字不算违规，只计入覆盖率", () => {
  const r = verifyReport("本次分析涉及 36 项内容。", stats); // 36 在统计表里，但没有绑定到任何断言
  assert.equal(r.ok, true);
  assert.deepEqual(r.coverage, { numbers: 1, bound: 0, unbound: [{ text: "36", span: [7, 9] }] });
});

test("半径 1000 m 与 1 km 视为已绑定", () => {
  const r = verifyReport("分析半径 1000 m（即 1 km）。", stats);
  assert.deepEqual([r.ok, r.coverage.numbers, r.coverage.bound], [true, 2, 2]);
});

test("数量为 0 的如实表述通过", () => {
  assert.equal(verifyReport("工业（工厂+产业园区）范围内未检索到。", stats).ok, true);
  assert.equal(verifyReport("工业类设施 0 处。", stats).ok, true);
  assert.deepEqual(kinds("工业（工厂+产业园区）共 2 处。"), ["count-mismatch"]);
});

test("重复的违规描述只报告一次", () => {
  const r = verifyReport("共 99 个，其中 99 个为出入口。", stats);
  assert.equal(r.issues.length, 2);
  assert.deepEqual(r.violations, ["99"]);
});

test("千位分隔符与小数的处理", () => {
  assert.deepEqual(extractNumbers("半径 1,000 米，中心 116.459242"), ["1000", "116.459242"]);
  assert.deepEqual(extractNumbers("面积 12,3456 平方米"), ["12", "3456"]);
  assert.equal(verifyReport("半径 1,000 米内。", stats).ok, true);
});

test("空文本视为不合规", () => {
  const r = verifyReport("   \n ", stats);
  assert.deepEqual([r.ok, r.violations, r.issues.map((i) => i.kind)], [false, ["简报内容为空"], ["empty"]]);
});

test("对比：六种篡改，旧校验器漏掉五种，新校验器全部抓出", () => {
  const tampered: [string, string, boolean][] = [
    // [篡改说明, 文本, 旧校验器是否也能发现]
    ["数量改成别处的距离", "地铁站出入口共 36 处。", false],
    ["数量改成另一类别的数量", "公交站共 32 处。", false],
    ["距离改成另一个设施的距离", "「国贸地铁站A西北口」距离 57 m。", false],
    ["互换两个设施的距离", "「国贸地铁站A西北口」距离 106 m、「国贸地铁站D西南口」距离 36 m。", false],
    ["改一个设施名", "「国贸地铁站A东北口」距离 36 m。", false],
    ["编造一个不存在的数量", "地铁站出入口共 45 处。", true],
  ];
  for (const [name, text, oldCatches] of tampered) {
    assert.equal(!verifyNumbersOnly(text, stats).ok, oldCatches, `旧校验器：${name}`);
    assert.equal(verifyReport(text, stats).ok, false, `新校验器：${name}`);
  }
});

test("旧校验器保持原有行为", () => {
  assert.deepEqual(verifyNumbersOnly("范围内共有 45 个。", stats), { ok: false, violations: ["45"] });
  assert.deepEqual(verifyNumbersOnly("  ", stats), { ok: false, violations: ["简报内容为空"] });
});

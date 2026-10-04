import test from "node:test";
import assert from "node:assert/strict";
import { applySelection, countSubtypes, subtypeOf, validSelection, type PoolPoi } from "./subtype.ts";

const T = (third: string, top = "科教文化服务;学校") => `${top};${third}`;

test("教育：按类型；“学校”泛类按名称细分", () => {
  assert.equal(subtypeOf("school", T("高等院校"), "某大学"), "大学");
  assert.equal(subtypeOf("school", T("小学"), "某实验小学"), "小学");
  assert.equal(subtypeOf("school", T("学校"), "北京市某某幼儿园"), "幼儿园");
  assert.equal(subtypeOf("school", T("学校"), "某某小学低年级部"), "小学");
  assert.equal(subtypeOf("school", T("学校"), "北京市第二十五中学-英文高中"), "中学");
  assert.equal(subtypeOf("school", T("学校"), "北京师范大学附属中学"), "中学"); // 先小后大：附属中学是中学
  assert.equal(subtypeOf("school", T("学校"), "某某学院"), "大学");
  assert.equal(subtypeOf("school", T("职业技术学校"), "北京西城职业学校"), "职业学校");
  assert.equal(subtypeOf("school", T("学校"), "正泽学校"), "其他");
});

test("医疗：按类型", () => {
  const H = "医疗保健服务;";
  assert.equal(subtypeOf("hospital", H + "综合医院;三级甲等医院", "协和"), "综合医院");
  assert.equal(subtypeOf("hospital", H + "综合医院;卫生院", "某社区卫生服务站"), "社区卫生服务");
  assert.equal(subtypeOf("hospital", H + "专科医院;口腔医院", "某口腔"), "口腔");
  assert.equal(subtypeOf("hospital", H + "专科医院;整形美容", "某医美"), "医疗美容");
  assert.equal(subtypeOf("hospital", H + "专科医院;眼科医院", "某眼科"), "眼科");
  assert.equal(subtypeOf("hospital", H + "专科医院;妇科医院", "某妇科"), "其他专科");
});

test("工业：产业园区、工厂、其他", () => {
  assert.equal(subtypeOf("industry", "商务住宅;产业园区;产业园区", "某园"), "产业园区");
  assert.equal(subtypeOf("industry", "公司企业;工厂;工厂", "某厂"), "工厂");
  assert.equal(subtypeOf("industry", "公司企业;公司;公司|商务住宅;产业园区;产业园区", "某创新工场"), "产业园区");
  assert.equal(subtypeOf("industry", "商务住宅;楼宇;商务写字楼", "某大厦"), "其他");
});

const pool: PoolPoi[] = [
  { name: "A小学", distanceM: 100, lng: 116.4, lat: 39.9, sub: "小学" },
  { name: "B幼儿园", distanceM: 50, lng: 116.4, lat: 39.9, sub: "幼儿园" },
  { name: "C大学", distanceM: 300, lng: 116.4, lat: 39.9, sub: "大学" },
  { name: "D小学", distanceM: 200, lng: 116.4, lat: 39.9, sub: "小学" },
];

test("子类型分布按固定顺序，0 也保留", () => {
  assert.deepEqual(countSubtypes("school", pool).map((c) => [c.name, c.count]), [["大学", 1], ["中学", 0], ["小学", 2], ["幼儿园", 1], ["职业学校", 0], ["其他", 0]]);
});

test("勾选校验：未知子类型、空、重复、非数组一律不合法", () => {
  assert.equal(validSelection("school", ["小学", "幼儿园"]), true);
  assert.equal(validSelection("school", []), false);
  assert.equal(validSelection("school", ["小学", "小学"]), false);
  assert.equal(validSelection("school", ["医美"]), false);
  assert.equal(validSelection("school", "小学"), false);
  assert.equal(validSelection("metro", ["小学"]), false);
});

test("全选：数量沿用默认口径；部分勾选：按池重算并按距离排序", () => {
  const base = { count: 9, capped: true };
  const all = applySelection("school", pool, ["大学", "中学", "小学", "幼儿园", "职业学校", "其他"], base, true, 10);
  assert.deepEqual([all.count, all.capped], [9, true]);
  const part = applySelection("school", pool, ["小学", "幼儿园"], base, false, 10);
  assert.deepEqual([part.count, part.capped, part.items.map((i) => i.name)], [3, false, ["B幼儿园", "A小学", "D小学"]]);
  const cut = applySelection("school", pool, ["小学"], base, true, 1);
  assert.deepEqual([cut.count, cut.capped, cut.items.length], [2, true, 1]); // 池不完整 → 至少
});

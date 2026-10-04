import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STATIC_MARKERS, buildStaticMapParams, circlePoints } from "./static-map.ts";
import { buildMapModel, type VizStats } from "./map-model.ts";

const KEYS: [string, string][] = [
  ["metro", "地铁站出入口"], ["bus", "公交站"], ["school", "教育（学校）"], ["hospital", "医疗（综合/专科医院）"],
  ["commerce", "商业（购物+餐饮）"], ["park", "公园绿地"], ["industry", "工业（工厂+产业园区）"],
];
const stats: VizStats = {
  center: { address: "测试", lng: 116.459242, lat: 39.908658 },
  radius: 1000,
  categories: KEYS.map(([key, label], i) => {
    const items = key === "industry" ? [] : Array.from({ length: 10 }, (_, j) => ({ name: `${label}${j}`, distanceM: 20 + j * 30, lng: 116.459 + i * 0.0004 + j * 0.0001, lat: 39.908 + i * 0.0002 }));
    return { key, label, count: items.length, capped: false, nearest: items[0] ? { name: items[0].name, distanceM: items[0].distanceM } : null, items };
  }),
};
const model = buildMapModel(stats);

test("设施标记数不超过上限；默认每类取最近 6 个", () => {
  const p = buildStaticMapParams(model);
  assert.equal(p.markerCount, 6 * 6); // 6 类有设施，每类 6 个
  assert.ok(p.markerCount <= MAX_STATIC_MARKERS);
  const dense = buildStaticMapParams(model, { perCategory: 10 });
  assert.equal(dense.markerCount, MAX_STATIC_MARKERS);
});

test("无设施的类别不产生标记段；每段带颜色与类别单字；含中心点", () => {
  const p = buildStaticMapParams(model);
  const segs = p.markers.split("|");
  assert.equal(segs.length, 7); // 6 组（每个单字一组）+ 中心
  assert.ok(!segs.some((s) => s.includes(",工:")));
  for (const g of ["地", "公", "教", "医", "商", "园"]) assert.ok(segs.some((s) => s.startsWith("mid,0x") && s.includes(`,${g}:`)), g);
  assert.ok(segs[segs.length - 1].startsWith("mid,0x0b0b0b,中:116.459242,39.908658"));
});

// 派工单 013：页面改为黑白，静态地图的设施标记统一为墨色，类别靠单字区分（底图保留彩色）
test("设施标记统一为墨色，类别靠单字区分", () => {
  const segs = buildStaticMapParams(model).markers.split("|");
  const color = (glyph: string) => segs.find((s) => s.includes(`,${glyph}:`))!.split(",")[1];
  for (const g of ["地", "公", "教", "医", "商", "园"]) assert.equal(color(g), "0x141414", g);
});

test("坐标格式为 6 位小数，经度在前", () => {
  const p = buildStaticMapParams(model);
  assert.match(p.location, /^116\.459242,39\.908658$/);
  for (const m of p.markers.matchAll(/(\d+\.\d{6}),(\d+\.\d{6})/g)) {
    assert.ok(Number(m[1]) > 100 && Number(m[2]) < 60);
  }
});

test("半径圆：首尾闭合，点数为 49，各点到圆心的距离约等于半径", () => {
  const pts = circlePoints(116.459242, 39.908658, 1000);
  assert.equal(pts.length, 49);
  assert.deepEqual(pts[0], pts[48]);
  for (const [x, y] of pts) {
    const dx = (x - 116.459242) * 111_320 * Math.cos((39.908658 * Math.PI) / 180);
    const dy = (y - 39.908658) * 111_320;
    assert.ok(Math.abs(Math.hypot(dx, dy) - 1000) < 1);
  }
  assert.match(buildStaticMapParams(model).paths, /^2,0x0b0b0b,0\.8,0x0b0b0b,0\.06:/);
});

test("同一输入产生相同输出；缩放与尺寸可配置", () => {
  assert.deepEqual(buildStaticMapParams(model), buildStaticMapParams(structuredClone(model)));
  const p = buildStaticMapParams(model, { size: [600, 400], zoom: 15 });
  assert.deepEqual([p.size, p.zoom], ["600*400", 15]);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CLUSTER_MAX_ZOOM, clusterMarkers, countOverlaps, worldPx } from "./map-cluster.ts";
import { buildMapModel, type MapMarker } from "./map-model.ts";
import { fitZoom } from "./site-map.ts";

const mk = (categoryKey: string, lng: number, lat: number, name = categoryKey + lng): MapMarker => ({
  categoryKey, category: categoryKey, glyph: "x", family: "transit", name, distanceM: 1, lng, lat,
});

test("墨卡托：经度每差 360° 一整圈；赤道处纬度 0 在正中", () => {
  const [x0, y0] = worldPx(-180, 0, 0);
  const [x1] = worldPx(180, 0, 0);
  assert.equal(x1 - x0, 256);
  assert.ok(Math.abs(y0 - 128) < 1e-9);
});

test("空输入与单点", () => {
  assert.deepEqual(clusterMarkers([], 15), []);
  const r = clusterMarkers([mk("metro", 116.4, 39.9)], 15);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].categories, ["metro"]);
});

test("相近的同类、异类都合并；远处的不合并；类别按成员数排序", () => {
  const ms = [mk("metro", 116.4, 39.9), mk("bus", 116.40001, 39.9), mk("bus", 116.40002, 39.9), mk("park", 116.5, 39.9)];
  const r = clusterMarkers(ms, 15);
  assert.equal(r.length, 2);
  assert.equal(r[0].members.length, 3);
  assert.deepEqual(r[0].categories, ["bus", "metro"]);
});

test("隐藏的类别不参与聚合", () => {
  const ms = [mk("metro", 116.4, 39.9), mk("bus", 116.40001, 39.9)];
  const r = clusterMarkers(ms, 15, { hidden: new Set(["bus"]) });
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].categories, ["metro"]);
});

test("缩放到最大级别不聚合：每个点单独显示", () => {
  const ms = [mk("metro", 116.4, 39.9), mk("bus", 116.4, 39.9)];
  assert.equal(clusterMarkers(ms, CLUSTER_MAX_ZOOM).length, 2);
  assert.equal(clusterMarkers(ms, CLUSTER_MAX_ZOOM - 1).length, 1);
});

test("聚合不丢点：成员总数等于可见标记数", () => {
  const ms = Array.from({ length: 40 }, (_, i) => mk(i % 2 ? "bus" : "metro", 116.4 + (i % 7) * 0.0004, 39.9 + Math.floor(i / 7) * 0.0004, "p" + i));
  const r = clusterMarkers(ms, 15);
  assert.equal(r.reduce((a, c) => a + c.members.length, 0), 40);
});

// 回归：5 个演示案例在默认视野（420 px 地图框）下，聚合后被压住的符号降到个位数
test("演示案例：默认视野下聚合后遮挡降到个位数，且不丢点", () => {
  const cases = JSON.parse(fs.readFileSync("demo-data/cases.json", "utf8"));
  for (const c of cases) {
    const model = buildMapModel(c.stats);
    const z = fitZoom(420, model.radius, model.center.lat);
    const clusters = clusterMarkers(model.markers, z);
    assert.equal(clusters.reduce((a, k) => a + k.members.length, 0), model.markers.length, c.title);
    assert.ok(countOverlaps(clusters, z) < 10, `${c.title} 聚合后仍有 ${countOverlaps(clusters, z)} 个被压住`);
  }
});

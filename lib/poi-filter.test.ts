import test from "node:test";
import assert from "node:assert/strict";
import { foldSubUnits, parentIdsToResolve, type AroundPoi, type ParentInfo } from "./poi-filter.ts";

const center = { lng: 116.4, lat: 39.9 };
const mk = (id: string, name: string, type: string, parent: string, distanceM: number, lng = 116.4, lat = 39.9): AroundPoi => ({
  id, name, type, parent, distanceM, lng, lat,
});
const HOSP = "医疗保健服务;综合医院;三级甲等医院";
const parentsOf = (...p: ParentInfo[]) => new Map(p.map((x) => [x.id, x]));

test("没有 parent 的点位原样保留", () => {
  const r = foldSubUnits([mk("a", "甲医院", HOSP, "", 50)], new Map(), center, 1000);
  assert.deepEqual(r.pois.map((p) => p.name), ["甲医院"]);
  assert.equal(r.folded, 0);
});

test("父级在同一批结果里：子点位丢弃，机构本身保留", () => {
  const r = foldSubUnits([mk("p", "协和医院", HOSP, "", 100), mk("c", "协和医院放射科", HOSP, "p", 90)], new Map(), center, 1000);
  assert.deepEqual(r.pois.map((p) => p.name), ["协和医院"]);
  assert.equal(r.pois[0].distanceM, 90); // 子点位更近，机构距离随之取 90
  assert.equal(r.folded, 1);
});

test("父级不在结果里且大类相同：多个科室合成一个父级，位置在半径内用父级位置", () => {
  const par: ParentInfo = { id: "p", name: "协和医院", type: HOSP, lng: 116.4, lat: 39.9009 };
  const r = foldSubUnits([mk("c1", "协和医院内科", HOSP, "p", 24), mk("c2", "协和医院外科", HOSP, "p", 30)], parentsOf(par), center, 1000);
  assert.equal(r.pois.length, 1);
  assert.equal(r.pois[0].name, "协和医院");
  assert.equal(r.pois[0].distanceM, 24); // 父级在约 100 m 外，子点位 24 m 更近
});

test("父级比最近子点位更近：用父级位置", () => {
  const par: ParentInfo = { id: "p", name: "协和医院", type: HOSP, lng: 116.4, lat: 39.9009 };
  const r = foldSubUnits([mk("c1", "协和医院内科", HOSP, "p", 300)], parentsOf(par), center, 1000);
  assert.ok(Math.abs(r.pois[0].distanceM - 100) < 3);
});

test("父级在半径外：沿用最近子点位的距离与位置", () => {
  const par: ParentInfo = { id: "p", name: "某大学", type: "科教文化服务;学校;高等院校", lng: 116.5, lat: 39.9 };
  const r = foldSubUnits(
    [mk("c1", "某大学A系", "科教文化服务;学校;高等院校", "p", 700, 116.41, 39.9), mk("c2", "某大学B系", "科教文化服务;学校;高等院校", "p", 500, 116.405, 39.9)],
    parentsOf(par), center, 1000,
  );
  assert.deepEqual(r.pois.map((p) => [p.name, p.distanceM]), [["某大学", 500]]);
});

test("父级大类不同（写字楼里的诊所）：作为独立设施保留", () => {
  const par: ParentInfo = { id: "b", name: "银泰中心A座", type: "商务住宅;楼宇;商务写字楼", lng: 116.4, lat: 39.9 };
  const r = foldSubUnits([mk("c1", "口腔诊所", "医疗保健服务;专科医院;口腔医院", "b", 10), mk("c2", "医美诊所", "医疗保健服务;专科医院;整形美容", "b", 20)], parentsOf(par), center, 1000);
  assert.equal(r.pois.length, 2);
  assert.equal(r.folded, 0);
});

test("查不到父级详情：保留，不误杀", () => {
  const r = foldSubUnits([mk("c", "某科室", HOSP, "missing", 10)], new Map(), center, 1000);
  assert.equal(r.pois.length, 1);
});

test("parentIdsToResolve 只返回不在结果里的父级，且去重", () => {
  const ids = parentIdsToResolve([mk("p", "a", HOSP, "", 1), mk("c1", "b", HOSP, "p", 2), mk("c2", "c", HOSP, "x", 3), mk("c3", "d", HOSP, "x", 4)]);
  assert.deepEqual(ids, ["x"]);
});

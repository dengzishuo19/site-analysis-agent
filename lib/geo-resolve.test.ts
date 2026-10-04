import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHINA_BBOX,
  mergeCandidates,
  buildCandidates,
  candidatesFromGeocodes,
  classifyGeocode,
  distanceM,
  inChina,
  isMainland,
  MAX_CANDIDATES,
  parseCityHint,
  regionOf,
  topIsNonMainland,
  type Geocode,
  type RawPoi,
} from "./geo-resolve.ts";

// 以下数值来自对高德真实接口的探测
const CITY_CENTER: Geocode = { formatted: "北京市", level: "省", lng: 116.407387, lat: 39.904179, district: "" };
const g = (formatted: string, level: string, lng: number, lat: number, district = ""): Geocode => ({ formatted, level, lng, lat, district });

const kinds = (query: string, list: Geocode[]) => classifyGeocode(query, list).status;

// ===== 你遇到的 bug =====

test("“北京建筑大学”：高德退回城市中心（level=省），但输入不是行政区名 → 让用户选择，而不是直接分析", () => {
  const r = classifyGeocode("北京建筑大学", [CITY_CENTER]);
  assert.equal(r.status, "choose");
  if (r.status === "choose") assert.equal(r.reason, "not-found");
});

test("“北京”“北京市”“朝阳区”“北京市朝阳区”“通州”：裸行政区名 → 拒绝并提示更具体", () => {
  assert.equal(kinds("北京", [CITY_CENTER]), "reject");
  assert.equal(kinds("北京市", [CITY_CENTER]), "reject");
  assert.equal(kinds("  北京  ", [CITY_CENTER]), "reject");
  assert.equal(kinds("朝阳区", [g("北京市朝阳区", "区县", 116.443, 39.921)]), "reject");
  assert.equal(kinds("北京市朝阳区", [g("北京市朝阳区", "区县", 116.443, 39.921)]), "reject");
  assert.equal(kinds("通州", [g("北京市通州区", "区县", 116.656, 39.910)]), "reject");
  const r = classifyGeocode("朝阳区", [g("北京市朝阳区", "区县", 116.443, 39.921)]);
  if (r.status === "reject") assert.match(r.message, /范围太大/);
});

test("同样返回“北京市”，输入不同判断不同：北京 → 拒绝；北京建筑大学 → 选择", () => {
  assert.notEqual(kinds("北京", [CITY_CENTER]), kinds("北京建筑大学", [CITY_CENTER]));
});

// ===== 正常输入不受影响 =====

test("精确定位且只有一个候选 → 直接分析（国贸地铁站、首钢园、清华大学、故宫、北京站）", () => {
  assert.equal(kinds("国贸地铁站", [g("北京市朝阳区国贸地铁站(公交站)", "公交地铁站点", 116.459, 39.908)]), "ok");
  assert.equal(kinds("首钢园", [g("北京市石景山区首钢园", "兴趣点", 116.155, 39.915)]), "ok");
  assert.equal(kinds("清华大学", [g("北京市海淀区清华大学", "兴趣点", 116.327, 40.003)]), "ok");
  assert.equal(kinds("故宫", [g("故宫", "门牌号", 116.397, 39.918)]), "ok");
  assert.equal(kinds("北京站", [g("北京市东城区北京站", "兴趣点", 116.427, 39.903)]), "ok");
  assert.equal(kinds("海淀区中关村大街1号", [g("北京市海淀区中关村大街1号", "门址", 116.31, 39.98)]), "ok");
});

test("直接分析时取第一个候选", () => {
  const first = g("A", "兴趣点", 116.3, 39.99);
  const r = classifyGeocode("A", [first, g("A旁", "兴趣点", 116.3001, 39.9901)]);
  assert.equal(r.status, "ok");
  if (r.status === "ok") assert.equal(r.pick, first);
});

// ===== 多候选：相距远才弹选择 =====

test("多个候选相距很近（同一地点的几个入口）→ 不打扰用户，直接分析", () => {
  const r = classifyGeocode("北京市大兴区亦庄经济技术开发区", [
    g("北京经济技术开发区", "住宅区", 116.5066, 39.7953),
    g("亦庄核心区", "兴趣点", 116.5070, 39.7955),
  ]);
  assert.equal(r.status, "ok");
});

test("多个候选相距超过 300 m（不同的地点）→ 让用户选择", () => {
  const r = classifyGeocode("北京大学", [
    g("北京市海淀区北京大学", "兴趣点", 116.31, 39.99),
    g("北京市海淀区北京大学医学部", "兴趣点", 116.36, 39.98),
  ]);
  assert.equal(r.status, "choose");
  if (r.status === "choose") assert.equal(r.reason, "multiple");
});

test("刚好 300 m 以内不弹、超过才弹（边界）", () => {
  const base = g("X", "兴趣点", 116.3, 40.0);
  const near = g("Y", "兴趣点", 116.3, 40.0 + 250 / 111_320);
  const far = g("Z", "兴趣点", 116.3, 40.0 + 350 / 111_320);
  assert.equal(classifyGeocode("X", [base, near]).status, "ok");
  assert.equal(classifyGeocode("X", [base, far]).status, "choose");
});

// ===== 面与线状对象 =====

test("道路、村庄（中关村）、开发区、乡镇：中心点不能代表一个场地 → 让用户选择具体地点", () => {
  for (const level of ["道路", "村庄", "开发区", "乡镇"]) {
    const r = classifyGeocode("某某", [g("北京市海淀区某某", level, 116.3, 39.98)]);
    assert.equal(r.status, "choose", level);
    if (r.status === "choose") assert.equal(r.reason, "coarse-area");
  }
});

test("没有任何结果 → 拒绝", () => {
  assert.equal(classifyGeocode("asdfgh", []).status, "reject");
});

// ===== 候选整理 =====

const poi = (over: Partial<RawPoi>): RawPoi => ({
  name: "北京建筑大学(西城校区)",
  lng: 116.341397,
  lat: 39.935142,
  district: "西城区",
  address: "展览馆路1号(北京展览馆)",
  type: "科教文化服务;学校;高等院校",
  parent: "",
  province: "北京市",
  ...over,
});

test("上级也在结果里的子点位被过滤：校区本身保留，校内的系、食堂、停车场被过滤", () => {
  const list = buildCandidates([
    poi({ id: "B000A856NT" }),
    poi({ name: "北京建筑大学大兴校区", lng: 116.286394, lat: 39.748291, district: "大兴区", address: "黄村镇永源路15号" }),
    poi({ name: "北京建筑大学(西城校区)建筑系", parent: "B000A856NT" }),
    poi({ name: "北京建筑大学食堂(西城校区店)", parent: "B000A856NT", type: "餐饮服务;中餐厅;中餐厅" }),
    poi({ name: "北京建筑大学停车场", parent: "B000A856NT" }),
    poi({ name: "北京建筑大学招生就业处", parent: "B000A856NT" }),
  ]);
  assert.deepEqual(list.map((c) => c.name), ["北京建筑大学(西城校区)", "北京建筑大学大兴校区"]);
});

test("候选字段：区、省市区、地址、类型（取最后两级）、坐标", () => {
  const [c] = buildCandidates([poi({ city: "北京市" })]);
  assert.deepEqual(c, {
    name: "北京建筑大学(西城校区)",
    district: "西城区",
    region: "北京市 · 西城区",
    address: "展览馆路1号(北京展览馆)",
    type: "学校 · 高等院校",
    lng: 116.341397,
    lat: 39.935142,
  });
});

test("候选去重（同名同坐标）、保持相关度顺序、最多 6 个", () => {
  const many = Array.from({ length: 10 }, (_, i) => poi({ name: `点${i}`, lng: 116.3 + i * 0.001 }));
  const list = buildCandidates([many[0], many[0], ...many.slice(1)]);
  assert.equal(list.length, MAX_CANDIDATES);
  assert.deepEqual(list.map((c) => c.name), ["点0", "点1", "点2", "点3", "点4", "点5"]);
});

test("全国范围：外地点位保留；港澳台与中国范围外的点位被过滤", () => {
  const list = buildCandidates([
    poi({ name: "上海人民广场", lng: 121.475, lat: 31.232, province: "上海市" }),
    poi({ name: "维多利亚港", lng: 114.17, lat: 22.29, province: "香港特别行政区" }),
    poi({ name: "台北101", lng: 121.56, lat: 25.03, province: "台湾省" }),
    poi({ name: "坐标异常", lng: 2.35, lat: 48.85, province: "" }),
    poi({ name: "正常" }),
  ]);
  assert.deepEqual(list.map((c) => c.name), ["上海人民广场", "正常"]);
});

test("没有 province 字段的点位不因此被过滤", () => {
  assert.equal(buildCandidates([poi({ province: undefined })]).length, 1);
});

test("由地理编码的多个命中整理候选：相距近的合并，外地保留，港澳台过滤，带省市区", () => {
  const list = candidatesFromGeocodes([
    g("北京市海淀区北京大学", "兴趣点", 116.31, 39.99, "海淀区"),
    g("北京市海淀区北京大学(东门)", "兴趣点", 116.3101, 39.9901, "海淀区"),
    g("北京市海淀区北京大学医学部", "兴趣点", 116.36, 39.98, "海淀区"),
    { ...g("上海市黄浦区某处", "兴趣点", 121.47, 31.23, "黄浦区"), province: "上海市", city: "上海市" },
    { ...g("香港某处", "兴趣点", 114.17, 22.29, "油尖旺区"), province: "香港特别行政区" },
  ]);
  // 测试数据里北京的命中没有省市字段，名称保持原样；上海的命中去掉了开头重复的省市区
  assert.deepEqual(list.map((c) => c.name), ["北京市海淀区北京大学", "北京市海淀区北京大学医学部", "某处"]);
  assert.equal(list[2].region, "上海市 · 黄浦区");
  assert.equal(list[2].address, "上海市黄浦区某处");
});

test("全国的“范围太大”：只输入省、市、区县名 → 拒绝", () => {
  assert.equal(kinds("上海", [g("上海市", "省", 121.47, 31.23)]), "reject");
  assert.equal(kinds("杭州市西湖区", [g("浙江省杭州市西湖区", "区县", 120.13, 30.26)]), "reject");
  assert.equal(kinds("朝阳区", [g("吉林省长春市朝阳区", "区县", 125.29, 43.83), g("北京市朝阳区", "区县", 116.44, 39.92)]), "reject");
  // 输入不是行政区名、只是没找到具体地点 → 让用户选
  assert.equal(kinds("澳门大三巴", [g("澳门特别行政区", "省", 113.54, 22.19)]), "choose");
});

test("输入开头的城市名：只认空格分隔", () => {
  assert.deepEqual(parseCityHint("上海 人民广场"), { city: "上海", query: "人民广场" });
  assert.deepEqual(parseCityHint("  天津   南京路 "), { city: "天津", query: "南京路" });
  assert.deepEqual(parseCityHint("上海人民广场"), { query: "上海人民广场" });
  assert.deepEqual(parseCityHint("国贸"), { query: "国贸" });
});

test("中国大陆判断、省市区拼接、关键字第一名在港澳台", () => {
  assert.equal(isMainland("上海市"), true);
  assert.equal(isMainland(undefined), true);
  for (const p of ["香港特别行政区", "澳门特别行政区", "台湾省"]) assert.equal(isMainland(p), false, p);
  assert.equal(regionOf("上海市", "上海市", "黄浦区"), "上海市 · 黄浦区");
  assert.equal(regionOf("浙江省", "杭州市", "西湖区"), "浙江省 · 杭州市 · 西湖区");
  assert.equal(topIsNonMainland([poi({ province: "台湾省" }), poi({})]), true);
  assert.equal(topIsNonMainland([poi({}), poi({ province: "台湾省" })]), false);
  assert.equal(topIsNonMainland([]), false);
});

// ===== 基础函数 =====

test("中国范围判断：北京、上海、乌鲁木齐、三亚在内；东京、巴黎在外；非有限数", () => {
  assert.equal(inChina(116.4, 39.9), true);
  assert.equal(inChina(121.47, 31.23), true);
  assert.equal(inChina(87.62, 43.83), true);
  assert.equal(inChina(109.51, 18.25), true);
  assert.equal(inChina(CHINA_BBOX.minLng, CHINA_BBOX.minLat), true);
  assert.equal(inChina(139.69, 35.69), false);
  assert.equal(inChina(2.35, 48.85), false);
  assert.equal(inChina(Number.NaN, 39.9), false);
});

test("两点距离：同点为 0，纬度差 0.001° 约 111 m，对称", () => {
  const a = { lng: 116.3, lat: 40.0 };
  const b = { lng: 116.3, lat: 40.001 };
  assert.equal(distanceM(a, a), 0);
  assert.ok(Math.abs(distanceM(a, b) - 111.2) < 1);
  assert.equal(distanceM(a, b), distanceM(b, a));
  // 西城校区到大兴校区约 20 km
  const d = distanceM({ lng: 116.341397, lat: 39.935142 }, { lng: 116.286394, lat: 39.748291 });
  assert.ok(d > 19_000 && d < 21_500, String(d));
});

test("上级不在结果里的点位保留（如“成都太古里”挂在上级片区下）", () => {
  const list = buildCandidates([
    poi({ id: "A", name: "成都太古里", parent: "B0H3JZ2J4F", province: "四川省", city: "成都市", district: "锦江区", lng: 104.083, lat: 30.654 }),
    poi({ id: "B", name: "太古里东广场", parent: "", province: "四川省", city: "成都市", district: "锦江区", lng: 104.087, lat: 30.656 }),
  ]);
  assert.deepEqual(list.map((c) => c.name), ["成都太古里", "太古里东广场"]);
});

test("合并候选：每个城市最多 2 个，补上其他城市，相近的去重，最多 6 个", () => {
  const c = (name: string, region: string, lng: number, lat: number) => ({ name, district: "", region, address: "", type: "", lng, lat });
  const keyword = [c("中山公园", "广东省 · 中山市", 113.38, 22.52), c("中山湿地公园", "广东省 · 中山市", 113.40, 22.55), c("中山森林公园", "广东省 · 中山市", 113.45, 22.50)];
  const geo = [c("大连中山公园", "辽宁省 · 大连市 · 沙河口区", 121.59, 38.91), c("同一处", "广东省 · 中山市", 113.3801, 22.5201), c("钦州中山公园", "广西壮族自治区 · 钦州市 · 钦南区", 108.62, 21.95)];
  const list = mergeCandidates(keyword, geo);
  assert.deepEqual(list.map((x) => x.name), ["中山公园", "中山湿地公园", "大连中山公园", "钦州中山公园"]);
});

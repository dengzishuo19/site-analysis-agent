import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  FAMILIES,
  FAMILY_ORDER,
  INK,
  SURFACE,
  contrast,
  inkOn,
  paletteCss,
  type Mode,
} from "./palette.ts";
import { buildMapModel, type MapStats, type VizStats } from "./map-model.ts";
import { countRows, distanceRows, type ChartStats } from "./chart-model.ts";
import { escapeHtml, renderBarChart, renderFamilyKey } from "./chart-html.ts";
import { VIZ_CSS } from "./viz-css.ts";
import { fitZoom } from "./site-map.ts";

// 与 lib/stats.ts 的 7 个类别一一对应的测试数据
const KEYS: [string, string][] = [
  ["metro", "地铁站出入口"],
  ["bus", "公交站"],
  ["school", "教育（学校）"],
  ["hospital", "医疗（综合/专科医院）"],
  ["commerce", "商业（购物+餐饮）"],
  ["park", "公园绿地"],
  ["industry", "工业（工厂+产业园区）"],
];

const stats: VizStats = {
  center: { address: "北京市朝阳区国贸地铁站", lng: 116.459242, lat: 39.908658 },
  radius: 1000,
  categories: KEYS.map(([key, label], i) => {
    // 商业封顶 600；工业为 0；其余各给两三个设施
    const items =
      key === "industry"
        ? []
        : Array.from({ length: key === "commerce" ? 10 : 2 + (i % 2) }, (_, j) => ({
            name: `${label}${j + 1}`,
            distanceM: 30 + i * 40 + j * 15,
            lng: 116.459 + i * 0.0005 + j * 0.0002,
            lat: 39.908 + i * 0.0003,
          }));
    return {
      key,
      label,
      count: key === "commerce" ? 600 : key === "industry" ? 0 : 5 + i,
      capped: key === "commerce",
      nearest: items[0] ? { name: items[0].name, distanceM: items[0].distanceM } : null,
      items,
    };
  }),
};

// ===== 色板 =====

test("7 个类别都有类型族与单字，单字互不相同，类型族不超过 4 种", () => {
  for (const [key] of KEYS) assert.ok(CATEGORIES[key], key);
  const glyphs = KEYS.map(([k]) => CATEGORIES[k].glyph);
  assert.equal(new Set(glyphs).size, 7);
  assert.ok(glyphs.every((g) => [...g].length === 1));
  assert.equal(new Set(KEYS.map(([k]) => CATEGORIES[k].family)).size, 4);
  assert.equal(FAMILY_ORDER.length, 4);
});

test("标记上的字色在每个类型族、每种模式下与底色的对比度 ≥ 4.5", () => {
  for (const mode of ["light", "dark"] as Mode[]) {
    for (const family of FAMILY_ORDER) {
      const fill = FAMILIES[family][mode];
      assert.ok(contrast(fill, inkOn(fill)) >= 4.5, `${family} ${mode}: ${contrast(fill, inkOn(fill)).toFixed(2)}`);
    }
  }
});

test("文字墨色对表面的对比度 ≥ 4.5（主文字与次要文字）", () => {
  for (const mode of ["light", "dark"] as Mode[]) {
    assert.ok(contrast(INK[mode].primary, SURFACE[mode]) >= 4.5);
    assert.ok(contrast(INK[mode].secondary, SURFACE[mode]) >= 4.5);
  }
});

test("条形色对表面的对比度：低于 3:1 的只有已记录的浅色洋红与黄（走技能的豁免规则）", () => {
  const below: string[] = [];
  for (const mode of ["light", "dark"] as Mode[]) {
    for (const family of FAMILY_ORDER) {
      if (contrast(FAMILIES[family][mode], SURFACE[mode]) < 3) below.push(`${family}:${mode}`);
    }
  }
  assert.deepEqual(below.sort(), ["industry:light", "services:light"]);
});

test("色板 CSS 包含浅色、深色（系统与手动）三组变量，且颜色与常量一致", () => {
  const css = paletteCss();
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /data-theme="dark"/);
  for (const family of FAMILY_ORDER) {
    assert.ok(css.includes(`--fam-${family}:${FAMILIES[family].light}`));
    assert.ok(css.includes(`--fam-${family}:${FAMILIES[family].dark}`));
    assert.ok(css.includes(`--fam-${family}-ink:`));
  }
  assert.ok(VIZ_CSS.includes(css));
  for (const family of FAMILY_ORDER) assert.ok(VIZ_CSS.includes(`[data-fam="${family}"]`));
});

// ===== 地图模型 =====

test("标记数量等于各类已返回设施总数，且按类别顺序、距离升序排列", () => {
  const model = buildMapModel(stats);
  const expected = stats.categories.reduce((s, c) => s + c.items.length, 0);
  assert.equal(model.markers.length, expected);
  const perCat = new Map<string, number[]>();
  for (const m of model.markers) perCat.set(m.categoryKey, [...(perCat.get(m.categoryKey) ?? []), m.distanceM]);
  for (const list of perCat.values()) assert.deepEqual(list, [...list].sort((a, b) => a - b));
  assert.deepEqual([...new Set(model.markers.map((m) => m.categoryKey))], KEYS.map(([k]) => k).filter((k) => k !== "industry"));
});

test("无设施的类别不产生标记，但仍出现在图例里（标记数为 0）", () => {
  const model = buildMapModel(stats);
  assert.equal(model.markers.filter((m) => m.categoryKey === "industry").length, 0);
  const legend = model.legend.find((l) => l.key === "industry");
  assert.deepEqual([legend?.markers, legend?.count, legend?.glyph], [0, 0, "工"]);
  assert.equal(model.legend.length, 7);
});

test("每个标记的坐标、类型族、单字、信息文字正确", () => {
  const model = buildMapModel(stats);
  const first = model.markers[0];
  const src = stats.categories[0].items[0];
  assert.deepEqual(
    [first.lng, first.lat, first.name, first.distanceM, first.glyph, first.family, first.category],
    [src.lng, src.lat, src.name, src.distanceM, "地", "transit", "地铁站出入口"],
  );
});

test("圆的中心与半径取自统计数据；图例的类型族名称正确", () => {
  const model = buildMapModel(stats);
  assert.deepEqual([model.center.lng, model.center.lat, model.radius], [116.459242, 39.908658, 1000]);
  assert.deepEqual(model.legend.find((l) => l.key === "school")?.familyLabel, "生活服务");
  assert.equal(model.legend.find((l) => l.key === "commerce")?.capped, true);
});

test("无效坐标与未知类别被跳过，不会抛出异常", () => {
  const bad: MapStats = {
    ...stats,
    categories: [
      { ...stats.categories[0], items: [{ name: "坏点", distanceM: 1, lng: Number.NaN, lat: 40 }, { name: "越界", distanceM: 2, lng: 200, lat: 40 }, stats.categories[0].items[0]] },
      { key: "mystery", label: "未知", count: 1, capped: false, items: [{ name: "x", distanceM: 1, lng: 116, lat: 39 }] },
    ],
  };
  const model = buildMapModel(bad);
  assert.equal(model.markers.length, 1);
  assert.equal(model.legend.length, 1);
});

test("同一输入产生相同输出（确定性）", () => {
  assert.deepEqual(buildMapModel(stats), buildMapModel(structuredClone(stats)));
});

// ===== 地图取景 =====

test("取景缩放：420 像素高、半径 1 km 时约为 14.4（与浏览器实测一致）", () => {
  const z = fitZoom(420, 1000, 39.908658);
  assert.ok(z > 14.3 && z < 14.5, String(z));
});

test("取景缩放：容器越大缩放越大，半径越大缩放越小，纬度越高缩放越小（同样的距离占更多像素）；极小容器被限制", () => {
  assert.ok(fitZoom(600, 1000, 40) > fitZoom(300, 1000, 40));
  assert.ok(fitZoom(400, 2000, 40) < fitZoom(400, 1000, 40));
  assert.ok(fitZoom(400, 1000, 60) < fitZoom(400, 1000, 30));
  assert.equal(fitZoom(10, 1000, 40), fitZoom(0, 1000, 40));
  assert.ok(Number.isFinite(fitZoom(0, 1000, 40)));
});

// ===== 图表模型 =====

test("数量条形图：封顶类别显示“≥”并渐隐、按最大值定长；零值不画条", () => {
  const rows = countRows(stats);
  assert.equal(rows.length, 7);
  const commerce = rows.find((r) => r.key === "commerce")!;
  assert.deepEqual([commerce.valueText, commerce.pct, commerce.faded, commerce.empty], ["≥600", 100, true, false]);
  const industry = rows.find((r) => r.key === "industry")!;
  assert.deepEqual([industry.valueText, industry.pct, industry.empty, industry.tip], ["0", 0, true, "工业（工厂+产业园区）：范围内未检索到"]);
  const metro = rows.find((r) => r.key === "metro")!;
  assert.deepEqual([metro.valueText, metro.pct, metro.faded], ["5", 0.8, false]);
});

test("数量条形图：全部为 0 时不出现除零错误", () => {
  const zero: ChartStats = { radius: 1000, categories: stats.categories.map((c) => ({ ...c, count: 0, capped: false })) };
  for (const r of countRows(zero)) assert.deepEqual([r.pct, r.empty], [0, true]);
});

test("距离条形图：相对检索半径定长；无设施显示“—”", () => {
  const rows = distanceRows(stats);
  const metro = rows.find((r) => r.key === "metro")!;
  assert.deepEqual([metro.valueText, metro.pct], ["30 m", 3]);
  const industry = rows.find((r) => r.key === "industry")!;
  assert.deepEqual([industry.valueText, industry.pct, industry.empty], ["—", 0, true]);
  assert.ok(rows.every((r) => r.pct >= 0 && r.pct <= 100));
});

test("距离超出半径时条形长度被限制在 100", () => {
  const far: ChartStats = { radius: 1000, categories: [{ key: "bus", label: "公交站", count: 1, capped: false, nearest: { name: "远", distanceM: 5000 } }] };
  assert.equal(distanceRows(far)[0].pct, 100);
});

test("图表行的顺序与类别顺序一致，未知类别被跳过", () => {
  const withUnknown: ChartStats = { ...stats, categories: [...stats.categories, { key: "zzz", label: "未知", count: 1, capped: false, nearest: null }] };
  assert.deepEqual(countRows(withUnknown).map((r) => r.key), KEYS.map(([k]) => k));
  assert.deepEqual(distanceRows(withUnknown).map((r) => r.key), KEYS.map(([k]) => k));
});

test("图表数字与统计表逐格一致", () => {
  const rows = countRows(stats);
  stats.categories.forEach((c, i) => assert.equal(rows[i].valueText, c.capped ? `≥${c.count}` : String(c.count)));
  const drows = distanceRows(stats);
  stats.categories.forEach((c, i) => assert.equal(drows[i].valueText, c.nearest ? `${c.nearest.distanceM} m` : "—"));
});

// ===== HTML 渲染 =====

test("HTML 渲染会转义设施名，防止注入", () => {
  const evil: ChartStats = {
    radius: 1000,
    categories: [{ key: "bus", label: "公交站", count: 1, capped: false, nearest: { name: '<img src=x onerror="alert(1)">', distanceM: 5 } }],
  };
  const html = renderBarChart({ title: "距离", rows: distanceRows(evil) });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  assert.equal(escapeHtml(`a&b<c>"d'`), "a&amp;b&lt;c&gt;&quot;d&#39;");
});

test("条形图的每一行都可聚焦，带提示与无障碍说明，并标出类型族", () => {
  const html = renderBarChart({ title: "各类设施数量", note: "说明", rows: countRows(stats) });
  assert.equal((html.match(/<li class="viz-row/g) ?? []).length, 7);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 7);
  assert.equal((html.match(/role="tooltip"/g) ?? []).length, 7);
  assert.ok(html.includes('data-fam="transit"') && html.includes('data-fam="industry"'));
  assert.ok(html.includes("≥600") && html.includes("is-faded") && html.includes("is-empty"));
  assert.ok(html.includes("说明"));
});

test("类型族说明列出全部类型族及其单字", () => {
  const html = renderFamilyKey();
  for (const family of FAMILY_ORDER) assert.ok(html.includes(FAMILIES[family].label));
  assert.ok(html.includes("地 公") && html.includes("教 医 商") && html.includes("园") && html.includes("工"));
});

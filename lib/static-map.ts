// 高德静态地图参数：用于生成演示页的兜底截图（本地脚本调用），纯函数，便于单测
import { FAMILIES } from "./palette.ts";
import type { MapModel } from "./map-model.ts";

export const MAX_STATIC_MARKERS = 45; // 高德静态地图的标记上限为 50，留出中心点与余量
export const DEFAULT_PER_CATEGORY = 6; // 每类标出最近的几个设施

export type StaticMapParams = {
  location: string;
  zoom: number;
  size: string;
  markers: string;
  paths: string;
  markerCount: number; // 设施标记数（不含中心点）
};

// 保留 6 位小数的坐标串
function pt(lng: number, lat: number): string {
  return `${lng.toFixed(6)},${lat.toFixed(6)}`;
}

// 以圆心和半径生成圆的多边形近似（等距圆柱近似，半径 1 km 量级下误差可忽略）
export function circlePoints(lng: number, lat: number, radiusM: number, n = 48): [number, number][] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (2 * Math.PI * (i % n)) / n;
    return [lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)];
  });
}

// 生成静态地图的请求参数：中心标记、按类型族着色并带类别单字的设施标记、半径圆
export function buildStaticMapParams(
  model: MapModel,
  opts: { size?: [number, number]; zoom?: number; perCategory?: number } = {},
): StaticMapParams {
  const [w, h] = opts.size ?? [1000, 640]; // 缩放级别 14 时半径 1 km 的圆直径约 550 像素，高度留足边距
  const perCategory = opts.perCategory ?? DEFAULT_PER_CATEGORY;

  // 每类只取最近的若干个，并限制总数
  const taken = new Map<string, number>();
  const chosen = model.markers.filter((m) => {
    const n = taken.get(m.categoryKey) ?? 0;
    if (n >= perCategory) return false;
    taken.set(m.categoryKey, n + 1);
    return true;
  });
  const capped = chosen.slice(0, MAX_STATIC_MARKERS);

  // 按“类型族 + 单字”分组，每组一个 markers 段
  const groups = new Map<string, { color: string; glyph: string; points: string[] }>();
  for (const m of capped) {
    const k = `${m.family}|${m.glyph}`;
    const g = groups.get(k) ?? { color: FAMILIES[m.family].light.replace("#", "0x"), glyph: m.glyph, points: [] };
    g.points.push(pt(m.lng, m.lat));
    groups.set(k, g);
  }
  const markerSegments = [...groups.values()].map((g) => `mid,${g.color},${g.glyph}:${g.points.join(";")}`);
  markerSegments.push(`mid,0x0b0b0b,中:${pt(model.center.lng, model.center.lat)}`);

  const ring = circlePoints(model.center.lng, model.center.lat, model.radius).map(([x, y]) => pt(x, y));

  return {
    location: pt(model.center.lng, model.center.lat),
    zoom: opts.zoom ?? 14,
    size: `${w}*${h}`,
    markers: markerSegments.join("|"),
    paths: `2,0x0b0b0b,0.8,0x0b0b0b,0.06:${ring.join(";")}`,
    markerCount: capped.length,
  };
}

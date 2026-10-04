// 地图标记聚合：相距很近的标记合并为一个“簇”，随缩放重新计算。纯函数，不依赖高德插件，便于单测。
import type { MapMarker } from "./map-model.ts";

export const CLUSTER_RADIUS_PX = 30; // 两个符号圆心相距小于这个像素数就合并（标记直径 26 px）
export const CLUSTER_MAX_ZOOM = 18; // 缩放到这一级及以上不再聚合，每个点单独显示

export type Cluster = {
  lng: number;
  lat: number;
  members: MapMarker[];
  categories: string[]; // 簇内的类别 key，按成员数从多到少
};

// 经纬度 → Web 墨卡托世界像素坐标（256 像素瓦片）；与高德地图的投影一致
export function worldPx(lng: number, lat: number, zoom: number): [number, number] {
  const size = 256 * 2 ** zoom;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size];
}

// 贪心聚合：按输入顺序，标记离某个已有簇的中心小于 radiusPx 就并入（簇中心取成员像素坐标的平均），否则新开一簇。
// hidden 中的类别不参与；zoom ≥ maxZoom 时不聚合。
export function clusterMarkers(
  markers: MapMarker[],
  zoom: number,
  opts: { radiusPx?: number; maxZoom?: number; hidden?: Set<string> } = {},
): Cluster[] {
  const radius = opts.radiusPx ?? CLUSTER_RADIUS_PX;
  const maxZoom = opts.maxZoom ?? CLUSTER_MAX_ZOOM;
  const visible = markers.filter((m) => !opts.hidden?.has(m.categoryKey) && Number.isFinite(m.lng) && Number.isFinite(m.lat));

  const groups: { x: number; y: number; members: MapMarker[] }[] = [];
  for (const m of visible) {
    const [x, y] = worldPx(m.lng, m.lat, zoom);
    const g = zoom >= maxZoom ? undefined : groups.find((c) => Math.hypot(c.x - x, c.y - y) < radius);
    if (g) {
      const n = g.members.length;
      g.x = (g.x * n + x) / (n + 1);
      g.y = (g.y * n + y) / (n + 1);
      g.members.push(m);
    } else {
      groups.push({ x, y, members: [m] });
    }
  }

  return groups.map((g) => {
    const counts = new Map<string, number>();
    for (const m of g.members) counts.set(m.categoryKey, (counts.get(m.categoryKey) ?? 0) + 1);
    return {
      lng: g.members.reduce((a, m) => a + m.lng, 0) / g.members.length,
      lat: g.members.reduce((a, m) => a + m.lat, 0) / g.members.length,
      members: g.members,
      categories: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k),
    };
  });
}

// 量化遮挡：圆心距离小于 diameterPx 的符号数（用于验收与回归测试）
export function countOverlaps(points: { lng: number; lat: number }[], zoom: number, diameterPx = 26): number {
  const p = points.map((q) => worldPx(q.lng, q.lat, zoom));
  return p.filter((a, i) => p.some((b, j) => j !== i && Math.hypot(a[0] - b[0], a[1] - b[1]) < diameterPx)).length;
}

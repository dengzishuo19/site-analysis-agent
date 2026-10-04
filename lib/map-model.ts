// 地图数据模型：把统计数据转成“标记列表 + 圆参数 + 图例”，纯函数，便于单测
import { CATEGORIES, FAMILIES, type FamilyKey } from "./palette.ts";

// 生成地图所需的最小统计数据结构（与 SiteStats 兼容）
export type MapStats = {
  center: { address: string; lng: number; lat: number };
  radius: number;
  categories: {
    key: string;
    label: string;
    count: number;
    capped: boolean;
    items: { name: string; distanceM: number; lng: number; lat: number }[];
  }[];
};

// 地图与图表共用的完整统计数据结构（同时满足 MapStats 与 ChartStats）
export type VizStats = {
  center: { address: string; lng: number; lat: number };
  radius: number;
  categories: {
    key: string;
    label: string;
    count: number;
    capped: boolean;
    nearest: { name: string; distanceM: number } | null;
    items: { name: string; distanceM: number; lng: number; lat: number }[];
  }[];
};

export type MapMarker = {
  categoryKey: string;
  category: string;
  glyph: string;
  family: FamilyKey;
  name: string;
  distanceM: number;
  lng: number;
  lat: number;
};

export type LegendItem = {
  key: string;
  label: string;
  glyph: string;
  family: FamilyKey;
  familyLabel: string;
  short: string; // 窄屏图例用的短名
  markers: number; // 地图上实际标出的设施数
  count: number; // 高德返回的该类总数
  capped: boolean;
};

export type MapModel = {
  center: { address: string; lng: number; lat: number };
  radius: number;
  markers: MapMarker[];
  legend: LegendItem[];
};

// 判断经纬度是否有效
function validPoint(lng: number, lat: number): boolean {
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
}

// 构建地图模型：每类的已返回设施各一个标记；未知类别与无效坐标被跳过；图例始终包含全部已知类别
export function buildMapModel(stats: MapStats): MapModel {
  const markers: MapMarker[] = [];
  const legend: LegendItem[] = [];

  for (const cat of stats.categories) {
    const style = CATEGORIES[cat.key];
    if (!style) continue;

    let placed = 0;
    for (const item of [...cat.items].sort((a, b) => a.distanceM - b.distanceM)) {
      if (!validPoint(item.lng, item.lat)) continue;
      markers.push({
        categoryKey: cat.key,
        category: cat.label,
        glyph: style.glyph,
        family: style.family,
        name: item.name,
        distanceM: item.distanceM,
        lng: item.lng,
        lat: item.lat,
      });
      placed++;
    }
    legend.push({
      key: cat.key,
      label: cat.label,
      glyph: style.glyph,
      short: style.short,
      family: style.family,
      familyLabel: FAMILIES[style.family].label,
      markers: placed,
      count: cat.count,
      capped: cat.capped,
    });
  }

  return { center: stats.center, radius: stats.radius, markers, legend };
}

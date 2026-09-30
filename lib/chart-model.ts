// 条形图数据模型：把统计数据转成图表的行，纯函数，便于单测
import { CATEGORIES, FAMILIES, type FamilyKey } from "./palette.ts";

// 生成图表所需的最小统计数据结构（与 SiteStats 兼容）
export type ChartStats = {
  radius: number;
  categories: {
    key: string;
    label: string;
    count: number;
    capped: boolean;
    nearest: { name: string; distanceM: number } | null;
  }[];
};

export type BarRow = {
  key: string;
  label: string;
  glyph: string;
  family: FamilyKey;
  familyLabel: string;
  valueText: string; // 行尾显示的文字
  pct: number; // 条形长度，0 到 100
  faded: boolean; // 数值被封顶，条形末端渐隐
  empty: boolean; // 无数据，不画条
  tip: string; // 悬停提示与无障碍说明
};

// 四舍五入到一位小数
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 各类设施数量：条形长度相对最大数量；封顶类别显示“≥”并渐隐；数量为 0 不画条
export function countRows(stats: ChartStats): BarRow[] {
  const known = stats.categories.filter((c) => CATEGORIES[c.key]);
  const max = Math.max(1, ...known.map((c) => c.count));
  return known.map((c) => {
    const style = CATEGORIES[c.key];
    return {
      key: c.key,
      label: c.label,
      glyph: style.glyph,
      family: style.family,
      familyLabel: FAMILIES[style.family].label,
      valueText: c.capped ? `≥${c.count}` : String(c.count),
      pct: round1((c.count / max) * 100),
      faded: c.capped,
      empty: c.count === 0,
      tip: c.count === 0 ? `${c.label}：范围内未检索到` : `${c.label}：${c.capped ? "不少于 " : ""}${c.count} 处`,
    };
  });
}

// 最近设施距离：条形长度相对检索半径，越短越近；无设施显示“—”
export function distanceRows(stats: ChartStats): BarRow[] {
  return stats.categories
    .filter((c) => CATEGORIES[c.key])
    .map((c) => {
      const style = CATEGORIES[c.key];
      const near = c.nearest;
      return {
        key: c.key,
        label: c.label,
        glyph: style.glyph,
        family: style.family,
        familyLabel: FAMILIES[style.family].label,
        valueText: near ? `${near.distanceM} m` : "—",
        pct: near ? round1(Math.min(100, Math.max(0, (near.distanceM / stats.radius) * 100))) : 0,
        faded: false,
        empty: !near,
        tip: near ? `${c.label}：最近为 ${near.name}，${near.distanceM} m` : `${c.label}：范围内未检索到`,
      };
    });
}

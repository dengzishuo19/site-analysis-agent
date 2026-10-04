// 按使用者勾选的子类型重算统计：只用已签名数据里的点位池，不访问高德。纯函数；验签与重新签名由接口层负责。
import type { SiteStats } from "./stats.ts";
import { applySelection, validSelection } from "./subtype.ts";

const TOP_N = 10; // 与 stats.ts 的 TOP_N 一致：每类保留最近的条数

export type Selection = Record<string, unknown>; // 类别 key → 勾选的子类型数组

export type RefineResult = { ok: true; stats: SiteStats } | { ok: false; error: string };

export function refineStats(stats: SiteStats, selection: Selection): RefineResult {
  if (!selection || typeof selection !== "object" || Array.isArray(selection) || !Object.keys(selection).length) {
    return { ok: false, error: "缺少有效的勾选" };
  }
  const keys = Object.keys(selection);
  for (const key of keys) {
    const cat = stats.categories.find((c) => c.key === key);
    if (!cat?.pool || !cat.base) return { ok: false, error: `类别“${key}”不支持子类型勾选` };
    if (!validSelection(key, selection[key])) return { ok: false, error: `类别“${key}”的勾选无效：至少选一项，且只能选已知的子类型` };
  }
  const categories = stats.categories.map((cat) => {
    if (!keys.includes(cat.key) || !cat.pool || !cat.base) return cat;
    const selected = selection[cat.key] as string[];
    const r = applySelection(cat.key, cat.pool, selected, cat.base, cat.poolTruncated ?? false, TOP_N);
    return { ...cat, count: r.count, capped: r.capped, items: r.items, nearest: r.items[0] ?? null, selected };
  });
  return { ok: true, stats: { ...stats, categories } };
}

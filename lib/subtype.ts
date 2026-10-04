// 子类型：把教育、医疗、工业三类按高德类型（必要时结合名称）再细分；以及按使用者的勾选重算统计。纯函数。
import { typePart } from "./poi-rules.ts";

export const SUBTYPES: Record<string, string[]> = {
  school: ["大学", "中学", "小学", "幼儿园", "职业学校", "其他"],
  hospital: ["综合医院", "社区卫生服务", "口腔", "医疗美容", "眼科", "其他专科"],
  industry: ["产业园区", "工厂", "其他"],
};

export function hasSubtypes(category: string): boolean {
  return category in SUBTYPES;
}

// 高德“学校”这个泛类分不出小学还是中学，按名称再判断（顺序有意义：先小的后大的）
function schoolByName(name: string): string {
  if (/(幼儿园|幼稚园|托儿所|托育)/.test(name)) return "幼儿园";
  if (/小学/.test(name)) return "小学";
  if (/(中学|高中|初中|附中)/.test(name)) return "中学";
  if (/职业/.test(name)) return "职业学校";
  if (/(大学|学院)/.test(name)) return "大学";
  return "其他";
}

export function subtypeOf(category: string, type: string, name: string): string {
  const third = typePart(type, 2);
  if (category === "school") {
    const map: Record<string, string> = { 高等院校: "大学", 中学: "中学", 小学: "小学", 幼儿园: "幼儿园", 职业技术学校: "职业学校" };
    return map[third] ?? schoolByName(name);
  }
  if (category === "hospital") {
    if (third === "综合医院" || third === "三级甲等医院") return "综合医院";
    if (third === "卫生院") return "社区卫生服务";
    if (third === "口腔医院") return "口腔";
    if (third === "整形美容") return "医疗美容";
    if (third === "眼科医院") return "眼科";
    return "其他专科";
  }
  if (category === "industry") {
    const thirds = type.split("|").map((t) => t.split(";")[2] ?? "");
    if (thirds.includes("产业园区")) return "产业园区";
    if (thirds.includes("工厂")) return "工厂";
    return /(园区|产业园|科技园|创新|孵化|基地)/.test(name) ? "产业园区" : "其他";
  }
  return "";
}

export type PoolPoi = { name: string; distanceM: number; lng: number; lat: number; sub: string };
export type SubtypeCount = { name: string; count: number };

// 子类型分布（按 SUBTYPES 的顺序，数量为 0 的也保留，便于界面稳定）
export function countSubtypes(category: string, pool: PoolPoi[]): SubtypeCount[] {
  return (SUBTYPES[category] ?? []).map((name) => ({ name, count: pool.filter((p) => p.sub === name).length }));
}

// 勾选是否合法：必须是该类别已知的子类型，且至少选一个
export function validSelection(category: string, selected: unknown): selected is string[] {
  const known = SUBTYPES[category];
  return (
    !!known &&
    Array.isArray(selected) &&
    selected.length > 0 &&
    selected.every((s) => typeof s === "string" && known.includes(s)) &&
    new Set(selected).size === selected.length
  );
}

export function isFullSelection(category: string, selected: string[]): boolean {
  return (SUBTYPES[category] ?? []).every((s) => selected.includes(s));
}

// 按勾选重算：全选时沿用默认口径的数量（保证与未勾选时一致）；部分勾选时数量取点位池中符合的个数，池不完整则标“至少”
export function applySelection(
  category: string,
  pool: PoolPoi[],
  selected: string[],
  base: { count: number; capped: boolean },
  poolTruncated: boolean,
  topN: number,
): { count: number; capped: boolean; items: { name: string; distanceM: number; lng: number; lat: number }[] } {
  const strip = ({ name, distanceM, lng, lat }: PoolPoi) => ({ name, distanceM, lng, lat });
  const sorted = [...pool].sort((a, b) => a.distanceM - b.distanceM);
  if (isFullSelection(category, selected)) {
    return { count: base.count, capped: base.capped, items: sorted.slice(0, topN).map(strip) };
  }
  const chosen = sorted.filter((p) => selected.includes(p.sub));
  return { count: chosen.length, capped: poolTruncated, items: chosen.slice(0, topN).map(strip) };
}

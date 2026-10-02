// 噪点过滤的度量：把过滤规则跑在人工标注的测试集（docs/testset/labels.json）上，数出误杀与漏网
// 标签：K 保留（独立设施）/ S 内部子单元 / M 类别归错；误杀 = K 被去除，漏网 = S 或 M 被保留
import { foldSubUnits, type AroundPoi, type ParentInfo } from "./poi-filter.ts";

export type LabeledPoi = {
  i: number;
  id: string;
  name: string;
  type: string;
  parentId: string;
  lng: number;
  lat: number;
  distanceM: number;
  label: "K" | "S" | "M";
};

export type LabeledGroup = {
  site: string;
  siteName: string;
  category: string;
  center: { lng: number; lat: number };
  parents: Record<string, { name: string; type: string; lng: number; lat: number }>;
  pois: LabeledPoi[];
};

// 一个过滤规则：给定一组点位，返回以自身身份保留下来的点位 id
export type FilterRule = (pois: AroundPoi[], group: LabeledGroup) => Set<string>;

export type Metrics = {
  total: number;
  keep: number; // 标注为保留的数量
  remove: number; // 标注为应去除的数量（S + M）
  killed: LabeledPoi[]; // 误杀
  missed: LabeledPoi[]; // 漏网
  killRate: number;
  missRate: number;
};

// 当前线上规则：按 parent 折叠子点位
export const currentRule: FilterRule = (pois, g) => {
  const parents = new Map<string, ParentInfo>(Object.entries(g.parents).map(([id, p]) => [id, { id, ...p }]));
  return foldSubUnits(pois, parents, g.center, 1000).keptIds;
};

function toAround(r: LabeledPoi): AroundPoi {
  return { id: r.id, name: r.name, type: r.type, parent: r.parentId, distanceM: r.distanceM, lng: r.lng, lat: r.lat };
}

export function evaluate(groups: LabeledGroup[], rule: FilterRule = currentRule): Metrics {
  const killed: LabeledPoi[] = [];
  const missed: LabeledPoi[] = [];
  let keep = 0;
  let remove = 0;
  let total = 0;
  for (const g of groups) {
    const kept = rule(g.pois.map(toAround), g);
    for (const r of g.pois) {
      total++;
      if (r.label === "K") {
        keep++;
        if (!kept.has(r.id)) killed.push(r);
      } else {
        remove++;
        if (kept.has(r.id)) missed.push(r);
      }
    }
  }
  return { total, keep, remove, killed, missed, killRate: keep ? killed.length / keep : 0, missRate: remove ? missed.length / remove : 0 };
}

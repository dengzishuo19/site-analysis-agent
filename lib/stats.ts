// 场地周边设施统计：全部由代码计算，不调用大模型
import { geocode, getPoiDetails, searchAroundRaw, type Poi } from "@/lib/amap";
import { foldSubUnits, parentIdsToResolve } from "@/lib/poi-filter";

// ===== 可调参数 =====
export const RADIUS_M = 1000; // 检索半径（米）
export const TOP_N = 10; // 每类保留最近的条数
export const TOP_N_METRO = 60; // 地铁不截断到 10 条：同一车站的出入口很多，地图上要全部标出（周边搜索最多取 75 条）
export const COUNT_CAP = 600; // 高德返回的总数在约 600 处封顶，达到则标注为“至少”

// 类别与高德 POI 分类编码（已用真实接口核实；多个编码用 | 连接）
export const CATEGORIES = [
  { key: "metro", label: "地铁站出入口", types: "150500", fold: false }, // 出入口本身就是统计单位
  { key: "bus", label: "公交站", types: "150700", fold: false },
  { key: "school", label: "教育（学校）", types: "141200", fold: true }, // 折叠校内院系、部门
  { key: "hospital", label: "医疗（综合/专科医院）", types: "090100|090200", fold: true }, // 折叠院内科室
  { key: "commerce", label: "商业（购物+餐饮）", types: "060000|050000", fold: false }, // 商场内的店铺是独立设施
  { key: "park", label: "公园绿地", types: "110100", fold: false },
  { key: "industry", label: "工业（工厂+产业园区）", types: "170300|120100", fold: true }, // 折叠园区内的楼栋
] as const;

export type CategoryStat = {
  key: string;
  label: string;
  count: number;
  capped: boolean; // true 表示实际数量可能大于 count
  nearest: Poi | null;
  items: Poi[];
  folded: number; // 被折叠的校内/院内子点位数量（已从 count 与 items 中剔除）
};

export type SiteStats = {
  center: { address: string; lng: number; lat: number };
  radius: number;
  categories: CategoryStat[];
  generatedAt: string;
  source: string;
};

// 检索一个类别并折叠噪点。
// 只取前几页：若没取完且确实折叠过，过滤后的数量只是下限（capped）；没折叠过则沿用高德给的总数
async function searchCategory(center: { lng: number; lat: number }, types: string, fold: boolean, topN: number) {
  const { total, pois: raw, exhausted } = await searchAroundRaw(center, types, RADIUS_M);
  const parentIds = fold ? parentIdsToResolve(raw) : [];
  const parents = new Map((parentIds.length ? await getPoiDetails(parentIds) : []).map((p) => [p.id, p]));
  const { pois, folded } = fold
    ? foldSubUnits(raw, parents, center, RADIUS_M)
    : { pois: raw.map(({ name, distanceM, lng, lat }) => ({ name, distanceM, lng, lat })), folded: 0 };
  const truncated = !exhausted;
  return {
    count: truncated && folded === 0 ? total : pois.length,
    pois: pois.slice(0, topN),
    folded: { count: folded, truncated },
  };
}

// 对一个已定位的中心点做周边设施统计（各类别依次请求，避免触发频率限制）
export async function analyzeCenter(center: { address: string; lng: number; lat: number }): Promise<SiteStats> {
  const categories: CategoryStat[] = [];
  for (const cat of CATEGORIES) {
    const { count, pois, folded } = await searchCategory(center, cat.types, cat.fold, cat.key === "metro" ? TOP_N_METRO : TOP_N);
    categories.push({
      key: cat.key,
      label: cat.label,
      count,
      capped: count >= COUNT_CAP || (folded.truncated && folded.count > 0),
      nearest: pois[0] ?? null,
      items: pois,
      folded: folded.count,
    });
    await new Promise((r) => setTimeout(r, 350));
  }

  return {
    center,
    radius: RADIUS_M,
    categories,
    generatedAt: new Date().toISOString(),
    source: "高德开放平台",
  };
}

// 对一个地址做周边设施统计（直接地理编码，不判断定位精度；接口层使用 analyzeCenter）
export async function analyzeSite(address: string): Promise<SiteStats> {
  return analyzeCenter(await geocode(address));
}

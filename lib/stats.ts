// 场地周边设施统计：全部由代码计算，不调用大模型
import { AROUND_MAX_PAGES, AROUND_MAX_PAGES_LIMIT, geocode, getPoiDetails, searchAroundRaw, type Poi } from "@/lib/amap";
import { filterPois, parentIdsToResolve } from "@/lib/poi-filter";
import { SUBTYPES, countSubtypes, hasSubtypes, subtypeOf, type PoolPoi, type SubtypeCount } from "@/lib/subtype";

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
  folded: number; // 被过滤的点位数量：校内/院内子点位与类别归错的点位（已从 count 与 items 中剔除）
  // 以下仅教育、医疗、工业有：子类型分解与使用者的勾选口径（count/items/nearest 反映当前勾选）
  pool?: PoolPoi[]; // 过滤后取到的全部点位（最多 75 条），带子类型；重算勾选口径只用它，不再访问高德
  poolTruncated?: boolean; // 点位池是否不完整（高德返回的点位多于取到的）
  subtypes?: SubtypeCount[]; // 子类型分布（按点位池计）
  selected?: string[]; // 当前勾选的子类型；默认全选
  base?: { count: number; capped: boolean }; // 默认口径（全选）下的数量，全选时沿用
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
async function searchCategory(center: { lng: number; lat: number }, cat: { key: string; types: string; fold: boolean }) {
  // 需要折叠的类别取到高德的上限（200 条）：大校园的校内点位可多达一两百个，只取 75 条时折叠后几乎不剩（武汉大学曾显示“≥2”）
  const { total, pois: raw, exhausted } = await searchAroundRaw(center, cat.types, RADIUS_M, cat.fold ? AROUND_MAX_PAGES_LIMIT : AROUND_MAX_PAGES);
  const parentIds = cat.fold ? parentIdsToResolve(raw) : [];
  const parents = new Map((parentIds.length ? await getPoiDetails(parentIds) : []).map((p) => [p.id, p]));
  const { pois, folded } = cat.fold
    ? (({ pois, folded, removed }) => ({ pois, folded: folded + removed }))(filterPois(raw, parents, center, RADIUS_M, cat.key))
    : { pois: raw.map(({ name, distanceM, lng, lat, type }) => ({ name, distanceM, lng, lat, type })).sort((a, b) => a.distanceM - b.distanceM), folded: 0 };
  const truncated = !exhausted;
  return {
    count: truncated && folded === 0 ? total : pois.length,
    pois, // 过滤后的全部点位（含 type，供划分子类型）；截取前 N 条由调用方负责
    folded: { count: folded, truncated },
  };
}

const plain = ({ name, distanceM, lng, lat }: Poi) => ({ name, distanceM, lng, lat });

// 对一个已定位的中心点做周边设施统计（各类别依次请求，避免触发频率限制）
export async function analyzeCenter(center: { address: string; lng: number; lat: number }): Promise<SiteStats> {
  const categories: CategoryStat[] = [];
  for (const cat of CATEGORIES) {
    const { count, pois, folded } = await searchCategory(center, cat);
    const topN = cat.key === "metro" ? TOP_N_METRO : TOP_N;
    const capped = count >= COUNT_CAP || (folded.truncated && folded.count > 0);
    const stat: CategoryStat = {
      key: cat.key,
      label: cat.label,
      count,
      capped,
      nearest: pois[0] ? plain(pois[0]) : null,
      items: pois.slice(0, topN).map(plain),
      folded: folded.count,
    };
    if (hasSubtypes(cat.key)) {
      const pool: PoolPoi[] = pois.map((p) => ({ ...plain(p), sub: subtypeOf(cat.key, p.type, p.name) }));
      stat.pool = pool;
      stat.poolTruncated = folded.truncated;
      stat.subtypes = countSubtypes(cat.key, pool);
      stat.selected = [...SUBTYPES[cat.key]];
      stat.base = { count, capped };
    }
    categories.push(stat);
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

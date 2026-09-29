// 场地周边设施统计：全部由代码计算，不调用大模型
import { geocode, searchAround, type Poi } from "@/lib/amap";

// ===== 可调参数 =====
export const RADIUS_M = 1000; // 检索半径（米）
export const TOP_N = 10; // 每类保留最近的条数
export const COUNT_CAP = 600; // 高德返回的总数在约 600 处封顶，达到则标注为“至少”

// 类别与高德 POI 分类编码（已用真实接口核实；多个编码用 | 连接）
export const CATEGORIES = [
  { key: "metro", label: "地铁站出入口", types: "150500" },
  { key: "bus", label: "公交站", types: "150700" },
  { key: "school", label: "教育（学校）", types: "141200" },
  { key: "hospital", label: "医疗（综合/专科医院）", types: "090100|090200" },
  { key: "commerce", label: "商业（购物+餐饮）", types: "060000|050000" },
  { key: "park", label: "公园绿地", types: "110100" },
  { key: "industry", label: "工业（工厂+产业园区）", types: "170300|120100" },
] as const;

export type CategoryStat = {
  key: string;
  label: string;
  count: number;
  capped: boolean; // true 表示实际数量可能大于 count
  nearest: Poi | null;
  items: Poi[];
};

export type SiteStats = {
  center: { address: string; lng: number; lat: number };
  radius: number;
  categories: CategoryStat[];
  generatedAt: string;
  source: string;
};

// 对一个地址做周边设施统计（各类别依次请求，避免触发频率限制）
export async function analyzeSite(address: string): Promise<SiteStats> {
  const center = await geocode(address);

  const categories: CategoryStat[] = [];
  for (const cat of CATEGORIES) {
    const { count, pois } = await searchAround(center, cat.types, RADIUS_M, TOP_N);
    categories.push({
      key: cat.key,
      label: cat.label,
      count,
      capped: count >= COUNT_CAP,
      nearest: pois[0] ?? null,
      items: pois,
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

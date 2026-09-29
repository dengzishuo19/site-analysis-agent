// 简报数字校验：纯函数，不依赖任何项目模块，由代码（而非大模型）裁决数字是否合规

// 校验所需的最小数据结构（与 SiteStats 兼容）
export type VerifiableStats = {
  center: { lng: number; lat: number };
  radius: number;
  categories: {
    count: number;
    nearest: { distanceM: number } | null;
    items: { distanceM: number }[];
  }[];
};

export type VerifyResult = { ok: boolean; violations: string[] };

// 提取文本中的全部数字（先删除「」内的设施名称，并去掉千位分隔符）
export function extractNumbers(text: string): string[] {
  const stripped = text.replace(/「[^」]*」/g, "").replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  return stripped.match(/\d+(?:\.\d+)?/g) ?? [];
}

// 收集统计数据中允许出现的全部数字
export function allowedNumbers(stats: VerifiableStats): Set<number> {
  const allowed = new Set<number>([stats.radius, stats.radius / 1000, stats.center.lng, stats.center.lat]);
  for (const c of stats.categories) {
    allowed.add(c.count);
    if (c.nearest) allowed.add(c.nearest.distanceM);
    for (const item of c.items) allowed.add(item.distanceM);
  }
  return allowed;
}

// 校验简报：出现任何不在统计数据里的数字（含模型自行计算的结果）即为违规
export function verifyReport(text: string, stats: VerifiableStats): VerifyResult {
  if (!text.trim()) return { ok: false, violations: ["简报内容为空"] };

  const allowed = allowedNumbers(stats);
  const violations = [...new Set(extractNumbers(text).filter((n) => !allowed.has(Number(n))))];
  return { ok: violations.length === 0, violations };
}

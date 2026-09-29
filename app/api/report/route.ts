import { generateReport } from "@/lib/report";
import type { SiteStats } from "@/lib/stats";

export const maxDuration = 120; // 最多两次大模型调用

// 去掉错误信息里可能出现的 Key，防止泄露到前端
function safeMessage(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const secret of [process.env.AMAP_WEB_KEY, process.env.DEEPSEEK_API_KEY]) {
    if (secret) msg = msg.split(secret).join("***");
  }
  return msg;
}

// 检查请求体是否具备生成简报所需的统计数据结构
function isSiteStats(x: unknown): x is SiteStats {
  const s = x as SiteStats | null;
  return (
    !!s &&
    typeof s.center?.address === "string" &&
    typeof s.center.lng === "number" &&
    typeof s.center.lat === "number" &&
    typeof s.radius === "number" &&
    Array.isArray(s.categories) &&
    s.categories.every(
      (c) =>
        typeof c.label === "string" &&
        typeof c.count === "number" &&
        typeof c.capped === "boolean" &&
        Array.isArray(c.items),
    )
  );
}

// 简报接口：POST /api/report，请求体为 /api/site 的返回结果
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const stats = body?.stats;
  if (!isSiteStats(stats)) {
    return Response.json({ error: "请求体缺少有效的统计数据（stats）" }, { status: 400 });
  }

  try {
    return Response.json(await generateReport(stats));
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return Response.json({ error: "大模型响应超时，请稍后重试" }, { status: 504 });
    }
    return Response.json({ error: safeMessage(err) }, { status: 500 });
  }
}

import { rateLimit } from "@/lib/guard";
import { generateReport } from "@/lib/report";
import { resolveSecret, verifyPayload } from "@/lib/sign";
import type { SiteStats } from "@/lib/stats";

export const maxDuration = 120; // 最多两次大模型调用

const MAX_BODY_BYTES = 250_000; // 带点位池的统计数据约几十 KB

// 去掉错误信息里可能出现的 Key，防止泄露到前端
function safeMessage(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const secret of [process.env.AMAP_WEB_KEY, process.env.DEEPSEEK_API_KEY, process.env.SIGNING_SECRET]) {
    if (secret) msg = msg.split(secret).join("***");
  }
  return msg;
}

// 检查数据是否具备生成简报所需的结构
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

// 简报接口：POST /api/report，请求体为 /api/site 返回的带签名统计数据；验签通过才调用大模型
export async function POST(request: Request) {
  const limited = rateLimit(request, "report");
  if (limited) return limited;

  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "请求体过大" }, { status: 413 });
  }
  let body: { stats?: Record<string, unknown> } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const signed = body?.stats;
  if (!signed || typeof signed !== "object") {
    return Response.json({ error: "请求体缺少有效的统计数据（stats）" }, { status: 400 });
  }

  // 取出签名字段，其余部分即被签名的统计数据；不信任客户端提交的任何字段
  const { signature, expiresAt, ...payload } = signed;
  const check = verifyPayload(payload, signature, expiresAt, resolveSecret(process.env), Date.now());
  if (!check.ok) {
    const error =
      check.reason === "expired"
        ? "统计数据已过期，请重新分析后再生成简报"
        : "统计数据签名无效，请重新分析后再生成简报";
    return Response.json({ error }, { status: 403 });
  }
  if (!isSiteStats(payload)) {
    return Response.json({ error: "统计数据格式不正确" }, { status: 400 });
  }

  try {
    return Response.json(await generateReport(payload));
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return Response.json({ error: "大模型响应超时，请稍后重试" }, { status: 504 });
    }
    return Response.json({ error: safeMessage(err) }, { status: 500 });
  }
}

import { rateLimit } from "@/lib/guard";
import { refineStats } from "@/lib/refine";
import { resolveSecret, signPayload, verifyPayload } from "@/lib/sign";
import type { SiteStats } from "@/lib/stats";

const MAX_BODY_BYTES = 250_000; // 带点位池的统计数据约几十 KB

// 勾选子类型接口：POST /api/site/refine，请求体 { stats: /api/site 返回的带签名数据, selection: { 类别key: [子类型…] } }
// 先验签，再只用签名数据里的点位池重算，最后重新签名；不访问高德，也不信任浏览器提交的任何数字。
export async function POST(request: Request) {
  const limited = rateLimit(request, "refine");
  if (limited) return limited;

  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "请求体过大" }, { status: 413 });
  }
  let body: { stats?: Record<string, unknown>; selection?: Record<string, unknown> } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const signed = body?.stats;
  if (!signed || typeof signed !== "object" || !body?.selection) {
    return Response.json({ error: "请求体缺少统计数据（stats）或勾选（selection）" }, { status: 400 });
  }

  try {
    const secret = resolveSecret(process.env);
    const { signature, expiresAt, ...payload } = signed;
    const check = verifyPayload(payload, signature, expiresAt, secret, Date.now());
    if (!check.ok) {
      const error = check.reason === "expired" ? "统计数据已过期，请重新分析" : "统计数据签名无效，请重新分析";
      return Response.json({ error }, { status: 403 });
    }
    const result = refineStats(payload as unknown as SiteStats, body.selection);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ...result.stats, ...signPayload(result.stats, secret, Date.now()) });
  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err);
    for (const s of [process.env.SIGNING_SECRET, process.env.AMAP_WEB_KEY]) if (s) msg = msg.split(s).join("***");
    return Response.json({ error: msg }, { status: 500 });
  }
}

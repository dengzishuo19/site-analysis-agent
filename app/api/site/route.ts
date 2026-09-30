import { AddressNotFoundError, RateLimitError } from "@/lib/amap";
import { rateLimit } from "@/lib/guard";
import { sanitizeAddress } from "@/lib/input";
import { resolveSecret, signPayload } from "@/lib/sign";
import { analyzeSite } from "@/lib/stats";

// 去掉错误信息里可能出现的 Key，防止泄露到前端
function safeMessage(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const secret of [process.env.AMAP_WEB_KEY, process.env.SIGNING_SECRET]) {
    if (secret) msg = msg.split(secret).join("***");
  }
  return msg;
}

// 场地分析接口：GET /api/site?address=北京市海淀区清华大学东门，返回带签名的统计数据
export async function GET(request: Request) {
  const limited = rateLimit(request, "site");
  if (limited) return limited;

  const input = sanitizeAddress(new URL(request.url).searchParams.get("address"));
  if (!input.ok) {
    return Response.json({ error: input.error }, { status: 400 });
  }

  try {
    const secret = resolveSecret(process.env); // 先取密钥：缺失时立即失败，不消耗高德额度
    const stats = await analyzeSite(input.value);
    return Response.json({ ...stats, ...signPayload(stats, secret, Date.now()) });
  } catch (err) {
    if (err instanceof AddressNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof RateLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    return Response.json({ error: safeMessage(err) }, { status: 500 });
  }
}

// 接口防护：把限流接到请求上（仅服务端使用）
import { configFromEnv, createLimiter } from "@/lib/rate-limit";

export type Endpoint = "site" | "report" | "refine";

// 每个接口一个独立的限流器，挂在 globalThis 上以免开发热更新时被重置
const g = globalThis as unknown as { __limiters?: Record<Endpoint, ReturnType<typeof createLimiter>> };
function limiters() {
  g.__limiters ??= {
    site: createLimiter(configFromEnv(process.env)),
    report: createLimiter(configFromEnv(process.env)),
    // 勾选子类型不访问高德和大模型，只做内存计算，额度放宽（仍有上限防刷）
    refine: createLimiter({ perMinute: 30, perDay: 300, globalPerDay: 3000 }),
  };
  return g.__limiters;
}

// 取访问者 IP：优先 x-forwarded-for 的第一个地址
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

// 检查是否超限；超限时返回 429 响应，否则返回 null。开发模式默认不限流
export function rateLimit(request: Request, endpoint: Endpoint): Response | null {
  if (process.env.NODE_ENV === "development" && process.env.RATE_LIMIT_IN_DEV !== "1") return null;

  const result = limiters()[endpoint].check(clientIp(request), Date.now());
  if (result.ok) return null;

  const message =
    result.scope === "global"
      ? "今日全站额度已用完，请明天再试，或先查看静态演示。"
      : result.scope === "day"
        ? "你今天的使用次数已达上限，请明天再试，或先查看静态演示。"
        : "请求过于频繁，请稍后再试。";
  return Response.json(
    { error: message, scope: result.scope },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } },
  );
}

// 统计数据签名：纯函数（仅依赖 node:crypto），时间由参数注入，便于单测
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TTL_MS = 30 * 60 * 1000; // 签名有效期 30 分钟

export type VerifyOutcome = { ok: true } | { ok: false; reason: "missing" | "expired" | "invalid" };

// 规范化：递归按键排序后序列化，使 JSON 往返后键顺序不同也得到同一字符串
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const body = Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return `{${body.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// 计算签名：HMAC-SHA256(规范化数据 + 过期时间)
function mac(payload: unknown, expiresAt: number, secret: string): string {
  return createHmac("sha256", secret).update(`${canonicalize(payload)}|${expiresAt}`).digest("hex");
}

// 给数据签名，返回签名与过期时间（毫秒时间戳）
export function signPayload(payload: unknown, secret: string, nowMs: number) {
  const expiresAt = nowMs + SIGNATURE_TTL_MS;
  return { signature: mac(payload, expiresAt, secret), expiresAt };
}

// 校验签名：缺失、过期、被篡改或密钥不同都会被拒绝
export function verifyPayload(
  payload: unknown,
  signature: unknown,
  expiresAt: unknown,
  secret: string,
  nowMs: number,
): VerifyOutcome {
  if (typeof signature !== "string" || !signature || typeof expiresAt !== "number") {
    return { ok: false, reason: "missing" };
  }
  if (nowMs > expiresAt) return { ok: false, reason: "expired" };

  const expected = Buffer.from(mac(payload, expiresAt, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true };
}

const devSecret = randomBytes(32).toString("hex"); // 开发环境的进程内随机密钥

// 读取签名密钥：生产环境必须配置，开发环境缺省时使用进程内随机密钥
export function resolveSecret(env: { NODE_ENV?: string; SIGNING_SECRET?: string }): string {
  if (env.SIGNING_SECRET) return env.SIGNING_SECRET;
  if (env.NODE_ENV === "production") {
    throw new Error("生产环境未配置 SIGNING_SECRET，拒绝启动");
  }
  return devSecret;
}

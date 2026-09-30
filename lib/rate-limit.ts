// 频率限制：纯逻辑（滑动窗口，进程内存），时间由参数注入，便于单测
// 注意：在 Vercel 等多实例环境下每个实例各自计数，只是“尽力而为”的限流

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_KEYS = 5000; // 最多记录的访问者数，超出时丢弃最早的

export type LimitConfig = { perMinute: number; perDay: number; globalPerDay: number };
export type LimitResult =
  | { ok: true }
  | { ok: false; scope: "minute" | "day" | "global"; retryAfterSec: number };

// 从环境变量读取上限（缺省使用默认值）
export function configFromEnv(env: Record<string, string | undefined>): LimitConfig {
  const num = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d);
  return {
    perMinute: num(env.RATE_PER_MINUTE, 6),
    perDay: num(env.RATE_PER_DAY, 30),
    globalPerDay: num(env.RATE_GLOBAL_PER_DAY, 300),
  };
}

// 创建限流器：每个访问者每分钟/每天有上限，另有全站每日总上限
export function createLimiter(config: LimitConfig) {
  const byKey = new Map<string, number[]>();
  const all: number[] = [];

  // 丢弃一天前的记录
  const prune = (ts: number[], now: number) => {
    while (ts.length && ts[0] <= now - DAY) ts.shift();
  };
  // 距离最早一条记录过期还有多少秒
  const retryAfter = (oldest: number, windowMs: number, now: number) =>
    Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));

  return {
    // 检查并记录一次访问；被拒绝的访问不计数
    check(key: string, now: number): LimitResult {
      const ts = byKey.get(key) ?? [];
      prune(ts, now);
      prune(all, now);

      const inMinute = ts.filter((t) => t > now - MINUTE);
      if (inMinute.length >= config.perMinute) {
        return { ok: false, scope: "minute", retryAfterSec: retryAfter(inMinute[0], MINUTE, now) };
      }
      if (ts.length >= config.perDay) {
        return { ok: false, scope: "day", retryAfterSec: retryAfter(ts[0], DAY, now) };
      }
      if (all.length >= config.globalPerDay) {
        return { ok: false, scope: "global", retryAfterSec: retryAfter(all[0], DAY, now) };
      }

      ts.push(now);
      all.push(now);
      byKey.delete(key); // 重新插入以保持“最近使用”的顺序
      byKey.set(key, ts);
      if (byKey.size > MAX_KEYS) byKey.delete(byKey.keys().next().value as string);
      return { ok: true };
    },
  };
}

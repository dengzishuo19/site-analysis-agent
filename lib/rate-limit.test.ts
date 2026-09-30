import { test } from "node:test";
import assert from "node:assert/strict";
import { configFromEnv, createLimiter } from "./rate-limit.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = 1_700_000_000_000;

test("窗口内超限被拒，并给出 Retry-After", () => {
  const lim = createLimiter({ perMinute: 3, perDay: 100, globalPerDay: 1000 });
  for (let i = 0; i < 3; i++) assert.deepEqual(lim.check("1.1.1.1", T0 + i * 1000), { ok: true });
  const r = lim.check("1.1.1.1", T0 + 3000);
  assert.deepEqual(r, { ok: false, scope: "minute", retryAfterSec: 57 });
});

test("窗口滑过后恢复", () => {
  const lim = createLimiter({ perMinute: 2, perDay: 100, globalPerDay: 1000 });
  lim.check("a", T0);
  lim.check("a", T0 + 1000);
  assert.equal(lim.check("a", T0 + 2000).ok, false);
  assert.equal(lim.check("a", T0 + MIN + 1).ok, true); // 第一条已滑出窗口
});

test("被拒绝的请求不计数", () => {
  const lim = createLimiter({ perMinute: 1, perDay: 100, globalPerDay: 1000 });
  lim.check("a", T0);
  for (let i = 1; i <= 10; i++) assert.equal(lim.check("a", T0 + i * 1000).ok, false);
  assert.equal(lim.check("a", T0 + MIN + 1).ok, true); // 若被拒请求也计数，这里仍会被拒
});

test("每日上限：分钟窗口没满也会被拒，24 小时后恢复", () => {
  const lim = createLimiter({ perMinute: 100, perDay: 5, globalPerDay: 1000 });
  for (let i = 0; i < 5; i++) assert.equal(lim.check("a", T0 + i * HOUR).ok, true);
  const r = lim.check("a", T0 + 6 * HOUR);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.scope, "day");
    assert.equal(r.retryAfterSec, (DAY - 6 * HOUR) / 1000); // 最早一条在 T0，24 小时后过期
  }
  assert.equal(lim.check("a", T0 + DAY + 1).ok, true);
});

test("全站总上限：不同访问者共同消耗，超过后所有人被拒", () => {
  const lim = createLimiter({ perMinute: 100, perDay: 100, globalPerDay: 3 });
  assert.equal(lim.check("a", T0).ok, true);
  assert.equal(lim.check("b", T0 + 1).ok, true);
  assert.equal(lim.check("c", T0 + 2).ok, true);
  const r = lim.check("d", T0 + 3);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.scope, "global");
  assert.equal(lim.check("a", T0 + 4).ok, false);
  assert.equal(lim.check("d", T0 + DAY + 1).ok, true);
});

test("不同 IP 互不影响", () => {
  const lim = createLimiter({ perMinute: 1, perDay: 100, globalPerDay: 1000 });
  assert.equal(lim.check("a", T0).ok, true);
  assert.equal(lim.check("a", T0 + 1).ok, false);
  assert.equal(lim.check("b", T0 + 1).ok, true);
});

test("Retry-After 至少为 1 秒", () => {
  const lim = createLimiter({ perMinute: 1, perDay: 100, globalPerDay: 1000 });
  lim.check("a", T0);
  const r = lim.check("a", T0 + MIN - 1);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.retryAfterSec, 1);
});

test("环境变量配置：缺省、自定义、非法值回退默认", () => {
  assert.deepEqual(configFromEnv({}), { perMinute: 6, perDay: 30, globalPerDay: 300 });
  assert.deepEqual(configFromEnv({ RATE_PER_MINUTE: "2", RATE_PER_DAY: "9", RATE_GLOBAL_PER_DAY: "50" }), {
    perMinute: 2,
    perDay: 9,
    globalPerDay: 50,
  });
  assert.deepEqual(configFromEnv({ RATE_PER_MINUTE: "abc", RATE_PER_DAY: "-1", RATE_GLOBAL_PER_DAY: "0" }), {
    perMinute: 6,
    perDay: 30,
    globalPerDay: 300,
  });
});

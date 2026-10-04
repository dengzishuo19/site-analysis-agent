import test from "node:test";
import assert from "node:assert/strict";
import { refineStats } from "./refine.ts";
import { resolveSecret, signPayload, verifyPayload } from "./sign.ts";
import { SUBTYPES } from "./subtype.ts";
import type { SiteStats } from "./stats.ts";

const pool = [
  { name: "A小学", distanceM: 100, lng: 116.4, lat: 39.9, sub: "小学" },
  { name: "B幼儿园", distanceM: 50, lng: 116.4, lat: 39.9, sub: "幼儿园" },
  { name: "C大学", distanceM: 300, lng: 116.4, lat: 39.9, sub: "大学" },
];
const stats: SiteStats = {
  center: { address: "测试", lng: 116.4, lat: 39.9 },
  radius: 1000,
  generatedAt: "2026-10-04T00:00:00.000Z",
  source: "高德开放平台",
  categories: [
    { key: "metro", label: "地铁站出入口", count: 3, capped: false, nearest: null, items: [], folded: 0 },
    {
      key: "school", label: "教育（学校）", count: 3, capped: false, folded: 0,
      nearest: pool[1], items: [pool[1], pool[0], pool[2]].map((p) => ({ name: p.name, distanceM: p.distanceM, lng: p.lng, lat: p.lat })),
      pool, poolTruncated: false, subtypes: [], selected: [...SUBTYPES.school], base: { count: 3, capped: false },
    },
  ],
};

test("勾选小学+幼儿园：数量、最近设施、条目一致，其他类别不变", () => {
  const r = refineStats(stats, { school: ["小学", "幼儿园"] });
  assert.ok(r.ok);
  if (!r.ok) return;
  const school = r.stats.categories[1];
  assert.deepEqual([school.count, school.nearest?.name, school.items.map((i) => i.name), school.selected], [2, "B幼儿园", ["B幼儿园", "A小学"], ["小学", "幼儿园"]]);
  assert.deepEqual(r.stats.categories[0], stats.categories[0]);
});

test("再次全选：数量恢复默认口径", () => {
  const r = refineStats(stats, { school: [...SUBTYPES.school] });
  assert.ok(r.ok && r.stats.categories[1].count === 3);
});

test("拒绝：不支持的类别、未知子类型、空勾选、非对象", () => {
  for (const sel of [{ metro: ["小学"] }, { school: ["火星学校"] }, { school: [] }, {}, null, [] as never]) {
    assert.equal(refineStats(stats, sel as never).ok, false, JSON.stringify(sel));
  }
});

test("重算后重新签名；篡改勾选后的数字，验签失败", () => {
  const secret = resolveSecret({ SIGNING_SECRET: "test-secret" });
  const r = refineStats(stats, { school: ["小学"] });
  assert.ok(r.ok);
  if (!r.ok) return;
  const { signature, expiresAt } = signPayload(r.stats, secret, 1000);
  assert.equal(verifyPayload(r.stats, signature, expiresAt, secret, 2000).ok, true);
  const tampered = { ...r.stats, categories: r.stats.categories.map((c) => (c.key === "school" ? { ...c, count: 99 } : c)) };
  assert.equal(verifyPayload(tampered, signature, expiresAt, secret, 2000).ok, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePick, encodePick, type PickPayload } from "./pick-token.ts";
import { SIGNATURE_TTL_MS } from "./sign.ts";

const SECRET = "test-secret-bbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = 1_700_000_000_000;
const payload: PickPayload = { name: "北京建筑大学(西城校区)", lng: 116.341397, lat: 39.935142 };

// 解开令牌、改一处内容、重新编码（不重新签名），模拟篡改
const tamper = (token: string, edit: (o: { p: Record<string, unknown>; s: string; e: number }) => void) => {
  const o = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  edit(o);
  return Buffer.from(JSON.stringify(o)).toString("base64url");
};

test("有效令牌通过，并还原出名称与坐标", () => {
  const token = encodePick(payload, SECRET, NOW);
  assert.deepEqual(decodePick(token, SECRET, NOW + 1000), { ok: true, payload });
});

test("令牌可安全放进 URL（只含 base64url 字符）", () => {
  assert.match(encodePick(payload, SECRET, NOW), /^[A-Za-z0-9_-]+$/);
});

test("篡改坐标被拒（不能借候选令牌在别处分析）", () => {
  const token = encodePick(payload, SECRET, NOW);
  assert.deepEqual(decodePick(tamper(token, (o) => (o.p.lng = 116.5)), SECRET, NOW), { ok: false, reason: "invalid" });
  assert.deepEqual(decodePick(tamper(token, (o) => (o.p.lat = 39.9)), SECRET, NOW), { ok: false, reason: "invalid" });
});

test("篡改名称被拒", () => {
  const token = encodePick(payload, SECRET, NOW);
  assert.deepEqual(decodePick(tamper(token, (o) => (o.p.name = "别的地方")), SECRET, NOW), { ok: false, reason: "invalid" });
});

test("篡改有效期（想延长）被拒；真正过期被拒；过期前一刻仍有效", () => {
  const token = encodePick(payload, SECRET, NOW);
  assert.deepEqual(decodePick(tamper(token, (o) => (o.e += 86_400_000)), SECRET, NOW), { ok: false, reason: "invalid" });
  assert.deepEqual(decodePick(token, SECRET, NOW + SIGNATURE_TTL_MS + 1), { ok: false, reason: "expired" });
  assert.equal(decodePick(token, SECRET, NOW + SIGNATURE_TTL_MS).ok, true);
});

test("密钥不同被拒；伪造签名被拒", () => {
  const token = encodePick(payload, SECRET, NOW);
  assert.deepEqual(decodePick(token, "another-secret", NOW), { ok: false, reason: "invalid" });
  assert.deepEqual(decodePick(tamper(token, (o) => (o.s = "0".repeat(64))), SECRET, NOW), { ok: false, reason: "invalid" });
});

test("中国范围之外的坐标即使签名有效也被拒", () => {
  // 全国范围：外地（上海）可以；中国范围以外（东京）拒绝
  assert.equal(decodePick(encodePick({ name: "上海", lng: 121.47, lat: 31.23 }, SECRET, NOW), SECRET, NOW).ok, true);
  const token = encodePick({ name: "东京", lng: 139.69, lat: 35.69 }, SECRET, NOW);
  assert.deepEqual(decodePick(token, SECRET, NOW), { ok: false, reason: "outside" });
});

test("格式错误的令牌：空、乱码、非 JSON、缺字段、名称过长、缺签名", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  for (const bad of ["", "abc", "!!!", b64("not json"), b64("{}"), b64(JSON.stringify({ p: { name: "x" } })), b64(JSON.stringify({ p: { name: "x".repeat(121), lng: 116.3, lat: 39.9 } }))]) {
    assert.deepEqual(decodePick(bad, SECRET, NOW), { ok: false, reason: "malformed" }, JSON.stringify(bad).slice(0, 40));
  }
  const noSig = encodePick(payload, SECRET, NOW);
  assert.deepEqual(decodePick(tamper(noSig, (o) => delete (o as Record<string, unknown>).s), SECRET, NOW), { ok: false, reason: "malformed" });
});

test("同一输入同一时间产生相同令牌（确定性）", () => {
  assert.equal(encodePick(payload, SECRET, NOW), encodePick({ ...payload }, SECRET, NOW));
});

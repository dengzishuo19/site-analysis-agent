// 候选令牌：用户在候选列表里选中一个地点时，服务器只接受自己签发过的令牌，不接受浏览器提交的任意坐标。纯函数，时间由参数注入。
import { inBeijing } from "./geo-resolve.ts";
import { signPayload, verifyPayload } from "./sign.ts";

export type PickPayload = { name: string; lng: number; lat: number };
export type DecodeResult =
  | { ok: true; payload: PickPayload }
  | { ok: false; reason: "malformed" | "expired" | "invalid" | "outside" };

// 生成令牌：base64url(JSON{p: 内容, s: 签名, e: 过期时间})
export function encodePick(payload: PickPayload, secret: string, nowMs: number): string {
  const { signature, expiresAt } = signPayload(payload, secret, nowMs);
  return Buffer.from(JSON.stringify({ p: payload, s: signature, e: expiresAt })).toString("base64url");
}

// 解析并校验令牌：格式、签名、有效期、坐标是否在北京范围内
export function decodePick(token: string, secret: string, nowMs: number): DecodeResult {
  let raw: { p?: Partial<PickPayload>; s?: unknown; e?: unknown };
  try {
    raw = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const p = raw?.p;
  if (!p || typeof p.name !== "string" || typeof p.lng !== "number" || typeof p.lat !== "number" || p.name.length > 120) {
    return { ok: false, reason: "malformed" };
  }
  const payload: PickPayload = { name: p.name, lng: p.lng, lat: p.lat };

  const check = verifyPayload(payload, raw.s, raw.e, secret, nowMs);
  if (!check.ok) return { ok: false, reason: check.reason === "expired" ? "expired" : check.reason === "missing" ? "malformed" : "invalid" };
  if (!inBeijing(payload.lng, payload.lat)) return { ok: false, reason: "outside" };
  return { ok: true, payload };
}

// 输入清洗：纯函数

export const MAX_ADDRESS_LENGTH = 60;

export type AddressResult = { ok: true; value: string } | { ok: false; error: string };

// 判断是否含控制字符（含换行、制表符）或行/段分隔符
function hasControlChar(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

// 清洗并校验地址：去首尾空格，1 到 60 个字符，不含控制字符
export function sanitizeAddress(raw: unknown): AddressResult {
  if (typeof raw !== "string") return { ok: false, error: "请输入地址" };
  const value = raw.trim();
  if (!value) return { ok: false, error: "请输入地址" };
  if (Array.from(value).length > MAX_ADDRESS_LENGTH) {
    return { ok: false, error: `地址过长，请控制在 ${MAX_ADDRESS_LENGTH} 个字符以内` };
  }
  if (hasControlChar(value)) return { ok: false, error: "地址中含有不支持的字符" };
  return { ok: true, value };
}

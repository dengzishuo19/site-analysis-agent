import { AddressNotFoundError, RateLimitError } from "@/lib/amap";
import { analyzeSite } from "@/lib/stats";

// 去掉错误信息里可能出现的 Key，防止泄露到前端
function safeMessage(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  const secret = process.env.AMAP_WEB_KEY;
  if (secret) msg = msg.split(secret).join("***");
  return msg;
}

// 场地分析接口：GET /api/site?address=北京市海淀区清华大学东门
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address) {
    return Response.json({ error: "请输入地址" }, { status: 400 });
  }

  try {
    return Response.json(await analyzeSite(address));
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

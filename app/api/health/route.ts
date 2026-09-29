import { geocode } from "@/lib/amap";
import { chat } from "@/lib/llm";

// 去掉错误信息里可能出现的 Key，防止泄露到前端
function safeMessage(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const secret of [process.env.AMAP_WEB_KEY, process.env.DEEPSEEK_API_KEY]) {
    if (secret) msg = msg.split(secret).join("***");
  }
  return msg;
}

// 连通性检查：同时测试高德地理编码和大模型调用，互不影响
export async function GET() {
  const [amap, llm] = await Promise.allSettled([
    geocode("北京市海淀区清华大学东门"),
    chat("请用一句话回答：1+1 等于几？"),
  ]);

  return Response.json({
    amap:
      amap.status === "fulfilled"
        ? { ok: true, result: amap.value }
        : { ok: false, error: safeMessage(amap.reason) },
    llm:
      llm.status === "fulfilled"
        ? { ok: true, result: llm.value }
        : { ok: false, error: safeMessage(llm.reason) },
  });
}

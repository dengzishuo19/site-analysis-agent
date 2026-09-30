// 服务启动时执行：生产环境缺少 SIGNING_SECRET 会使所有请求返回 500（安全失败；仅 Node 运行时，因为签名依赖 node:crypto）
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resolveSecret } = await import("@/lib/sign");
    resolveSecret(process.env);
  }
}

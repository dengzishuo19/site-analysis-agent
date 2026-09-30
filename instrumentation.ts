// 服务启动时执行：生产环境缺少 SIGNING_SECRET 则拒绝启动（仅 Node 运行时，因为签名依赖 node:crypto）
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resolveSecret } = await import("@/lib/sign");
    resolveSecret(process.env);
  }
}

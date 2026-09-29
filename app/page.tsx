"use client";

import { useState } from "react";

type Check = { ok: boolean; result?: unknown; error?: string };
type Health = { amap: Check; llm: Check };

// 首页：点击按钮测试高德和大模型两个接口是否连通
export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function runTest() {
    setLoading(true);
    setFailure(null);
    try {
      const res = await fetch("/api/health");
      setHealth(await res.json());
    } catch {
      setHealth(null);
      setFailure("无法访问 /api/health，请确认开发服务器正在运行");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">场地分析 Agent</h1>
      <p className="mt-2 text-sm text-gray-500">第 1 步：验证高德与大模型接口是否连通</p>

      <button
        onClick={runTest}
        disabled={loading}
        className="mt-6 rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {loading ? "测试中…" : "测试连接"}
      </button>

      {failure && <p className="mt-4 text-red-600">{failure}</p>}

      {health && (
        <div className="mt-6 space-y-4">
          <Result title="高德地理编码" check={health.amap} />
          <Result title="DeepSeek 大模型" check={health.llm} />
        </div>
      )}
    </main>
  );
}

// 展示单个接口的测试结果
function Result({ title, check }: { title: string; check: Check }) {
  return (
    <section className="rounded border p-4">
      <h2 className="font-semibold">
        {check.ok ? "✅" : "❌"} {title}
      </h2>
      <pre className="mt-2 whitespace-pre-wrap text-sm">
        {check.ok ? JSON.stringify(check.result, null, 2) : check.error}
      </pre>
    </section>
  );
}

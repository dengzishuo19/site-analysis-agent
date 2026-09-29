"use client";

import { useRef, useState } from "react";

type Poi = { name: string; distanceM: number };
type CategoryStat = { key: string; label: string; count: number; capped: boolean; nearest: Poi | null };
type SiteStats = {
  center: { address: string; lng: number; lat: number };
  radius: number;
  categories: CategoryStat[];
  generatedAt: string;
  source: string;
};

type Report = {
  text: string;
  verified: boolean;
  violations: string[];
  attempts: number;
  model: string;
  generatedAt: string;
};

type Check = { ok: boolean; result?: unknown; error?: string };
type Health = { amap: Check; llm: Check };

// 首页：输入北京地址，查看周边设施统计表
export default function Home() {
  const [address, setAddress] = useState("");
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const runId = useRef(0); // 防止旧请求的结果覆盖新请求

  // 根据统计数据请求大模型简报
  async function fetchReport(data: SiteStats, id: number) {
    setReportLoading(true);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stats: data }),
      });
      const body = await res.json();
      if (id !== runId.current) return;
      if (!res.ok) setReportError(body.error ?? "简报生成失败");
      else setReport(body);
    } catch {
      if (id === runId.current) setReportError("无法访问服务，简报生成失败");
    } finally {
      if (id === runId.current) setReportLoading(false);
    }
  }

  async function analyze() {
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    setStats(null);
    setReport(null);
    setReportError(null);
    setReportLoading(false);
    try {
      const res = await fetch(`/api/site?address=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (id !== runId.current) return;
      if (!res.ok) {
        setError(data.error ?? "分析失败");
      } else {
        setStats(data);
        fetchReport(data, id);
      }
    } catch {
      if (id === runId.current) setError("无法访问服务，请确认开发服务器正在运行");
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold">场地分析 Agent</h1>
      <p className="mt-2 text-sm text-gray-500">输入北京的一个地址，查看周边 1 km 的设施统计</p>

      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          analyze();
        }}
      >
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="例如：北京市朝阳区国贸地铁站"
          className="flex-1 rounded border px-3 py-2"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? "分析中…（约 10 秒）" : "分析"}
        </button>
      </form>

      {error && <p className="mt-4 text-red-600">{error}</p>}

      {stats && <StatsTable stats={stats} />}

      {reportLoading && <p className="mt-6 text-sm text-gray-500">简报生成中…（约 20–40 秒）</p>}
      {reportError && <p className="mt-6 text-red-600">{reportError}</p>}
      {report && <ReportView report={report} />}

      <HealthCheck />
    </main>
  );
}

// 统计结果表格：各类设施的数量与最近设施
function StatsTable({ stats }: { stats: SiteStats }) {
  return (
    <section className="mt-6">
      <p className="text-sm">
        定位：{stats.center.address}（{stats.center.lng}, {stats.center.lat}），半径 {stats.radius} m
      </p>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">类别</th>
            <th>数量</th>
            <th>最近设施</th>
            <th>距离</th>
          </tr>
        </thead>
        <tbody>
          {stats.categories.map((c) => (
            <tr key={c.key} className="border-b">
              <td className="py-2">{c.label}</td>
              <td>{c.capped ? `≥${c.count}` : c.count}</td>
              <td>{c.nearest?.name ?? "—"}</td>
              <td>{c.nearest ? `${c.nearest.distanceM} m` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-500">
        数据来源：{stats.source}，生成于 {new Date(stats.generatedAt).toLocaleString()}。
        数量为高德 POI 点位数，不等于用地性质；地铁按出入口计数；“≥”表示高德返回总数已封顶，实际更多。
      </p>
    </section>
  );
}

// 简报展示：未通过数字校验时显示醒目警告；“## ”开头的行渲染为小标题
function ReportView({ report }: { report: Report }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">场地分析简报</h2>
      {!report.verified && (
        <div className="mt-3 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800">
          ⚠️ 以下简报含有未通过校验的数字：{report.violations.join("、")}。这些数字在统计表中找不到对应，请勿引用。
        </div>
      )}
      <div className="mt-3 space-y-3 text-sm leading-7">
        {report.text.split("\n").map((line, i) =>
          line.startsWith("## ") ? (
            <h3 key={i} className="pt-2 font-semibold">
              {line.slice(3)}
            </h3>
          ) : line.trim() ? (
            <p key={i}>{line}</p>
          ) : null,
        )}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        由 {report.model} 生成，数字校验：{report.verified ? "通过" : "未通过"}（生成 {report.attempts} 次）。
        简报仅基于上方统计表，请以统计表为准。
      </p>
    </section>
  );
}

// 折叠区：接口连通性检查（开发调试用）
function HealthCheck() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);

  async function runTest() {
    setLoading(true);
    try {
      setHealth(await (await fetch("/api/health")).json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className="mt-10 text-sm text-gray-600">
      <summary className="cursor-pointer">接口连通性检查（调试用）</summary>
      <button
        onClick={runTest}
        disabled={loading}
        className="mt-3 rounded border px-3 py-1 disabled:opacity-50"
      >
        {loading ? "测试中…" : "测试连接"}
      </button>
      {health && (
        <pre className="mt-3 whitespace-pre-wrap">
          {`高德：${health.amap.ok ? "✅" : "❌ " + health.amap.error}\n大模型：${
            health.llm.ok ? "✅ " + health.llm.result : "❌ " + health.llm.error
          }`}
        </pre>
      )}
    </details>
  );
}

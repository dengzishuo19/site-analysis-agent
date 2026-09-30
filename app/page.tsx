"use client";

import { useRef, useState } from "react";
import { BarCharts, SiteMap, VizStyles, type VizStats } from "./components/SiteViz";

type Poi = { name: string; distanceM: number; lng: number; lat: number };
type CategoryStat = { key: string; label: string; count: number; capped: boolean; nearest: Poi | null; items: Poi[] };
type SiteStats = VizStats & {
  categories: CategoryStat[];
  generatedAt: string;
  source: string;
};

type Report = {
  text: string;
  verified: boolean;
  violations: string[];
  coverage: { numbers: number; bound: number };
  attempts: number;
  model: string;
  generatedAt: string;
};

type Problem = { message: string; showDemo: boolean };

// 定位含糊时服务器返回的候选（pick 是服务器签发的令牌，选中后凭它继续分析）
type Choice = { name: string; district: string; address: string; type: string; pick: string };
type ChoiceSet = { query: string; reason: string; candidates: Choice[] };

const DEMO_URL = "https://dengzishuo19.github.io/site-analysis-agent/";

type Check = { ok: boolean; result?: unknown; error?: string };
type Health = { amap: Check; llm: Check };

// 首页：输入北京地址，查看周边设施统计表
export default function Home() {
  const [address, setAddress] = useState("");
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<Problem | null>(null);
  const [choices, setChoices] = useState<ChoiceSet | null>(null);
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
      if (!res.ok) setReportError({ message: body.error ?? "简报生成失败", showDemo: res.status === 429 });
      else setReport(body);
    } catch {
      if (id === runId.current) setReportError({ message: "无法访问服务，简报生成失败", showDemo: false });
    } finally {
      if (id === runId.current) setReportLoading(false);
    }
  }

  // 请求场地统计：成功则依次展示统计、地图、图表、简报；定位含糊时显示候选让用户选择
  async function runSite(url: string) {
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    setStats(null);
    setReport(null);
    setReportError(null);
    setReportLoading(false);
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (id !== runId.current) return;
      if (!res.ok) {
        setChoices(null);
        setError({ message: data.error ?? "分析失败", showDemo: res.status === 429 || res.status === 503 });
      } else if (data.kind === "choose") {
        setChoices(data);
      } else {
        setChoices(null);
        setStats(data);
        fetchReport(data, id);
      }
    } catch {
      if (id === runId.current) setError({ message: "无法访问服务，请稍后再试", showDemo: true });
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }

  function analyze() {
    setChoices(null);
    runSite(`/api/site?address=${encodeURIComponent(address)}`);
  }

  function pickCandidate(c: Choice) {
    setChoices(null);
    runSite(`/api/site?pick=${encodeURIComponent(c.pick)}`);
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
          maxLength={60}
          className="flex-1 rounded border px-3 py-2"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {loading ? "分析中…（约 10 秒）" : "分析"}
        </button>
      </form>

      {error && <ErrorNote problem={error} className="mt-4" />}

      {choices && <ChoiceList choices={choices} onPick={pickCandidate} disabled={loading} />}

      <VizStyles />

      {stats && <StatsTable stats={stats} />}

      {stats && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">周边设施地图</h2>
          <SiteMap stats={stats} />
        </section>
      )}

      {stats && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">设施对比</h2>
          <BarCharts stats={stats} />
        </section>
      )}

      {reportLoading && <p className="mt-6 text-sm text-gray-500">简报生成中…（约 20–40 秒）</p>}
      {reportError && <ErrorNote problem={reportError} className="mt-6" />}
      {report && <ReportView report={report} />}

      {process.env.NODE_ENV !== "production" && <HealthCheck />}
    </main>
  );
}

// 错误提示：超限或服务不可用时附带静态演示链接
function ErrorNote({ problem, className }: { problem: Problem; className: string }) {
  return (
    <p className={`${className} text-red-600`}>
      {problem.message}
      {problem.showDemo && (
        <>
          {" "}
          <a href={DEMO_URL} className="underline" target="_blank" rel="noopener noreferrer">
            查看静态演示
          </a>
        </>
      )}
    </p>
  );
}

// 候选列表：定位含糊时让用户选择具体地点（例如“北京建筑大学”有西城、大兴两个校区）
function ChoiceList({ choices, onPick, disabled }: { choices: ChoiceSet; onPick: (c: Choice) => void; disabled: boolean }) {
  const title =
    choices.reason === "multiple"
      ? `“${choices.query}”有多个可能的地点，请选择：`
      : `没能确定“${choices.query}”具体指哪里，请选择一个地点：`;
  return (
    <section className="mt-6 rounded border p-4" aria-live="polite">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 space-y-2">
        {choices.candidates.map((c) => (
          <li key={c.pick}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(c)}
              className="w-full rounded border px-3 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
            >
              <span className="font-medium">{c.name}</span>
              <span className="block text-xs text-gray-500">
                {[c.district, c.address].filter(Boolean).join(" · ")}
                {c.type ? `　｜　${c.type}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-500">都不是？请在上面输入更具体的名称（例如加上“西城校区”）后重新分析。</p>
    </section>
  );
}

// 统计结果表格：各类设施的数量与最近设施
function StatsTable({ stats }: { stats: SiteStats }) {
  return (
    <section className="mt-6">
      <p className="text-sm">
        定位：{stats.center.address}（{stats.center.lng}, {stats.center.lat}），半径 {stats.radius} m
      </p>
      <p className="mt-1 text-xs text-gray-500">如果这不是你要找的地点，请输入更具体的名称重新分析。</p>
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
          ⚠️ 以下简报有内容未通过校验：{report.violations.join("；")}。这些内容与统计表不符，请勿引用。
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
        由 {report.model} 生成，校验：{report.verified ? "通过" : "未通过"}（生成 {report.attempts} 次；
        简报中 {report.coverage.numbers} 个数字里有 {report.coverage.bound} 个已与统计表逐项配对核对，其余仅核对是否出现在统计表中）。
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

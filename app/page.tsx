"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { HomeExample } from "./components/HomeExample";
import { BarCharts, SiteMap, VizStyles, type VizStats } from "./components/SiteViz";

type Poi = { name: string; distanceM: number; lng: number; lat: number };
type Subtype = { name: string; count: number };
type CategoryStat = {
  key: string;
  label: string;
  count: number;
  capped: boolean;
  nearest: Poi | null;
  items: Poi[];
  folded?: number; // 被过滤的噪点数
  // 仅教育、医疗、工业有：子类型分布与当前勾选（pool 是服务端签名数据里的点位池，浏览器只原样带回）
  subtypes?: Subtype[];
  selected?: string[];
  poolTruncated?: boolean;
};
type SiteStats = Omit<VizStats, "categories"> & {
  categories: CategoryStat[];
  expiresAt?: number; // 有签名时存在
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
const REPO_URL = "https://github.com/dengzishuo19/site-analysis-agent";
const RULES_URL = `${REPO_URL}/blob/main/docs/testset/review.md`;

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
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [exampleOpen, setExampleOpen] = useState(false); // 出结果后，用户点“再看示例”才重新展开
  const [reportStale, setReportStale] = useState(false); // 口径变了，已生成的简报对不上当前数字
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
    setReportStale(false);
    setRefineError(null);
    setExampleOpen(false);
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

  // 勾选子类型：服务端用已签名的点位池重算并重新签名；成功后数字、地图、图表随之更新，旧简报标为过期
  async function refine(selection: Record<string, string[]>) {
    if (!stats) return;
    setRefining(true);
    setRefineError(null);
    try {
      const res = await fetch("/api/site/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stats, selection }),
      });
      const body = await res.json();
      if (!res.ok) {
        setRefineError(body.error ?? "口径调整失败");
      } else {
        setStats(body);
        if (report || reportLoading) {
          setReport(null);
          setReportLoading(false);
          runId.current++; // 作废正在进行的简报请求
          setReportStale(true);
        }
      }
    } catch {
      setRefineError("无法访问服务，口径调整失败");
    } finally {
      setRefining(false);
    }
  }

  function regenerateReport() {
    if (!stats) return;
    setReportStale(false);
    setReportError(null);
    fetchReport(stats, runId.current);
  }

  function analyze() {
    setChoices(null);
    runSite(`/api/site?address=${encodeURIComponent(address)}`);
  }

  function analyzeExample(addr: string) {
    setAddress(addr);
    setChoices(null);
    runSite(`/api/site?address=${encodeURIComponent(addr)}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function pickCandidate(c: Choice) {
    setChoices(null);
    runSite(`/api/site?pick=${encodeURIComponent(c.pick)}`);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10 lg:max-w-5xl">
      {/* 刊头：细线下的刊名与检索范围 */}
      <div className="flex items-baseline justify-between border-b border-ink pb-2 text-xs text-ink-2">
        <span className="tracking-widest">场地分析 Agent</span>
        <span className="font-mono">北京 · 半径 1000 m</span>
      </div>

      {!stats && !loading ? (
        <div className="mt-8 grid gap-6 sm:mt-10 lg:grid-cols-[1.6fr_1fr] lg:items-end">
          <h1 className="text-[2.1rem] leading-[1.15] font-medium tracking-tight sm:text-5xl">
            一个地址，
            <br />
            一份可以核对的
            <br />
            场地分析。
          </h1>
          <div className="text-sm leading-7 text-ink-2 lg:border-l lg:border-ink lg:pl-5">
            <p>输入北京的一个地址：代码统计周边 1 km 的 7 类设施，大模型撰写简报，代码逐条核对简报里的每一个数字。</p>
            <ol className="mt-3 space-y-0.5 text-xs">
              <li><span className="mr-2 font-mono">01</span>统计由代码计算，不让模型数数</li>
              <li><span className="mr-2 font-mono">02</span>简报逐条校验，编造的数字会被抓出</li>
              <li><span className="mr-2 font-mono">03</span>噪点过滤有人工标注集度量</li>
            </ol>
          </div>
        </div>
      ) : (
        <h1 className="mt-6 text-2xl font-medium tracking-tight">场地分析 Agent</h1>
      )}

      {/* 输入：杂志式下划线，不用方框 */}
      <form
        className="mt-8 flex items-stretch border-b-2 border-ink"
        onSubmit={(e) => {
          e.preventDefault();
          analyze();
        }}
      >
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="输入北京地址，如：国贸地铁站"
          aria-label="北京地址"
          maxLength={60}
          className="min-h-12 min-w-0 flex-1 bg-transparent px-0 text-base outline-none placeholder:text-ink-3"
        />
        <button type="submit" disabled={loading} className="min-h-12 shrink-0 pl-4 text-sm tracking-[0.2em] disabled:opacity-50">
          {loading ? "分析中…" : "分析 →"}
        </button>
      </form>

      {loading && <LoadingSteps />}

      {error && <ErrorNote problem={error} className="mt-4" />}

      {choices && <ChoiceList choices={choices} onPick={pickCandidate} disabled={loading} />}

      <VizStyles />

      {stats && <TrustBar stats={stats} report={report} reportLoading={reportLoading} reportStale={reportStale} />}
      {stats && <StatsTable stats={stats} onRefine={refine} busy={refining} error={refineError} />}

      {stats && (
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <section className="min-w-0">
            <div className="mb-3 flex items-baseline gap-3 border-t-[3px] border-ink pt-3"><span className="font-mono text-xs">图 1</span><h2 className="text-sm font-medium tracking-widest">周边设施地图</h2></div>
            <SiteMap stats={stats} />
          </section>
          <section className="min-w-0">
            <div className="mb-3 flex items-baseline gap-3 border-t-[3px] border-ink pt-3"><span className="font-mono text-xs">图 2</span><h2 className="text-sm font-medium tracking-widest">设施对比</h2></div>
            <BarCharts stats={stats} />
          </section>
        </div>
      )}

      {reportStale && (
        <p className="mt-6 text-sm text-ink-2">
          统计口径已改变，之前的简报已作废。{" "}
          <button type="button" onClick={regenerateReport} className="underline">
            按当前口径重新生成简报
          </button>
        </p>
      )}
      {reportLoading && <p className="mt-6 text-sm text-ink-3">简报生成中…（约 20–40 秒）</p>}
      {reportError && <ErrorNote problem={reportError} className="mt-6" />}
      {report && <ReportView report={report} />}

      {((!stats && !loading && !choices) || exampleOpen) && (
        <HomeExample onAnalyze={analyzeExample} demoUrl={DEMO_URL} disabled={loading} />
      )}
      {stats && !exampleOpen && (
        <p className="mt-10 text-sm">
          <button type="button" onClick={() => setExampleOpen(true)} className="min-h-11 underline">
            再看示例
          </button>
        </p>
      )}

      <About />

      {process.env.NODE_ENV !== "production" && <HealthCheck />}
    </main>
  );
}

// 可信度信息条：只展示后端已有的事实（签名、简报校验结果、过滤数），不新增任何声称
function TrustBar({ stats, report, reportLoading, reportStale }: { stats: SiteStats; report: Report | null; reportLoading: boolean; reportStale: boolean }) {
  const folded = stats.categories.reduce((a, c) => a + (c.folded ?? 0), 0);
  const chip = "rounded-full border border-hair px-3 py-1";
  let reportChip: React.ReactNode = null;
  if (reportStale) reportChip = <span className={chip}>简报待按当前口径重新生成</span>;
  else if (reportLoading) reportChip = <span className={chip}>… 简报生成中，生成后逐条校验</span>;
  else if (report?.verified)
    reportChip = (
      <span className={`${chip} border-ink`}>
        ✓ 简报 {report.coverage.numbers} 个数字已全部核对，其中 {report.coverage.bound} 个与具体设施或类别逐一配对
      </span>
    );
  else if (report) reportChip = <span className={`${chip} border-ink font-medium`}>✗ 简报有内容未通过校验（见下方）</span>;

  return (
    <div className="mt-6 flex flex-wrap gap-2 text-xs" aria-label="数据可信度">
      {stats.expiresAt && <span className={chip}>✓ 统计由代码计算，并经服务器签名防篡改</span>}
      {reportChip}
      {folded > 0 && (
        <a href={RULES_URL} target="_blank" rel="noopener noreferrer" className={`${chip} underline-offset-2 hover:underline`}>
          已过滤 {folded} 个噪点 · 查看规则与度量
        </a>
      )}
    </div>
  );
}

// 关于这个项目：只放作者名字与 GitHub 链接
function About() {
  return (
    <footer className="mt-12 border-t border-hair pt-4 text-xs text-ink-3">
      <p>
        场地分析 Agent · 作者：邓子硕 ·{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="underline">
          GitHub 仓库
        </a>{" "}
        ·{" "}
        <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="underline">
          静态演示
        </a>
      </p>
      <p className="mt-1">数据来源：高德开放平台；简报由大模型撰写，数字由代码校验。仅为技术演示，请勿大量访问。</p>
    </footer>
  );
}

// 分析等待时的分步说明。接口是一次性返回的，所以这是按经验估计的“正在做什么”，不是真实进度
function LoadingSteps() {
  const steps = ["定位地址", "检索 7 类周边设施", "过滤噪点并整理"];
  const [at, setAt] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setAt(1), 1500);
    const t2 = setTimeout(() => setAt(2), 8000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  return (
    <div className="mt-4 text-sm" role="status">
      <ol className="space-y-1">
        {steps.map((t, i) => (
          <li key={t} className={i === at ? "font-medium" : i < at ? "text-ink-3" : "text-ink-3"}>
            {i < at ? "✓" : i === at ? "…" : "·"} {t}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-xs text-ink-3">通常需要 10 到 15 秒（上面的步骤是估计，不是实时进度）。</p>
    </div>
  );
}

// 错误提示：超限或服务不可用时附带静态演示链接
function ErrorNote({ problem, className }: { problem: Problem; className: string }) {
  return (
    <p className={`${className} font-medium text-ink`}>
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
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-3 space-y-2">
        {choices.candidates.map((c) => (
          <li key={c.pick}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(c)}
              className="w-full rounded border px-3 py-2 text-left text-sm hover:bg-paper-2 disabled:opacity-50"
            >
              <span className="font-medium">{c.name}</span>
              <span className="block text-xs text-ink-3">
                {[c.district, c.address].filter(Boolean).join(" · ")}
                {c.type ? `　｜　${c.type}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-3">都不是？请在上面输入更具体的名称（例如加上“西城校区”）后重新分析。</p>
    </section>
  );
}

// 统计结果表格：各类设施的数量与最近设施；教育、医疗、工业可展开子类型，自选统计口径
function StatsTable({
  stats,
  onRefine,
  busy,
  error,
}: {
  stats: SiteStats;
  onRefine: (selection: Record<string, string[]>) => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <section className="mt-6">
      <p className="text-xs tracking-wide text-ink-2">
        {stats.center.address}<span className="block font-mono sm:ml-3 sm:inline">{stats.center.lng.toFixed(6)} E　{stats.center.lat.toFixed(6)} N　R {stats.radius} m</span>
      </p>
      <p className="mt-1 text-xs text-ink-3">如果这不是你要找的地点，请输入更具体的名称重新分析。</p>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-left text-xs text-ink-2">
            <th className="py-2 font-normal">类别</th>
            <th className="whitespace-nowrap px-2 text-right font-normal">数量</th>
            <th className="pl-3 font-normal">最近设施</th>
            <th className="hidden text-right font-normal sm:table-cell">距离</th>
          </tr>
        </thead>
        <tbody>
          {stats.categories.map((c) => (
            <Fragment key={c.key}>
              <tr className={c.subtypes ? "" : "border-b border-hair"}>
                <td className="py-3">{c.label}</td>
                <td className="px-2 text-right font-mono text-2xl leading-none whitespace-nowrap">{c.capped ? `≥${c.count}` : c.count}</td>
                <td className="pr-2 pl-3">
                  {c.nearest?.name ?? "—"}
                  {c.nearest && <span className="block text-xs text-ink-3 sm:hidden">{c.nearest.distanceM} m</span>}
                </td>
                <td className="hidden text-right font-mono whitespace-nowrap sm:table-cell">{c.nearest ? `${c.nearest.distanceM} m` : "—"}</td>
              </tr>
              {c.subtypes && c.selected && (
                <tr className="border-b border-hair">
                  <td colSpan={4} className="pb-3">
                    <SubtypePanel
                      key={`${c.key}:${c.selected.join(",")}`}
                      cat={c}
                      busy={busy}
                      onApply={(sel) => onRefine({ [c.key]: sel })}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {error && <p className="mt-2 text-sm font-medium">✗ {error}</p>}
      <p className="mt-2 text-xs text-ink-3">
        数据来源：{stats.source}，生成于 {new Date(stats.generatedAt).toLocaleString()}。
        数量为高德 POI 点位数，不等于用地性质；地铁按出入口计数；“≥”表示高德返回总数已封顶或没有取全，实际更多。
        教育、医疗、工业已折叠校内院系、院内科室并剔除培训机构、党校、药店等不属于该类别的点位。
      </p>
    </section>
  );
}

// 子类型面板：默认全选（与上面的大类数字一致）；勾选后点“应用口径”，由服务端重算
function SubtypePanel({ cat, busy, onApply }: { cat: CategoryStat; busy: boolean; onApply: (sel: string[]) => void }) {
  const subtypes = cat.subtypes ?? [];
  const selected = cat.selected ?? [];
  const [draft, setDraft] = useState<string[]>(selected);
  const changed = draft.length !== selected.length || draft.some((d) => !selected.includes(d));
  const partial = selected.length < subtypes.length;

  function toggle(name: string) {
    setDraft((d) => (d.includes(name) ? d.filter((x) => x !== name) : [...d, name]));
  }

  return (
    <div className="text-xs text-ink-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {subtypes
          .filter((st) => st.count > 0)
          .map((st) => (
            <span
              key={st.name}
              className={`rounded-full border px-2 py-0.5 ${
                selected.includes(st.name) ? "border-hair" : "border-dashed border-hair opacity-50"
              }`}
            >
              {st.name} {st.count}
            </span>
          ))}
        {subtypes.every((st) => st.count === 0) && <span>无子类型数据</span>}
      </div>
      {partial && <p className="mt-1 font-medium text-ink">当前口径：仅统计 {selected.join("、")}</p>}
    <details className="mt-1">
      <summary className="inline-flex min-h-11 cursor-pointer select-none items-center underline sm:min-h-0">调整统计口径</summary>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {subtypes.map((st) => (
          <label key={st.name} className="flex items-center gap-1">
            <input type="checkbox" checked={draft.includes(st.name)} onChange={() => toggle(st.name)} disabled={busy} />
            {st.name} {st.count}
          </label>
        ))}
        <button
          type="button"
          disabled={busy || !changed || draft.length === 0}
          onClick={() => onApply(draft)}
          className="rounded border px-2 py-0.5 disabled:opacity-40"
        >
          {busy ? "计算中…" : "应用口径"}
        </button>
        {partial && (
          <button type="button" disabled={busy} onClick={() => onApply(subtypes.map((st) => st.name))} className="underline disabled:opacity-40">
            恢复全选
          </button>
        )}
      </div>
      <p className="mt-1 text-ink-3">
        子类型数量按过滤后取到的点位统计{cat.poolTruncated ? "（该类设施很多，只取到距离最近的一部分，子类型数量是下限）" : ""}。
      </p>
    </details>
    </div>
  );
}

// 简报展示：未通过数字校验时显示醒目警告；“## ”开头的行渲染为小标题
function ReportView({ report }: { report: Report }) {
  return (
    <section className="mt-12">
      <div className="flex items-baseline gap-3 border-t-[3px] border-ink pt-3"><span className="font-mono text-xs">正文</span><h2 className="text-sm font-medium tracking-widest">场地分析简报</h2></div>
      {!report.verified && (
        <div className="mt-3 border-2 border-ink p-3 text-sm font-medium">
          ✗ 以下简报有内容未通过校验：{report.violations.join("；")}。这些内容与统计表不符，请勿引用。
        </div>
      )}
      <div className="mt-4 max-w-[42rem] space-y-3 font-serif text-[15px] leading-8">
        {report.text.split("\n").map((line, i) =>
          line.startsWith("## ") ? (
            <h3 key={i} className="pt-4 font-sans text-sm font-medium tracking-widest">
              {line.slice(3)}
            </h3>
          ) : line.trim() ? (
            <p key={i}>{line}</p>
          ) : null,
        )}
      </div>
      <p className="mt-3 text-xs text-ink-3">
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
    <details className="mt-10 text-sm text-ink-2">
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

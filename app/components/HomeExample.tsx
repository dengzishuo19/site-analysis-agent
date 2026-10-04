"use client";

import { useState } from "react";
import examples from "./examples.json";

type Example = (typeof examples)[number];
type Cat = Example["categories"][number];

// 类别的短名：去掉括号里的说明
const short = (label: string) => label.replace(/（.*?）/g, "");

// 主数字后面的量词短语
const UNIT: Record<string, string> = {
  metro: "个地铁出入口",
  bus: "个公交站",
  school: "所学校",
  hospital: "处医疗设施",
  commerce: "处商业设施",
  park: "处公园绿地",
  industry: "处工业设施",
};

// 每个案例的“主数字”：过滤掉噪点最多的类别（最能说明这个项目做了什么）；没有过滤时取地铁
function leadOf(ex: Example): Cat {
  const filtered = [...ex.categories].filter((c) => c.folded > 0).sort((a, b) => b.folded - a.folded);
  return filtered[0] ?? ex.categories.find((c) => c.key === "metro") ?? ex.categories[0];
}

const num = (c: Cat) => (c.capped ? `≥${c.count}` : String(c.count));

// 首页内置示例：不请求任何接口，数据来自导出脚本生成的精简文件；地图是事先生成的高德静态地图（保留彩色底图：水系、绿地是场地分析的重要信息）
export function HomeExample({ onAnalyze, demoUrl, disabled }: { onAnalyze: (address: string) => void; demoUrl: string; disabled: boolean }) {
  const [id, setId] = useState(examples.find((e) => e.id === "bucea")?.id ?? examples[0].id);
  const ex: Example = examples.find((e) => e.id === id) ?? examples[0];
  const lead = leadOf(ex);
  const rest = ex.categories.filter((c) => c.key !== lead.key);

  return (
    <section className="mt-14" aria-labelledby="example-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t-[3px] border-ink pt-3">
        <h2 id="example-title" className="text-sm font-medium tracking-widest">
          示例
        </h2>
        <span className="text-xs text-ink-3">事先生成好的结果，切换不需要等待</span>
      </div>

      <div role="tablist" aria-label="示例案例" className="mt-3 flex flex-wrap gap-x-5 text-sm">
        {examples.map((e) => (
          <button
            key={e.id}
            type="button"
            role="tab"
            aria-selected={e.id === id}
            onClick={() => setId(e.id)}
            className={`min-h-11 border-b-2 ${e.id === id ? "border-ink text-ink" : "border-transparent text-ink-3"}`}
          >
            {e.title}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_1.35fr]">
        <div className="min-w-0">
          <p className="text-xs tracking-wide text-ink-3">
            {ex.title} · {ex.tag}
          </p>
          <div className="mt-3 font-mono text-7xl leading-none font-medium tracking-tight sm:text-8xl">{num(lead)}</div>
          <p className="mt-2 text-base">{UNIT[lead.key] ?? short(lead.label)}在 1 km 内</p>
          {lead.folded > 0 && <p className="mt-1 text-xs text-ink-2">另有 {lead.folded} 个噪点已过滤（如校内院系、院内科室、不属于该类的点位）</p>}

          <ul className="mt-6 grid grid-cols-3 border-t border-ink">
            {rest.map((c, i) => (
              <li key={c.key} className={`py-3 pr-2 ${i % 3 ? "border-l border-hair pl-3" : ""} ${i >= 3 ? "border-t border-hair" : ""}`}>
                <div className="font-mono text-2xl leading-none">{num(c)}</div>
                <div className="mt-1 text-xs text-ink-2">{short(c.label)}</div>
              </li>
            ))}
          </ul>
        </div>

        <figure className="min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- 静态示例图，尺寸已知，不需要 next/image 的优化管线 */}
          <img
            src={`/examples/${ex.id}.png`}
            alt={`${ex.title}周边设施地图（示例）`}
            width={1000}
            height={640}
            className="aspect-[25/16] w-full border border-hair object-cover dark:brightness-90"
          />
          <figcaption className="mt-2 text-xs text-ink-2">
            <span className="mr-2 font-mono">图 1</span>
            {ex.title}周边设施分布（示例）。圆为 1 km 检索范围；底图的蓝色为水系、绿色为绿地。
          </figcaption>
        </figure>
      </div>

      <div className="mt-8 grid gap-6 border-t border-ink pt-4 lg:grid-cols-[1fr_2.2fr]">
        <div className="text-sm font-medium">简报节选</div>
        <div>
          <p className="font-serif text-[15px] leading-8">{ex.excerpt}</p>
          <p className="mt-3 text-xs text-ink-2">
            {ex.verified && <span className="mr-3">✓ 数字与设施名已由代码逐条校验</span>}
            示例生成于 {new Date(ex.generatedAt).toLocaleDateString("zh-CN")}，不随高德数据实时更新。
          </p>
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <button type="button" disabled={disabled} onClick={() => onAnalyze(ex.address)} className="min-h-11 border-b border-ink disabled:opacity-50">
              用这个地址实际分析（约 10 秒）→
            </button>
            <a href={demoUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center border-b border-hair text-ink-2">
              查看完整静态演示 ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

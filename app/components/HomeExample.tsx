"use client";

import { useState } from "react";
import examples from "./examples.json";

type Example = (typeof examples)[number];

// 类别的短名：去掉括号里的说明，磁贴放得下
const short = (label: string) => label.replace(/（.*?）/g, "");

// 首页内置示例：不请求任何接口，数据来自导出脚本生成的精简文件（数量、最近设施、简报摘要）
export function HomeExample({ onAnalyze, demoUrl, disabled }: { onAnalyze: (address: string) => void; demoUrl: string; disabled: boolean }) {
  const [id, setId] = useState(examples[0].id);
  const ex: Example = examples.find((e) => e.id === id) ?? examples[0];

  return (
    <section className="mt-8" aria-labelledby="example-title">
      <h2 id="example-title" className="text-lg font-semibold">
        先看一个示例
      </h2>
      <p className="mt-1 text-xs text-gray-500">下面是事先生成好的结果，点击切换，不需要等待。</p>

      <div role="tablist" aria-label="示例案例" className="mt-3 flex flex-wrap gap-2">
        {examples.map((e) => (
          <button
            key={e.id}
            type="button"
            role="tab"
            aria-selected={e.id === id}
            onClick={() => setId(e.id)}
            className={`min-h-11 rounded-full border px-4 text-sm ${
              e.id === id ? "border-transparent bg-black text-white dark:bg-white dark:text-black" : "border-gray-300 dark:border-gray-700"
            }`}
          >
            {e.title}
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm">
        <span className="font-medium">{ex.title}</span>
        <span className="ml-2 text-gray-500">{ex.tag}</span>
      </p>

      <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ex.categories.map((c) => (
          <li key={c.key} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="text-xs text-gray-500">{short(c.label)}</div>
            <div className="mt-0.5 text-2xl font-semibold tabular-nums">{c.capped ? `≥${c.count}` : c.count}</div>
            <div className="mt-1 truncate text-xs text-gray-500" title={c.nearest ? `${c.nearest.name}（${c.nearest.distanceM} m）` : ""}>
              {c.nearest ? `${c.nearest.name} ${c.nearest.distanceM} m` : "范围内未检索到"}
            </div>
            {c.folded > 0 && <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">已过滤 {c.folded} 个噪点</div>}
          </li>
        ))}
      </ul>

      <blockquote className="mt-3 rounded-lg border-l-4 border-gray-300 bg-gray-50 p-3 text-sm leading-relaxed dark:border-gray-600 dark:bg-gray-900">
        <p>{ex.excerpt}</p>
        <p className="mt-2 text-xs">
          {ex.verified ? (
            <span className="rounded bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-950 dark:text-green-300">✓ 简报中的数字与设施名已由代码逐条校验</span>
          ) : null}
          <span className="ml-2 text-gray-500">以上为简报节选。示例数据生成于 {new Date(ex.generatedAt).toLocaleDateString("zh-CN")}，不会随高德数据实时更新。</span>
        </p>
      </blockquote>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAnalyze(ex.address)}
          className="min-h-11 rounded bg-black px-4 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          用这个地址实际分析（约 10 秒）
        </button>
        <a
          href={demoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center justify-center rounded border border-gray-300 px-4 text-sm dark:border-gray-700"
        >
          查看完整静态演示
        </a>
      </div>
    </section>
  );
}

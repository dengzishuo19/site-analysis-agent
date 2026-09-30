"use client";

import { useEffect, useRef } from "react";
import { renderBarChart, renderFamilyKey } from "@/lib/chart-html";
import { countRows, distanceRows } from "@/lib/chart-model";
import { buildMapModel, type VizStats } from "@/lib/map-model";
import { mountSiteMap } from "@/lib/site-map";
import { VIZ_CSS } from "@/lib/viz-css";

export type { VizStats };

// 可视化样式（色板变量与组件样式，来自共享模块）
export function VizStyles() {
  return <style dangerouslySetInnerHTML={{ __html: VIZ_CSS }} />;
}

// 交互地图：把命令式的地图组件挂到一个 div 上，统计数据变化时重新挂载
export function SiteMap({ stats }: { stats: VizStats }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const handle = mountSiteMap(ref.current, buildMapModel(stats), {
      key: process.env.NEXT_PUBLIC_AMAP_JS_KEY,
      dark,
    });
    return () => handle.destroy();
  }, [stats]);

  return <div ref={ref} />;
}

// 两张条形图与类型族说明（HTML 由共享的纯函数生成，设施名已转义）
export function BarCharts({ stats }: { stats: VizStats }) {
  const html =
    renderBarChart({
      title: "各类设施数量",
      note: "“≥”表示高德返回总数已封顶，实际更多；条形长度相对最大的一类。",
      rows: countRows(stats),
    }) +
    renderBarChart({
      title: "最近设施距离",
      note: "条形越短越近；长度相对检索半径。",
      rows: distanceRows(stats),
    }) +
    renderFamilyKey();
  return <div className="viz space-y-6" dangerouslySetInnerHTML={{ __html: html }} />;
}

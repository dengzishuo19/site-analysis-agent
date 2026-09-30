// 条形图的 HTML 渲染：纯函数，返回字符串；应用与静态演示页共用同一份
import { CATEGORIES, FAMILIES, FAMILY_ORDER } from "./palette.ts";
import type { BarRow } from "./chart-model.ts";

// 转义 HTML 特殊字符（设施名来自第三方数据，必须转义）
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

// 渲染一张横向条形图；每行都可聚焦，悬停或聚焦时显示提示
export function renderBarChart(opts: { title: string; note?: string; rows: BarRow[] }): string {
  const rows = opts.rows
    .map(
      (r) =>
        `<li class="viz-row${r.empty ? " is-empty" : ""}" data-fam="${r.family}" tabindex="0" aria-label="${escapeHtml(r.tip)}">` +
        `<span class="viz-badge" aria-hidden="true">${escapeHtml(r.glyph)}</span>` +
        `<span class="viz-label">${escapeHtml(r.label)}</span>` +
        `<span class="viz-track"><span class="viz-bar${r.faded ? " is-faded" : ""}" style="width:${r.pct}%"></span></span>` +
        `<span class="viz-value">${escapeHtml(r.valueText)}</span>` +
        `<span class="viz-tip" role="tooltip">${escapeHtml(r.tip)}</span>` +
        `</li>`,
    )
    .join("");
  const note = opts.note ? `<p class="viz-note">${escapeHtml(opts.note)}</p>` : "";
  return `<figure class="viz-chart"><figcaption class="viz-title">${escapeHtml(opts.title)}</figcaption><ol class="viz-rows">${rows}</ol>${note}</figure>`;
}

// 渲染类型族说明：颜色表示类型族，单字表示具体类别
export function renderFamilyKey(): string {
  const items = FAMILY_ORDER.map((key) => {
    const glyphs = Object.values(CATEGORIES)
      .filter((c) => c.family === key)
      .map((c) => c.glyph)
      .join(" ");
    return `<li data-fam="${key}"><span class="viz-swatch" aria-hidden="true"></span>${escapeHtml(FAMILIES[key].label)}（${escapeHtml(glyphs)}）</li>`;
  }).join("");
  return `<ul class="viz-key" aria-label="颜色表示类型族，单字表示具体类别">${items}</ul>`;
}

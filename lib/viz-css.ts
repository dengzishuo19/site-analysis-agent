// 可视化样式：色板变量 + 图表与地图组件样式；应用与静态演示页共用同一份
import { FAMILY_ORDER, paletteCss } from "./palette.ts";

// 每个类型族把自己的颜色绑定到 --c / --c-ink，组件只引用这两个变量
const familyBindings = FAMILY_ORDER.map(
  (k) => `[data-fam="${k}"]{--c:var(--fam-${k});--c-ink:var(--fam-${k}-ink)}`,
).join("\n");

const componentCss = `
.viz{color:var(--viz-ink);font-size:14px;line-height:1.5}
.viz-title{font-weight:600;font-size:14px;margin:0 0 8px}
.viz-chart{margin:0}
.viz-rows{list-style:none;margin:0;padding:0}
.viz-row{position:relative;display:grid;grid-template-columns:22px minmax(84px,190px) 1fr auto;gap:8px;align-items:center;padding:3px 0;outline-offset:2px;border-radius:4px}
.viz-badge{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font:700 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--c);color:var(--c-ink);box-shadow:0 0 0 2px var(--viz-surface)}
.viz-label{color:var(--viz-ink-2)}
.viz-track{height:16px;border-left:1px solid var(--viz-axis)}
.viz-bar{display:block;height:16px;min-width:3px;background:var(--c);border-radius:0 4px 4px 0}
.viz-bar.is-faded{-webkit-mask-image:linear-gradient(90deg,#000 72%,transparent);mask-image:linear-gradient(90deg,#000 72%,transparent)}
.viz-row.is-empty .viz-bar{display:none}
.viz-value{color:var(--viz-ink);font-variant-numeric:tabular-nums;text-align:right;min-width:56px}
.viz-tip{display:none;position:absolute;right:0;top:100%;z-index:5;max-width:100%;padding:4px 8px;border-radius:6px;background:var(--viz-ink);color:var(--viz-surface);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.viz-row:hover .viz-tip,.viz-row:focus .viz-tip{display:block}
.viz-note{margin:6px 0 0;color:var(--viz-muted);font-size:12px}
.viz-key{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px 16px;color:var(--viz-ink-2);font-size:13px}
.viz-swatch{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:50%;background:var(--c)}
.viz-legend{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.viz-legend button{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 3px;border:1px solid var(--viz-grid);border-radius:999px;background:transparent;color:var(--viz-ink-2);font:inherit;font-size:13px;cursor:pointer}
.viz-legend button[aria-pressed="false"]{opacity:.5;text-decoration:line-through}
@media (max-width:640px){.viz-legend button{min-height:44px;padding-right:14px}.viz-row{grid-template-columns:22px minmax(64px,120px) 1fr auto}}
.viz-legend button:disabled{opacity:.35;cursor:not-allowed;text-decoration:none}
.viz-legend button:focus-visible{outline:2px solid var(--viz-ink);outline-offset:2px}
.viz-map-box{position:relative;height:420px;border:1px solid var(--viz-grid);border-radius:10px;overflow:hidden;background:var(--viz-grid)}
@media (max-width:600px){.viz-map-box{height:340px}}
.viz-map-canvas{position:absolute;inset:0}
.viz-map-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.viz-status{position:absolute;left:8px;bottom:26px;z-index:10;padding:3px 8px;border-radius:6px;background:var(--viz-surface);color:var(--viz-ink-2);font-size:12px;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.viz-status:empty{display:none}
.viz-status.is-center{left:50%;top:50%;bottom:auto;transform:translate(-50%,-50%);width:max-content;max-width:86%;text-align:center;white-space:normal}
.viz-pin{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font:700 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--c);color:var(--c-ink);border:2px solid var(--viz-surface);box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:pointer;box-sizing:border-box}
.viz-center{width:16px;height:16px;border-radius:50%;background:var(--viz-ink);border:3px solid var(--viz-surface);box-shadow:0 1px 3px rgba(0,0,0,.5);box-sizing:border-box}
.viz-info{padding:2px 4px;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0b0b0b}
.viz-info strong{display:block}
`;

// 完整的可视化样式表
export const VIZ_CSS = `${paletteCss()}\n${familyBindings}\n${componentCss}`;

// 设施类别的简笔画图标：24×24 网格、线条描边、颜色跟随文字颜色（currentColor），浅色与深色主题自动适配。
// 图标是本文件里的固定字符串，不含任何外部数据，可以安全地插入 HTML。
export const ICON_PATHS: Record<string, string> = {
  // 地铁：车头正面，两扇车窗，两条轨道脚
  metro: "M7 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M5 10h14 M8.5 13.5h.01 M15.5 13.5h.01 M8 17l-2 4 M16 17l2 4",
  // 公交：车身侧面，车窗与两个车轮
  bus: "M3 7a2 2 0 0 1 2-2h12.5l3.5 5v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z M3 11h18 M8 5v6 M13 5v6 M7 19.5a1.5 1.5 0 1 0 0-.01 M17 19.5a1.5 1.5 0 1 0 0-.01",
  // 教育：翻开的书
  school: "M3 6c3-1.5 6-1.5 9 0v13c-3-1.5-6-1.5-9 0z M21 6c-3-1.5-6-1.5-9 0v13c3-1.5 6-1.5 9 0z",
  // 医疗：方框里的十字
  hospital: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M12 8v8 M8 12h8",
  // 商业：购物袋
  commerce: "M5 8h14l-1.2 12H6.2z M9 10V7a3 3 0 0 1 6 0v3",
  // 公园绿地：一棵树
  park: "M12 3l5 7h-3l4 6H6l4-6H7z M12 16v5",
  // 工业：锯齿屋顶的厂房与烟囱
  industry: "M3 21h18 M4 21V11l5 3v-3l5 3v-3l5 3V4h2v17",
};

// 返回某类别图标的 SVG 字符串（未知类别返回空字符串）
export function iconSvg(key: string, size = 16): string {
  const d = ICON_PATHS[key];
  if (!d) return "";
  return `<svg class="viz-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

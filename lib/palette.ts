// 共享色板与配色规则：应用、地图、条形图、静态演示页共用。只有常量与纯函数，不 import 任何模块。
//
// 配色依据 dataviz 技能：该色板里最多只有 4 种颜色能同时通过“全配对”检查（蓝、黄、洋红、绿），
// 而我们有 7 个类别，所以采用复合编码——颜色表示类型族（4 种），单字表示具体类别。

export type Mode = "light" | "dark";
export type FamilyKey = "transit" | "services" | "green" | "industry";
export type CategoryStyle = { family: FamilyKey; glyph: string };

// 图表表面色
export const SURFACE: Record<Mode, string> = { light: "#fcfcfb", dark: "#1a1a19" };

// 文字与线条的墨色（文字一律用这些，不用系列色）
export const INK: Record<Mode, { primary: string; secondary: string; muted: string; grid: string; axis: string }> = {
  light: { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7" },
  dark: { primary: "#ffffff", secondary: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", axis: "#383835" },
};

// 类型族：颜色（浅色/深色各一档，取自 dataviz 参考色板的蓝、洋红、绿、黄）
// 浅色的蓝用色阶第 500 档（#256abf）而非默认档（#2a78d6），使标记上的白字对比度达到 4.5:1 以上；
// 已用校验器验证：浅色下四色全配对通过；深色下最差色盲配对 6.9（6 到 8 的警告区间），由单字与图例作为第二编码
export const FAMILIES: Record<FamilyKey, { label: string; light: string; dark: string }> = {
  transit: { label: "交通", light: "#256abf", dark: "#3987e5" },
  services: { label: "生活服务", light: "#e87ba4", dark: "#d55181" },
  green: { label: "公园绿地", light: "#008300", dark: "#008300" },
  industry: { label: "工业", light: "#eda100", dark: "#c98500" },
};

// 类型族的固定顺序
export const FAMILY_ORDER: FamilyKey[] = ["transit", "services", "green", "industry"];

// 类别（与 lib/stats.ts 的 key 对应）所属的类型族与单字标记
export const CATEGORIES: Record<string, CategoryStyle> = {
  metro: { family: "transit", glyph: "地" },
  bus: { family: "transit", glyph: "公" },
  school: { family: "services", glyph: "教" },
  hospital: { family: "services", glyph: "医" },
  commerce: { family: "services", glyph: "商" },
  park: { family: "green", glyph: "园" },
  industry: { family: "industry", glyph: "工" },
};

// 单个色彩通道的线性化值
function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

// 颜色的相对亮度（WCAG）
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

// 两种颜色的对比度（WCAG，1 到 21）
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// 在某个填充色上使用的字色：深墨或白，取对比度更高者
export function inkOn(fill: string): string {
  return contrast(fill, "#0b0b0b") >= contrast(fill, "#ffffff") ? "#0b0b0b" : "#ffffff";
}

// 某类型族在某模式下的颜色
export function familyColor(family: FamilyKey, mode: Mode): string {
  return FAMILIES[family][mode];
}

// 某模式下的一整组 CSS 变量声明
function varsFor(mode: Mode): string {
  const ink = INK[mode];
  const parts = [
    `--viz-surface:${SURFACE[mode]}`,
    `--viz-ink:${ink.primary}`,
    `--viz-ink-2:${ink.secondary}`,
    `--viz-muted:${ink.muted}`,
    `--viz-grid:${ink.grid}`,
    `--viz-axis:${ink.axis}`,
  ];
  for (const key of FAMILY_ORDER) {
    const fill = familyColor(key, mode);
    parts.push(`--fam-${key}:${fill}`, `--fam-${key}-ink:${inkOn(fill)}`);
  }
  return parts.join(";");
}

// 生成浅色/深色两套 CSS 变量（深色同时支持系统设置与 data-theme 手动切换）
export function paletteCss(): string {
  return [
    `:root{${varsFor("light")}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${varsFor("dark")}}}`,
    `:root[data-theme="dark"]{${varsFor("dark")}}`,
  ].join("\n");
}

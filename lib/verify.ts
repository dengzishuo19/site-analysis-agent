// 简报校验：纯函数，不依赖任何项目模块，由代码（而非大模型）裁决简报内容是否合规
//
// 三层检查：
//   1. 名称存在：每个「名称」必须是统计数据里的设施
//   2. 断言配对：「名称」后的距离必须属于该设施；“类别 + 数字 + 处”的数字必须是该类别的数量
//   3. 数字兜底：其余数字必须至少出现在统计数据里
// 校验器只认得上述句式；认不出的数字只计入覆盖率（coverage），不判违规。

// 校验所需的最小数据结构（与 SiteStats 兼容）
export type VerifiableStats = {
  center: { lng: number; lat: number };
  radius: number;
  categories: {
    label: string;
    count: number;
    nearest: { name: string; distanceM: number } | null;
    items: { name: string; distanceM: number }[];
  }[];
};

export type IssueKind = "empty" | "unknown-number" | "unknown-name" | "distance-mismatch" | "count-mismatch";
export type Span = [number, number]; // 在原文中的 [起, 止) 下标

export type Issue = { kind: IssueKind; text: string; expected?: string; span: Span };
export type Coverage = { numbers: number; bound: number; unbound: { text: string; span: Span }[] };
export type VerifyResult = { ok: boolean; violations: string[]; issues: Issue[]; coverage: Coverage };

type NumberToken = { value: string; num: number; start: number; end: number };
type Binding = { ok: boolean };

const MASK = "〓"; // 占位符：把「」内的名称遮住，保持下标不变
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?!\d)(?:\.\d+)?|\d+(?:\.\d+)?`; // 数字（含千位分隔符）
const COUNT_UNIT = "[处个家座]";
const DISTANCE_GAP = 12; // 「名称」与其距离之间最多相隔的字符数
const COUNT_GAP = 12; // 类别名与其数量之间最多相隔的字符数

// 把「」内的内容替换成等长占位符（括号保留），使后续匹配的下标与原文一致
function maskNames(text: string): string {
  return text.replace(/「([^」]*)」/g, (_m, inner: string) => `「${MASK.repeat(inner.length)}」`);
}

// 提取文本中的全部数字及其位置（在已遮住名称的文本上进行）
function tokenize(masked: string): NumberToken[] {
  return [...masked.matchAll(new RegExp(NUM, "g"))].map((m) => {
    const value = m[0].replace(/,/g, "");
    const start = m.index as number;
    return { value, num: Number(value), start, end: start + m[0].length };
  });
}

// 提取文本中的全部数字（「」内的设施名称不参与，千位分隔符会被去掉）
export function extractNumbers(text: string): string[] {
  return tokenize(maskNames(text)).map((t) => t.value);
}

// 收集统计数据中允许出现的全部数字
export function allowedNumbers(stats: VerifiableStats): Set<number> {
  const allowed = new Set<number>([stats.radius, stats.radius / 1000, stats.center.lng, stats.center.lat]);
  for (const c of stats.categories) {
    allowed.add(c.count);
    if (c.nearest) allowed.add(c.nearest.distanceM);
    for (const item of c.items) allowed.add(item.distanceM);
  }
  return allowed;
}

// 旧版校验（仅检查数字是否出现在统计数据里），保留用于对比测试
export function verifyNumbersOnly(text: string, stats: VerifiableStats): { ok: boolean; violations: string[] } {
  if (!text.trim()) return { ok: false, violations: ["简报内容为空"] };
  const allowed = allowedNumbers(stats);
  const violations = [...new Set(extractNumbers(text).filter((n) => !allowed.has(Number(n))))];
  return { ok: violations.length === 0, violations };
}

// 转义正则特殊字符
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 类别的可识别称呼：完整标签、去掉括号后的简称、再去掉“出入口”后缀的称呼
function aliasesOf(label: string): string[] {
  const base = label.split("（")[0];
  const set = new Set([label, base]);
  if (base.endsWith("出入口")) set.add(base.slice(0, -3));
  return [...set].filter((a) => a.length >= 2);
}

// 设施名称到其全部距离的映射
function distancesByName(stats: VerifiableStats): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const add = (name: string, d: number) => {
    const list = map.get(name) ?? [];
    if (!list.includes(d)) list.push(d);
    map.set(name, list);
  };
  for (const c of stats.categories) {
    for (const item of c.items) add(item.name, item.distanceM);
    if (c.nearest) add(c.nearest.name, c.nearest.distanceM);
  }
  return map;
}

// 人可读的违规描述
function describe(issue: Issue): string {
  switch (issue.kind) {
    case "unknown-name":
      return `${issue.text}（数据中无此设施）`;
    case "distance-mismatch":
    case "count-mismatch":
      return `${issue.text}（数据中为 ${issue.expected}）`;
    default:
      return issue.text;
  }
}

// 校验简报：名称是否存在、断言是否配对、数字是否在统计数据里；同时统计有多少数字被配对校验过
export function verifyReport(text: string, stats: VerifiableStats): VerifyResult {
  if (!text.trim()) {
    const issue: Issue = { kind: "empty", text: "简报内容为空", span: [0, 0] };
    return { ok: false, violations: [issue.text], issues: [issue], coverage: { numbers: 0, bound: 0, unbound: [] } };
  }

  const masked = maskNames(text);
  const tokens = tokenize(masked);
  const allowed = allowedNumbers(stats);
  const issues: Issue[] = [];
  const bound = new Map<number, Binding>(); // 以数字起点为键

  // —— 1) 名称存在 + 名称—距离配对 ——
  const byName = distancesByName(stats);
  for (const m of text.matchAll(/「([^」]*)」/g)) {
    const name = m[1];
    const from = (m.index as number) + m[0].length;
    const dists = byName.get(name);
    if (!dists) {
      issues.push({ kind: "unknown-name", text: `「${name}」`, span: [m.index as number, from] });
      continue;
    }
    // 该名称之后、下一个「或句末之前的片段，取其中第一个“数字 + m”作为它的距离
    let to = from;
    while (to < masked.length && !"「。；！？\n".includes(masked[to])) to++;
    const seg = masked.slice(from, to);
    const first = tokenize(seg)[0];
    if (!first || first.start > DISTANCE_GAP) continue;
    if (seg.slice(0, first.start).includes("半径")) continue; // “以「X」为中心，半径 1000 m”里的数字是半径，不是距离
    if (!/^\s*(?:m|米)(?![A-Za-z])/.test(seg.slice(first.end))) continue;

    const start = from + first.start;
    const ok = dists.includes(first.num);
    bound.set(start, { ok });
    if (!ok) {
      issues.push({
        kind: "distance-mismatch",
        text: `「${name}」距离 ${first.value} m`,
        expected: `${dists.join(" 或 ")} m`,
        span: [start, from + first.end],
      });
    }
  }

  // —— 2) 类别—数量配对 ——
  const aliasToCat = new Map<string, number>();
  stats.categories.forEach((c, i) => aliasesOf(c.label).forEach((a) => aliasToCat.set(a, i)));
  const aliasAlt = [...aliasToCat.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  if (aliasAlt) {
    const forward = new RegExp(
      String.raw`(${aliasAlt})((?:(?!${aliasAlt})[^\d「」。；！？\n]){0,${COUNT_GAP}}?)(${NUM})\s*${COUNT_UNIT}`,
      "g",
    );
    const backward = new RegExp(String.raw`(${NUM})\s*${COUNT_UNIT}\s*(?:的)?(${aliasAlt})`, "g");

    const bindCount = (alias: string, valueText: string, numStart: number, matchStart: number, matchEnd: number) => {
      if (bound.has(numStart)) return;
      const cat = stats.categories[aliasToCat.get(alias) as number];
      const value = Number(valueText.replace(/,/g, ""));
      const ok = value === cat.count;
      bound.set(numStart, { ok });
      if (!ok) {
        issues.push({
          kind: "count-mismatch",
          text: text.slice(matchStart, matchEnd),
          expected: `${cat.count} 处`,
          span: [numStart, numStart + valueText.length],
        });
      }
    };

    for (const m of masked.matchAll(forward)) {
      const numStart = (m.index as number) + m[1].length + m[2].length;
      bindCount(m[1], m[3], numStart, m.index as number, (m.index as number) + m[0].length);
    }
    for (const m of masked.matchAll(backward)) {
      bindCount(m[2], m[1], m.index as number, m.index as number, (m.index as number) + m[0].length);
    }
  }

  // —— 3) 半径视为已绑定；其余数字兜底检查 ——
  for (const t of tokens) {
    if (bound.has(t.start)) continue;
    const isRadius = t.num === stats.radius || t.num === stats.radius / 1000;
    if (isRadius && /^\s*(?:m|米|km|公里|千米)/i.test(masked.slice(t.end, t.end + 4))) {
      bound.set(t.start, { ok: true });
    }
  }
  for (const t of tokens) {
    const b = bound.get(t.start);
    if (b) continue; // 已配对校验过（通过或已作为配对违规报告）
    if (!allowed.has(t.num)) issues.push({ kind: "unknown-number", text: t.value, span: [t.start, t.end] });
  }

  issues.sort((a, b) => a.span[0] - b.span[0]);
  const unbound = tokens
    .filter((t) => !bound.has(t.start))
    .map((t) => ({ text: t.value, span: [t.start, t.end] as Span }));

  return {
    ok: issues.length === 0,
    violations: [...new Set(issues.map(describe))],
    issues,
    coverage: { numbers: tokens.length, bound: tokens.length - unbound.length, unbound },
  };
}

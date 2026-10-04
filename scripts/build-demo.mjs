// 构建静态演示页：把案例数据、可视化模块与样式嵌入 demo/template.html，输出 docs/index.html
// 用法：node --env-file=.env.local scripts/build-demo.mjs [--repo <GitHub 仓库地址>] [--live <在线体验版地址>]
// 高德 Web 端（JS API）Key 从环境变量 DEMO_AMAP_JS_KEY（或 NEXT_PUBLIC_AMAP_JS_KEY）读取；未设置时演示页只显示地图截图。
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { VIZ_CSS } from "../lib/viz-css.ts";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : "";
};
const repo = opt("repo");
const live = opt("live");
const mapKey = process.env.DEMO_AMAP_JS_KEY || process.env.NEXT_PUBLIC_AMAP_JS_KEY || "";
// 必须与高德控制台里该 Key 的域名白名单一致；只有在这些域名下才加载交互地图，其余情况显示截图
const mapHosts = (process.env.DEMO_MAP_HOSTS || "127.0.0.1,dengzishuo19.github.io,site-analysis-agent-m6lm-livid.vercel.app")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const cases = JSON.parse(fs.readFileSync("demo-data/cases.json", "utf8"));
const bad = cases.filter((c) => !c.report.verified);
if (bad.length) throw new Error(`以下案例未通过校验，不能用于演示：${bad.map((c) => c.title).join("、")}`);

// 嵌入 <script> 的 JSON 需转义：把 < 与行分隔符换成 \uXXXX 形式，避免提前闭合标签
const BS = String.fromCharCode(92); // 反斜杠
const json = JSON.stringify(cases)
  .replaceAll("<", BS + "u003c")
  .replaceAll(String.fromCharCode(0x2028), BS + "u2028")
  .replaceAll(String.fromCharCode(0x2029), BS + "u2029");

// 把 lib/ 里的可视化模块转成浏览器可直接运行的脚本：去掉类型、import 与 export，按依赖顺序拼接（与应用共用同一份源码）
const MODULES = ["palette", "map-model", "map-cluster", "chart-model", "chart-html", "site-map"];
const vizBundle = MODULES.map((name) => {
  const js = stripTypeScriptTypes(fs.readFileSync(`lib/${name}.ts`, "utf8"));
  return js
    .split("\n")
    .filter((line) => !/^import\s/.test(line))
    .map((line) => line.replace(/^export\s+(?=(const|function|let|class|async)\b)/, ""))
    .join("\n");
}).join("\n");
if (/^(import|export)\s/m.test(vizBundle)) throw new Error("可视化脚本中残留 import/export，请检查转译结果");
if (vizBundle.includes("</script")) throw new Error("可视化脚本中含有 </script，无法安全嵌入");

const link = (label, url) =>
  url ? `<a href="${url}" target="_blank" rel="noopener">${label}</a>` : `<span class="soon">${label}（即将上线）</span>`;
const links = [link("GitHub 仓库", repo), link("在线体验版（可输入任意北京地址）", live)].join("\n    ");

const html = fs
  .readFileSync("demo/template.html", "utf8")
  .replace("/*__VIZ_CSS__*/", () => VIZ_CSS)
  .replace("/*__VIZ__*/", () => vizBundle)
  .replace("/*__MAP_KEY__*/null", () => JSON.stringify(mapKey))
  .replace("/*__MAP_HOSTS__*/null", () => JSON.stringify(mapHosts))
  .replace("/*__DATA__*/null", () => json)
  .replace("__LINKS__", () => links);

fs.writeFileSync("docs/index.html", html, "utf8");
console.log(`已生成 docs/index.html（${(Buffer.byteLength(html) / 1024).toFixed(0)} KB），地图 Key：${mapKey ? "已嵌入（长度 " + mapKey.length + "）" : "未设置，只显示截图"}`);

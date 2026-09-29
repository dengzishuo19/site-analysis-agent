// 构建静态演示页：把 demo-data/cases.json 嵌入 demo/template.html，输出 docs/index.html
// 用法：node scripts/build-demo.mjs [--repo <GitHub 仓库地址>] [--live <在线体验版地址>]
import fs from "node:fs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : "";
};
const repo = opt("repo");
const live = opt("live");

const cases = JSON.parse(fs.readFileSync("demo-data/cases.json", "utf8"));
const bad = cases.filter((c) => !c.report.verified);
if (bad.length) throw new Error(`以下案例未通过校验，不能用于演示：${bad.map((c) => c.title).join("、")}`);

// 嵌入 <script> 的 JSON 需转义：把 < 与行分隔符换成 \uXXXX 形式，避免提前闭合标签
const BS = String.fromCharCode(92); // 反斜杠
const json = JSON.stringify(cases)
  .replaceAll("<", BS + "u003c")
  .replaceAll(String.fromCharCode(0x2028), BS + "u2028")
  .replaceAll(String.fromCharCode(0x2029), BS + "u2029");

const link = (label, url) =>
  url ? `<a href="${url}" target="_blank" rel="noopener">${label}</a>` : `<span class="soon">${label}（即将上线）</span>`;
const links = [link("GitHub 仓库", repo), link("在线体验版（可输入地址）", live)].join("\n    ");

const html = fs
  .readFileSync("demo/template.html", "utf8")
  .replace("/*__DATA__*/null", () => json)
  .replace("__LINKS__", () => links);

fs.writeFileSync("docs/index.html", html, "utf8");
console.log(`已生成 docs/index.html（${(Buffer.byteLength(html) / 1024).toFixed(0)} KB）`);

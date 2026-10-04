// 导出演示数据：调用本机运行中的 /api/site 与 /api/report，为四个案例生成 demo-data/cases.json
// 用法：先 npm run build && npm run start -- -p 3100，再 node scripts/export-demo-data.mjs
import fs from "node:fs";

const BASE = process.env.DEMO_BASE ?? "http://localhost:3100";

const CASES = [
  { id: "guomao", title: "国贸", tag: "成熟城区", address: "北京市朝阳区国贸地铁站" },
  { id: "shougang", title: "首钢园", tag: "工业遗存改造", address: "北京市石景山区首钢园" },
  { id: "yizhuang", title: "亦庄", tag: "产业园区", address: "北京市大兴区亦庄经济技术开发区" },
  // 校园案例：最能展示噪点过滤与子类型分解。用该校的正式地址“展览路1号”：直接写校名时高德会定位到校区东门，最近设施会变成校内点位
  { id: "bucea", title: "北京建筑大学西城校区", tag: "校园（噪点过滤）", address: "北京市西城区展览路1号" },
  { id: "badaling", title: "八达岭", tag: "偏远景区", address: "北京市延庆区八达岭长城" },
];

const out = [];
for (const c of CASES) {
  let sr = await fetch(`${BASE}/api/site?address=${encodeURIComponent(c.address)}`);
  let stats = await sr.json();
  if (sr.ok && stats.kind === "choose") {
    // 定位含糊时服务器返回候选：演示数据固定选第一个，保证重新导出的结果可复现
    const chosen = stats.candidates.find((x) => x.name === c.pickName) ?? stats.candidates[0];
    console.log(`${c.title}: 有 ${stats.candidates.length} 个候选，选「${chosen.name}」`);
    sr = await fetch(`${BASE}/api/site?pick=${encodeURIComponent(chosen.pick)}`);
    stats = await sr.json();
  }
  if (!sr.ok) throw new Error(`${c.title} 统计失败：${stats.error}`);

  const rr = await fetch(`${BASE}/api/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stats }),
  });
  const report = await rr.json();
  if (!rr.ok) throw new Error(`${c.title} 简报失败：${report.error}`);

  // 去掉签名字段；设施保留名称、距离与坐标（地图标记需要坐标，均为高德公开的 POI 数据）
  delete stats.signature;
  delete stats.expiresAt;
  stats.categories = stats.categories.map(({ pool, poolTruncated, base, ...cat }) => ({
    // 点位池只用于线上版的勾选重算，静态演示页不需要，去掉以减小体积；保留子类型分布供只读展示
    ...cat,
    nearest: cat.nearest && { name: cat.nearest.name, distanceM: cat.nearest.distanceM },
    items: cat.items.map((p) => ({ name: p.name, distanceM: p.distanceM, lng: p.lng, lat: p.lat })),
  }));

  console.log(`${c.title}: verified=${report.verified} attempts=${report.attempts}`);
  out.push({ ...c, stats, report });
}

// 在线版首页的示例：只留数量、最近设施与简报摘要（不含坐标和完整简报），避免首页脚本变大
// 摘要优先取“公共服务与商业”小节的第一段（有具体设施与数字），没有则取第一段正文；过长则在句号处截断
function excerpt(text) {
  const lines = text.split(String.fromCharCode(10)).map((l) => l.trim());
  const body = (from) => {
    const k = lines.findIndex((l) => l.startsWith("## ") && l.includes(from));
    if (k < 0) return "";
    for (let m = k + 1; m < lines.length && !lines[m].startsWith("## "); m++) if (lines[m]) return lines[m];
    return "";
  };
  const para = (body("公共服务") || lines.find((l) => l && !l.startsWith("## ")) || "").replace(/（依据：[^）]*）+/g, "");
  if (para.length <= 260) return para;
  const cut = para.slice(0, 260);
  const end = cut.lastIndexOf("。");
  return end > 60 ? cut.slice(0, end + 1) : cut;
}
const examples = out.map((c) => ({
  id: c.id,
  title: c.title,
  tag: c.tag,
  address: c.address,
  generatedAt: c.stats.generatedAt,
  center: c.stats.center.address,
  categories: c.stats.categories.map((k) => ({
    key: k.key,
    label: k.label,
    count: k.count,
    capped: k.capped,
    folded: k.folded ?? 0,
    nearest: k.nearest && { name: k.nearest.name, distanceM: k.nearest.distanceM },
  })),
  excerpt: excerpt(c.report.text),
  verified: c.report.verified,
}));
fs.writeFileSync("app/components/examples.json", JSON.stringify(examples, null, 1), "utf8");
console.log("已写入 app/components/examples.json");

fs.mkdirSync("demo-data", { recursive: true });
fs.writeFileSync("demo-data/cases.json", JSON.stringify(out, null, 1), "utf8");
console.log("已写入 demo-data/cases.json");

// 导出演示数据：调用本机运行中的 /api/site 与 /api/report，为四个案例生成 demo-data/cases.json
// 用法：先 npm run build && npm run start -- -p 3100，再 node scripts/export-demo-data.mjs
import fs from "node:fs";

const BASE = process.env.DEMO_BASE ?? "http://localhost:3100";

const CASES = [
  { id: "guomao", title: "国贸", tag: "成熟城区", address: "北京市朝阳区国贸地铁站" },
  { id: "shougang", title: "首钢园", tag: "工业遗存改造", address: "北京市石景山区首钢园" },
  { id: "yizhuang", title: "亦庄", tag: "产业园区", address: "北京市大兴区亦庄经济技术开发区" },
  { id: "badaling", title: "八达岭", tag: "偏远景区", address: "北京市延庆区八达岭长城" },
];

const out = [];
for (const c of CASES) {
  let sr = await fetch(`${BASE}/api/site?address=${encodeURIComponent(c.address)}`);
  let stats = await sr.json();
  if (sr.ok && stats.kind === "choose") {
    // 定位含糊时服务器返回候选：演示数据固定选第一个，保证重新导出的结果可复现
    console.log(`${c.title}: 有 ${stats.candidates.length} 个候选，选第一个「${stats.candidates[0].name}」`);
    sr = await fetch(`${BASE}/api/site?pick=${encodeURIComponent(stats.candidates[0].pick)}`);
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
  stats.categories = stats.categories.map((cat) => ({
    ...cat,
    nearest: cat.nearest && { name: cat.nearest.name, distanceM: cat.nearest.distanceM },
    items: cat.items.map((p) => ({ name: p.name, distanceM: p.distanceM, lng: p.lng, lat: p.lat })),
  }));

  console.log(`${c.title}: verified=${report.verified} attempts=${report.attempts}`);
  out.push({ ...c, stats, report });
}

fs.mkdirSync("demo-data", { recursive: true });
fs.writeFileSync("demo-data/cases.json", JSON.stringify(out, null, 1), "utf8");
console.log("已写入 demo-data/cases.json");

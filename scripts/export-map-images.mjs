// 生成演示页的兜底地图图片：用高德静态地图接口，为 demo-data/cases.json 的每个案例保存 docs/maps/{id}.png
// 用法：node --env-file=.env.local scripts/export-map-images.mjs   （需要 AMAP_WEB_KEY；脚本不会打印 Key）
import fs from "node:fs";
import { buildMapModel } from "../lib/map-model.ts";
import { buildStaticMapParams } from "../lib/static-map.ts";

const key = process.env.AMAP_WEB_KEY;
if (!key) throw new Error("未设置 AMAP_WEB_KEY（请用 node --env-file=.env.local 运行）");

const cases = JSON.parse(fs.readFileSync("demo-data/cases.json", "utf8"));
fs.mkdirSync("docs/maps", { recursive: true });

for (const c of cases) {
  const p = buildStaticMapParams(buildMapModel(c.stats));
  const url = new URL("https://restapi.amap.com/v3/staticmap");
  for (const [k, v] of Object.entries({ location: p.location, zoom: p.zoom, size: p.size, markers: p.markers, paths: p.paths, key })) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const buf = Buffer.from(await res.arrayBuffer());
  const isPng = buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!res.ok || !isPng) {
    // 高德出错时返回 JSON，只打印错误说明，不打印请求地址（含 Key）
    const info = buf.subarray(0, 200).toString("utf8").replace(key, "***");
    throw new Error(`${c.title} 静态地图失败：HTTP ${res.status} ${info}`);
  }
  fs.writeFileSync(`docs/maps/${c.id}.png`, buf);
  console.log(`${c.title}: docs/maps/${c.id}.png ${(buf.length / 1024).toFixed(0)} KB，标记 ${p.markerCount} 个，请求地址长度 ${url.toString().length}`);
}

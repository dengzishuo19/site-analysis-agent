// 高德地图 Web 服务封装：只在服务端使用，Key 从环境变量读取
import { isMainland, type Geocode, type RawPoi } from "@/lib/geo-resolve";
import type { AroundPoi, ParentInfo } from "@/lib/poi-filter";

export type GeocodeResult = {
  address: string;
  lng: number;
  lat: number;
};

export type Poi = {
  name: string;
  distanceM: number;
  lng: number;
  lat: number;
};

// 地址查不到时抛出，用于返回 404
export class AddressNotFoundError extends Error {}

// 地点在港澳台时抛出：高德在这些地区的设施点位覆盖不完整，暂不支持
export class NonMainlandError extends Error {}

// 高德返回业务错误时抛出，携带高德的错误码
export class AmapApiError extends Error {
  constructor(message: string, readonly infocode: string) {
    super(message);
  }
}

// 高德触发频率限制时抛出，用于返回 429
export class RateLimitError extends Error {}

// 读取高德 Key，未配置时报错
function getKey(): string {
  const key = process.env.AMAP_WEB_KEY;
  if (!key) throw new Error("未配置 AMAP_WEB_KEY，请检查 .env.local");
  return key;
}

// 请求高德接口并检查返回状态；遇到频率限制自动重试 2 次
async function amapGet(path: string, params: Record<string, string>) {
  const url = new URL(`https://restapi.amap.com${path}`);
  url.searchParams.set("key", getKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`高德接口 HTTP 错误：${res.status}`);
    const data = await res.json();
    if (data.status === "1") return data;

    const limited = ["10021", "10019", "10020", "10022"].includes(String(data.infocode));
    if (limited && attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    if (limited) throw new RateLimitError("高德接口调用过于频繁，请稍后再试");
    throw new AmapApiError(`高德返回错误：${data.info}（${data.infocode}）`, String(data.infocode));
  }
}

// 把中文地址转成经纬度（高德地理编码接口），仅接受中国大陆的结果；city 不传即全国
export async function geocode(address: string, city?: string): Promise<GeocodeResult> {
  const hit = (await geocodeAll(address, city))[0];
  return { address: hit.formatted, lng: hit.lng, lat: hit.lat };
}

// 取字符串：高德对空值常返回空数组 []，统一转成字符串
function text(v: unknown): string {
  return Array.isArray(v) ? v.join("") : String(v ?? "");
}

const AROUND_PAGE_SIZE = 25; // 高德单页上限
const AROUND_MAX_PAGES = 3; // 最多取 3 页（75 条）；噪点折叠需要看到尽量多的点位
const PAGE_GAP_MS = 350;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 周边搜索：按距离取前若干页，返回高德给出的总数与原始点位（含 id、type、parent，供噪点折叠）
export async function searchAroundRaw(
  center: { lng: number; lat: number },
  types: string,
  radius: number,
): Promise<{ total: number; pois: AroundPoi[]; exhausted: boolean }> {
  const pois: AroundPoi[] = [];
  let total = 0;
  let exhausted = false; // 最后一页没满，说明已取完（高德的总数有时比实际多 1）
  for (let page = 1; page <= AROUND_MAX_PAGES; page++) {
    const data = await amapGet("/v3/place/around", {
      location: `${center.lng},${center.lat}`,
      types,
      radius: String(radius),
      offset: String(AROUND_PAGE_SIZE),
      page: String(page),
      sortrule: "distance",
      extensions: "all", // 带上 parent 字段
    });
    total = Number(data.count);
    const batch: Record<string, unknown>[] = data.pois ?? [];
    for (const p of batch) {
      const [lng, lat] = text(p.location).split(",").map(Number);
      pois.push({
        id: text(p.id),
        name: text(p.name),
        type: text(p.type),
        parent: text(p.parent),
        distanceM: Number(text(p.distance)),
        lng,
        lat,
      });
    }
    if (batch.length < AROUND_PAGE_SIZE || pois.length >= total) {
      exhausted = true;
      break;
    }
    await sleep(PAGE_GAP_MS);
  }
  return { total, pois, exhausted };
}

// 批量查询点位详情（用于取折叠所需的父级名称、类型、位置）；高德一次最多 10 个 id，失败的批次静默跳过（过滤退化为保留）
export async function getPoiDetails(ids: string[]): Promise<ParentInfo[]> {
  const out: ParentInfo[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    try {
      const data = await amapGet("/v3/place/detail", { id: ids.slice(i, i + 10).join("|"), extensions: "all" });
      for (const p of (data.pois ?? []) as Record<string, unknown>[]) {
        const [lng, lat] = text(p.location).split(",").map(Number);
        out.push({ id: text(p.id), name: text(p.name), type: text(p.type), lng, lat });
      }
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
    }
    await sleep(PAGE_GAP_MS);
  }
  return out;
}

// 地理编码：返回中国大陆的全部命中（含定位精度 level 与省市区），供判断定位是否够具体；city 不传即全国。
// 没有命中抛出 AddressNotFoundError；命中全在港澳台抛出 NonMainlandError
export async function geocodeAll(address: string, city?: string): Promise<Geocode[]> {
  let data;
  try {
    data = await amapGet("/v3/geocode/geo", { address, ...(city ? { city } : {}) });
  } catch (err) {
    if (err instanceof AmapApiError && err.infocode === "30001") {
      throw new AddressNotFoundError(`未找到该地点：${address}`);
    }
    throw err;
  }
  const all: Geocode[] = (data.geocodes ?? []).map((g: Record<string, unknown>) => {
    const [lng, lat] = text(g.location).split(",").map(Number);
    return {
      formatted: text(g.formatted_address),
      level: text(g.level),
      lng,
      lat,
      district: text(g.district),
      province: text(g.province),
      city: text(g.city),
    };
  });
  const hits = all.filter((g) => isMainland(g.province));
  if (!hits.length && all.length) throw new NonMainlandError("暂不支持港澳台地区：高德在这些地区的设施点位覆盖不完整，统计会明显偏少");
  if (!hits.length) throw new AddressNotFoundError(`未找到该地点：${address}`);
  return hits;
}

// 关键字搜索：返回匹配的 POI（按高德的知名度排序；extensions=all，含 parent 字段，用来区分校区本身与校内子点位）。
// city 不传即全国。全国搜索时若高德认为需要先选城市（如“南京路”），会在 suggestCities 里给出建议城市
export async function searchKeywordFull(keywords: string, city?: string): Promise<{ pois: RawPoi[]; suggestCities: string[] }> {
  const data = await amapGet("/v3/place/text", {
    keywords,
    ...(city ? { city, citylimit: "true" } : {}),
    offset: "20",
    page: "1",
    extensions: "all",
  });
  const pois: RawPoi[] = (data.pois ?? []).map((p: Record<string, unknown>) => {
    const [lng, lat] = text(p.location).split(",").map(Number);
    return {
      id: text(p.id),
      name: text(p.name),
      lng,
      lat,
      district: text(p.adname),
      address: text(p.address),
      type: text(p.type),
      parent: text(p.parent),
      province: text(p.pname),
      city: text(p.cityname),
    };
  });
  const suggestCities = ((data.suggestion?.cities ?? []) as Record<string, unknown>[]).map((c) => text(c.name)).filter(Boolean);
  return { pois, suggestCities };
}

// 只要 POI 列表的简便版本
export async function searchKeyword(keywords: string, city?: string): Promise<RawPoi[]> {
  return (await searchKeywordFull(keywords, city)).pois;
}

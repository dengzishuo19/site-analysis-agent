// 高德地图 Web 服务封装：只在服务端使用，Key 从环境变量读取
import type { Geocode, RawPoi } from "@/lib/geo-resolve";
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

// 地址查不到（或不在北京）时抛出，用于返回 404
export class AddressNotFoundError extends Error {}

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

// 把中文地址转成经纬度（高德地理编码接口），仅接受北京市内的结果
export async function geocode(address: string, city = "北京"): Promise<GeocodeResult> {
  let data;
  try {
    data = await amapGet("/v3/geocode/geo", { address, city });
  } catch (err) {
    // 高德对无法识别的地址返回 30001，按“地址未找到”处理
    if (err instanceof AmapApiError && err.infocode === "30001") {
      throw new AddressNotFoundError(`未在北京找到该地址：${address}`);
    }
    throw err;
  }
  const hit = data.geocodes?.[0];
  if (!hit || hit.province !== "北京市") {
    throw new AddressNotFoundError(`未在北京找到该地址：${address}`);
  }
  const [lng, lat] = String(hit.location).split(",").map(Number);
  return { address: hit.formatted_address, lng, lat };
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
): Promise<{ total: number; pois: AroundPoi[] }> {
  const pois: AroundPoi[] = [];
  let total = 0;
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
    if (batch.length < AROUND_PAGE_SIZE || pois.length >= total) break;
    await sleep(PAGE_GAP_MS);
  }
  return { total, pois };
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

// 地理编码：返回北京市内的全部命中（含定位精度 level），供判断定位是否够具体；没有命中时抛出 AddressNotFoundError
export async function geocodeAll(address: string, city = "北京"): Promise<Geocode[]> {
  let data;
  try {
    data = await amapGet("/v3/geocode/geo", { address, city });
  } catch (err) {
    if (err instanceof AmapApiError && err.infocode === "30001") {
      throw new AddressNotFoundError(`未在北京找到该地点：${address}`);
    }
    throw err;
  }
  const hits: Geocode[] = (data.geocodes ?? [])
    .filter((g: Record<string, unknown>) => text(g.province) === "北京市")
    .map((g: Record<string, unknown>) => {
      const [lng, lat] = text(g.location).split(",").map(Number);
      return { formatted: text(g.formatted_address), level: text(g.level), lng, lat, district: text(g.district) };
    });
  if (!hits.length) throw new AddressNotFoundError(`未在北京找到该地点：${address}`);
  return hits;
}

// 关键字搜索：返回北京市内匹配的 POI（extensions=all，含 parent 字段，用来区分校区本身与校内子点位）
export async function searchKeyword(keywords: string, city = "北京"): Promise<RawPoi[]> {
  const data = await amapGet("/v3/place/text", {
    keywords,
    city,
    citylimit: "true",
    offset: "20",
    page: "1",
    extensions: "all",
  });
  return (data.pois ?? []).map((p: Record<string, unknown>) => {
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
    };
  });
}

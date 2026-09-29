// 高德地图 Web 服务封装：只在服务端使用，Key 从环境变量读取

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

// 周边搜索：返回范围内某类设施的总数，以及按距离排序的前若干条
export async function searchAround(
  center: { lng: number; lat: number },
  types: string,
  radius: number,
  limit: number,
): Promise<{ count: number; pois: Poi[] }> {
  const data = await amapGet("/v3/place/around", {
    location: `${center.lng},${center.lat}`,
    types,
    radius: String(radius),
    offset: "25", // 高德单页上限；多取一些再自己排序，因为高德返回顺序并不严格按距离
    page: "1",
    sortrule: "distance",
  });
  const pois: Poi[] = (data.pois ?? []).map((p: Record<string, string>) => {
    const [lng, lat] = p.location.split(",").map(Number);
    return { name: p.name, distanceM: Number(p.distance), lng, lat };
  });
  pois.sort((a, b) => a.distanceM - b.distanceM);
  return { count: Number(data.count), pois: pois.slice(0, limit) };
}

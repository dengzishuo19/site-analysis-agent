// 高德地图 Web 服务封装：只在服务端使用，Key 从环境变量读取

export type GeocodeResult = {
  address: string;
  lng: number;
  lat: number;
};

// 把中文地址转成经纬度（高德地理编码接口）
export async function geocode(address: string, city = "北京"): Promise<GeocodeResult> {
  const key = process.env.AMAP_WEB_KEY;
  if (!key) throw new Error("未配置 AMAP_WEB_KEY，请检查 .env.local");

  const url = new URL("https://restapi.amap.com/v3/geocode/geo");
  url.searchParams.set("key", key);
  url.searchParams.set("address", address);
  url.searchParams.set("city", city);

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`高德接口 HTTP 错误：${res.status}`);

  const data = await res.json();
  if (data.status !== "1") {
    throw new Error(`高德返回错误：${data.info}（${data.infocode}）`);
  }
  if (!data.geocodes?.length) {
    throw new Error(`高德未找到该地址：${address}`);
  }

  const [lng, lat] = String(data.geocodes[0].location).split(",").map(Number);
  return { address: data.geocodes[0].formatted_address, lng, lat };
}

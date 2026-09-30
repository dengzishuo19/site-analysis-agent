// 定位歧义处理：判断一次地理编码的结果“够不够具体”，以及如何给出候选。纯函数，无网络、无时间依赖，便于单测。
//
// 背景：高德地理编码在无法确定具体地点时，会静默返回一个“行政区划中心点”（例如输入“北京建筑大学”，
// 因有两个校区而返回“北京市”，level=省）。如果不检查定位精度，后面的统计、地图、简报都会建立在错误的位置上。

// 北京市大致范围（用于校验坐标，防止在北京以外分析）
export const BEIJING_BBOX = { minLng: 115.4, maxLng: 117.6, minLat: 39.4, maxLat: 41.1 };
export const FAR_APART_M = 300; // 多个候选相距超过这个距离才认为是不同的地点

// 地理编码的一个命中
export type Geocode = { formatted: string; level: string; lng: number; lat: number; district: string };

// 关键字搜索的一个原始 POI（extensions=all）
export type RawPoi = {
  id?: string;
  name: string;
  lng: number;
  lat: number;
  district: string;
  address: string;
  type: string; // 形如 “科教文化服务;学校;高等院校”
  parent: string; // 空字符串表示顶层点位；否则是父级 POI 的 ID
  province?: string;
};

export type Candidate = { name: string; district: string; address: string; type: string; lng: number; lat: number };

export type Classification =
  | { status: "ok"; pick: Geocode }
  | { status: "choose"; reason: "not-found" | "coarse-area" | "multiple"; geocodes: Geocode[] }
  | { status: "reject"; message: string };

// 行政区划级别：定位到这一级说明高德没有找到具体地点
const ADMIN_LEVELS = new Set(["国家", "省", "市", "区县"]);
// 面或线状的对象：中心点不能代表一个“场地”
const AREA_LEVELS = new Set(["乡镇", "村庄", "开发区", "道路"]);

// 判断坐标是否在北京范围内
export function inBeijing(lng: number, lat: number): boolean {
  const b = BEIJING_BBOX;
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= b.minLng && lng <= b.maxLng && lat >= b.minLat && lat <= b.maxLat;
}

// 两点球面距离（米）
export function distanceM(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

// 去掉输入开头的“北京市/北京”
function stripCity(query: string): string {
  return query.replace(/\s+/g, "").replace(/^北京市?/, "");
}

// 输入是否只是一个行政区名（如“北京”“朝阳区”“北京市朝阳区”）：去掉城市名后为空，或正好包含在定位到的行政区名里
function isBareAdmin(query: string, formatted: string): boolean {
  const core = stripCity(query);
  return core === "" || formatted.includes(core);
}

// 判断一次地理编码结果能否直接用于分析
export function classifyGeocode(query: string, geocodes: Geocode[]): Classification {
  const first = geocodes[0];
  if (!first) return { status: "reject", message: "未找到该地点，请输入更具体的名称" };

  if (ADMIN_LEVELS.has(first.level)) {
    if (isBareAdmin(query, first.formatted)) {
      return { status: "reject", message: `“${query.trim()}”范围太大，无法作为一个场地。请输入具体的地点，例如学校、小区、地铁站、路口或建筑名称` };
    }
    return { status: "choose", reason: "not-found", geocodes };
  }
  if (AREA_LEVELS.has(first.level)) {
    return { status: "choose", reason: "coarse-area", geocodes };
  }

  // 精确定位：如果还有相距很远的其他候选，说明输入有歧义
  const farApart = geocodes.slice(1).some((g) => distanceM(first, g) > FAR_APART_M);
  if (farApart) return { status: "choose", reason: "multiple", geocodes };
  return { status: "ok", pick: first };
}

// 把地理编码的多个命中整理成候选（只保留互相相距较远的，避免同一地点重复出现）
export function candidatesFromGeocodes(geocodes: Geocode[]): Candidate[] {
  const out: Candidate[] = [];
  for (const g of geocodes) {
    if (!inBeijing(g.lng, g.lat)) continue;
    if (out.some((c) => distanceM(c, g) <= FAR_APART_M)) continue;
    out.push({ name: g.formatted, district: g.district, address: g.formatted, type: g.level, lng: g.lng, lat: g.lat });
  }
  return out.slice(0, MAX_CANDIDATES);
}

export const MAX_CANDIDATES = 6;

// 从关键字搜索结果里整理候选：只保留顶层点位（parent 为空，即校区本身而不是校内的系、食堂、停车场），限定北京，去重
export function buildCandidates(pois: RawPoi[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const p of pois) {
    if (p.parent) continue;
    if (p.province && p.province !== "北京市") continue;
    if (!inBeijing(p.lng, p.lat)) continue;
    const key = `${p.name}|${p.lng.toFixed(4)},${p.lat.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: p.name,
      district: p.district,
      address: p.address,
      type: p.type.split(";").slice(-2).join(" · "),
      lng: p.lng,
      lat: p.lat,
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

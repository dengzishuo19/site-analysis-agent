// 定位歧义处理：判断一次地理编码的结果“够不够具体”，以及如何给出候选。纯函数，无网络、无时间依赖，便于单测。
//
// 背景：高德地理编码在无法确定具体地点时，会静默返回一个“行政区划中心点”（例如输入“北京建筑大学”，
// 因有两个校区而返回“北京市”，level=省）。如果不检查定位精度，后面的统计、地图、简报都会建立在错误的位置上。

// 中国范围的外包框：校验候选令牌里的坐标（防止伪造境外坐标）；是否属于中国大陆另按省份判断
export const CHINA_BBOX = { minLng: 73.4, maxLng: 135.1, minLat: 18.1, maxLat: 53.6 };
// 暂不支持的地区：高德在这些地区的设施点位覆盖不完整，统计会明显偏少
export const NON_MAINLAND = ["台湾省", "香港特别行政区", "澳门特别行政区"];
export const FAR_APART_M = 300; // 多个候选相距超过这个距离才认为是不同的地点

// 地理编码的一个命中
export type Geocode = { formatted: string; level: string; lng: number; lat: number; district: string; province?: string; city?: string };

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
  city?: string;
};

// region：用于区分全国同名地点的“省 · 市 · 区”
export type Candidate = { name: string; district: string; region: string; address: string; type: string; lng: number; lat: number };

export type Classification =
  | { status: "ok"; pick: Geocode }
  | { status: "choose"; reason: "not-found" | "coarse-area" | "multiple"; geocodes: Geocode[] }
  | { status: "reject"; message: string };

// 行政区划级别：定位到这一级说明高德没有找到具体地点
const ADMIN_LEVELS = new Set(["国家", "省", "市", "区县"]);
// 面或线状的对象：中心点不能代表一个“场地”
const AREA_LEVELS = new Set(["乡镇", "村庄", "开发区", "道路"]);

// 判断坐标是否在中国范围的外包框内
export function inChina(lng: number, lat: number): boolean {
  const b = CHINA_BBOX;
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= b.minLng && lng <= b.maxLng && lat >= b.minLat && lat <= b.maxLat;
}

// 省份是否属于中国大陆（空值视为未知，交给坐标校验）
export function isMainland(province: string | undefined): boolean {
  return !province || !NON_MAINLAND.includes(province);
}

// 去掉名称开头的省、市、区（候选旁已单独显示“省 · 市 · 区”，避免重复）
function stripRegion(name: string, g: { province?: string; city?: string; district?: string }): string {
  let out = name;
  for (const x of [g.province, g.city, g.district]) if (x && out.startsWith(x)) out = out.slice(x.length);
  return out;
}

// 拼出“省 · 市 · 区”，去掉重复与空值（直辖市的省、市同名）
export function regionOf(province?: string, city?: string, district?: string): string {
  const parts: string[] = [];
  for (const x of [province, city, district]) if (x && !parts.includes(x)) parts.push(x);
  return parts.join(" · ");
}

// 拆出输入开头的城市名：“上海 人民广场” → 城市“上海”、地点“人民广场”。只认空格分隔，避免把地名的一部分误当城市
export function parseCityHint(query: string): { city?: string; query: string } {
  const m = query.trim().match(/^(\S{2,12})\s+(\S.*)$/);
  return m ? { city: m[1], query: m[2].trim() } : { query: query.trim() };
}

// 两点球面距离（米）
export function distanceM(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

// 输入是否只是一个行政区名（如“上海”“朝阳区”“杭州市西湖区”）：去掉空白后正好包含在定位到的行政区名里
function isBareAdmin(query: string, formatted: string): boolean {
  const core = query.replace(/\s+/g, "");
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
    if (!isMainland(g.province) || !inChina(g.lng, g.lat)) continue;
    if (out.some((c) => distanceM(c, g) <= FAR_APART_M)) continue;
    out.push({ name: stripRegion(g.formatted, g) || g.formatted, district: g.district, region: regionOf(g.province, g.city, g.district), address: g.formatted, type: g.level, lng: g.lng, lat: g.lat });
  }
  return out.slice(0, MAX_CANDIDATES);
}

export const MAX_CANDIDATES = 6;

// 从关键字搜索结果里整理候选：去掉“上级也在结果里”的子点位（如校区在列表中时，去掉校内的系、食堂、停车场），
// 限定中国大陆，去重；顺序沿用高德的知名度排序。
// 上级不在结果里的点位保留：例如“成都太古里”在高德里挂在一个上级片区下，但它本身就是用户要找的地点
export function buildCandidates(pois: RawPoi[]): Candidate[] {
  const seen = new Set<string>();
  const ids = new Set(pois.map((p) => p.id).filter(Boolean));
  const out: Candidate[] = [];
  for (const p of pois) {
    if (p.parent && ids.has(p.parent)) continue;
    if (!isMainland(p.province) || !inChina(p.lng, p.lat)) continue;
    const key = `${p.name}|${p.lng.toFixed(4)},${p.lat.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: p.name,
      district: p.district,
      region: regionOf(p.province, p.city, p.district),
      address: p.address,
      type: p.type.split(";").slice(-2).join(" · "),
      lng: p.lng,
      lat: p.lat,
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

// 关键字搜索的第一名（知名度最高）在港澳台：说明用户要找的就是那里的地点，应明确提示暂不支持，而不是给出大陆的同名点位
export function topIsNonMainland(pois: RawPoi[]): boolean {
  const first = pois[0];
  return !!first && !isMainland(first.province);
}

// 合并候选并保证城市多样性：先放 primary（关键字搜索，知名度排序），再补 secondary（地理编码，覆盖更多城市）；
// 相距很近的视为同一地点；每个城市最多 perCity 个，总数最多 MAX_CANDIDATES 个。
// 用于全国同名地点（如“中山公园”）：关键字搜索容易被“中山市”这样的城市名吸走，补上其他城市让用户能看到
export function mergeCandidates(primary: Candidate[], secondary: Candidate[], perCity = 2): Candidate[] {
  const out: Candidate[] = [];
  const cityOf = (c: Candidate) => {
    const parts = c.region.split(" · ");
    return parts.length > 1 ? parts.slice(0, -1).join(" · ") : c.region;
  };
  for (const c of [...primary, ...secondary]) {
    if (out.length >= MAX_CANDIDATES) break;
    if (out.some((o) => distanceM(o, c) <= FAR_APART_M)) continue;
    if (out.filter((o) => cityOf(o) === cityOf(c)).length >= perCity) continue;
    out.push(c);
  }
  return out;
}

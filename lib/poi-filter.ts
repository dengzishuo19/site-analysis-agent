// POI 噪点过滤：把“校内的教务处、医院里的各科室”这类子点位折叠到它们所属的机构上
// 依据高德的 parent 字段（已用北京建筑大学、协和医院、国贸等真实数据核对：子点位的 parent 指向所属机构）。
// 纯函数，不访问网络；父级详情由调用方先取好传入。
import type { Poi } from "@/lib/amap";

// 周边搜索返回的原始点位（含 id 与 parent）
export type AroundPoi = Poi & { id: string; type: string; parent: string };

// 父级点位的详情（来自高德 place/detail）
export type ParentInfo = { id: string; name: string; type: string; lng: number; lat: number };

// 高德 type 形如“医疗保健服务;综合医院;三级甲等医院”，第一段是大类
function topType(type: string): string {
  return type.split(";")[0] ?? "";
}

// 两点间距离（米，球面近似）
export function haversineM(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 需要查询详情的父级 id：有 parent、且父级本身不在这批结果里
export function parentIdsToResolve(pois: AroundPoi[]): string[] {
  const ids = new Set(pois.map((p) => p.id));
  return [...new Set(pois.map((p) => p.parent).filter((x) => x && !ids.has(x)))];
}

// 折叠规则：
// 1. 没有 parent，保留；
// 2. 父级就在结果里，说明是该机构的子点位，丢弃（机构本身已在列表中）；
// 3. 父级不在结果里：父级大类与自己相同（如医院下的科室）则折叠成父级；
//    大类不同（如写字楼里的诊所、商场里的餐厅，是独立设施）则保留；
// 4. 查不到父级详情时保留（宁可多留，不误杀）。
// 折叠成父级时距离取父级与最近子点位中较近者，保证“半径内”的说法成立。
export function foldSubUnits(
  pois: AroundPoi[],
  parents: Map<string, ParentInfo>,
  center: { lng: number; lat: number },
  radius: number,
): { pois: Poi[]; folded: number } {
  const ids = new Set(pois.map((p) => p.id));
  const kept: Poi[] = [];
  const keptById = new Map<string, Poi>();
  const closestChild = new Map<string, AroundPoi>(); // 父级在结果里时，其子点位中离场地最近的一个
  const groups = new Map<string, AroundPoi[]>();
  let folded = 0;

  for (const p of pois) {
    if (!p.parent) {
      const poi = toPoi(p);
      kept.push(poi);
      keptById.set(p.id, poi);
    } else if (ids.has(p.parent)) {
      folded++;
      const cur = closestChild.get(p.parent);
      if (!cur || p.distanceM < cur.distanceM) closestChild.set(p.parent, p);
    } else {
      const par = parents.get(p.parent);
      if (par && topType(par.type) === topType(p.type)) {
        const g = groups.get(par.id) ?? [];
        g.push(p);
        groups.set(par.id, g);
      } else {
        kept.push(toPoi(p));
      }
    }
  }

  // 父级在结果里：距离同样取父级与最近子点位中较近者
  for (const [parentId, child] of closestChild) {
    const par = keptById.get(parentId);
    if (par && child.distanceM < par.distanceM) {
      par.distanceM = child.distanceM;
      par.lng = child.lng;
      par.lat = child.lat;
    }
  }

  for (const [parentId, children] of groups) {
    const par = parents.get(parentId)!;
    const nearest = children.reduce((a, b) => (b.distanceM < a.distanceM ? b : a));
    // 机构的距离取“父级位置”与“最近子点位”中较近者（院区最近处才是真实的可达距离）；位置随之取同一个点
    const d = Math.round(haversineM(center, par));
    kept.push(
      d <= radius && d < nearest.distanceM
        ? { name: par.name, distanceM: d, lng: par.lng, lat: par.lat }
        : { name: par.name, distanceM: nearest.distanceM, lng: nearest.lng, lat: nearest.lat },
    );
    folded += children.length - 1; // 多个子点位合成一个
  }

  kept.sort((a, b) => a.distanceM - b.distanceM);
  return { pois: kept, folded };
}

function toPoi(p: AroundPoi): Poi {
  return { name: p.name, distanceM: p.distanceM, lng: p.lng, lat: p.lat };
}

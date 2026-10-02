// 噪点过滤的规则：纯函数，不访问网络。每条规则都要能在测试集（docs/testset）上度量，且有通用的理由。

// 高德 type 形如“科教文化服务;学校;小学”：取第 n 段（从 0 起）
export function typePart(type: string, n: number): string {
  // 一个点位可有多个类型，用 | 连接；这里只看第一个
  return (type.split("|")[0] ?? "").split(";")[n] ?? "";
}

// 去掉括号及其中内容，如“北京协和医院(东单院区)”→“北京协和医院”
export function baseName(name: string): string {
  return name.replace(/[（(][^）)]*[）)]/g, "").trim();
}

const BRANCH_SUFFIX = /(分校|分园|分址|分院|低年级部|中年级部|高年级部|高中部|初中部|英文高中)$/;

// 是不是“独立的分支设施”：附属学校、异地分部。这类点位即使挂在大机构名下，也应作为独立设施保留。
export function isIndependentBranch(child: { name: string; type: string }, parent?: { type: string }): boolean {
  if (child.name.includes("附属")) return true;
  if (BRANCH_SUFFIX.test(baseName(child.name))) return true;
  // 大学名下的小学、中学、幼儿园是独立学校，不是院系
  if (parent && typePart(parent.type, 2) === "高等院校" && ["小学", "中学", "幼儿园"].includes(typePart(child.type, 2))) return true;
  return false;
}

const SCHOOL_NOT_SCHOOL = /(协会|事务所|有限公司|代表处|党校|行政学院|社会主义学院|老年大学|培训|留学|设计)/;
const SCHOOL_BAD_SUBTYPE = ["培训机构", "成人教育", "学校内部设施"];

// 类别归错：返回原因；不是噪点返回 null。parentType 为所在父级的高德类型（没有则不传）
export function misclassifiedReason(
  poi: { name: string; type: string },
  category: string,
  parentType?: string,
): string | null {
  const types = poi.type.split("|");
  if (category === "school") {
    // 名称以“学校/大学/幼儿园”等结尾的，即使高德同时给了“培训机构”类型，也按学校处理
    const looksLikeSchool = /(大学|学院|中学|小学|学校|幼儿园)$/.test(baseName(poi.name));
    if (!looksLikeSchool && types.some((t) => SCHOOL_BAD_SUBTYPE.includes(t.split(";")[2] ?? ""))) return "培训、成人教育或校内设施类型，不是学校";
    if (SCHOOL_NOT_SCHOOL.test(poi.name)) return "名称显示不是学校（培训、协会、党校、公司等）";
  }
  if (category === "hospital") {
    if (/(药店|药房)/.test(poi.name)) return "药店，不是医疗机构";
  }
  if (category === "industry") {
    if (/[（(]建设中[）)]/.test(poi.name)) return "在建项目，不是现有园区或工厂";
    if (typePart(poi.type, 1) === "工厂" && /[（(][^）)]{1,8}店[）)]$/.test(poi.name)) return "标为工厂的门店";
    // 真正的工厂不在写字楼、商场里：被标成“工厂”却挂在楼宇或商场名下的，多是公司或店铺
    if (typePart(poi.type, 1) === "工厂" && parentType && ["商务住宅", "购物服务"].includes(parentType.split(";")[0])) {
      return "标为工厂，但位于写字楼或商场内";
    }
  }
  return null;
}

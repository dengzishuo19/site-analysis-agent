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

const BRANCH_SUFFIX = /(分校|分园|分址|分院|低年级部|中年级部|高年级部|高中部|初中部|英文高中|园区|校区|院区)$/;

// 是不是“独立的分支设施”：附属学校、异地分部。这类点位即使挂在大机构名下，也应作为独立设施保留。
// “附属”只认出现在上级名称之后的（“北京建筑大学”+“附属小学”）；“某某大学附属某某医院”的科室，
// “附属”是上级名称本身的一部分，不能据此当成独立设施（派工单 015：上海曙光医院、仁济医院的科室曾因此全部漏网）
export function isIndependentBranch(child: { name: string; type: string }, parent?: { type: string; name?: string }): boolean {
  const cb = baseName(child.name);
  const pb = parent?.name ? baseName(parent.name) : "";
  const rest = pb && cb.startsWith(pb) ? cb.slice(pb.length) : pb && parent?.name && child.name.startsWith(parent.name) ? child.name.slice(parent.name.length) : cb;
  if (rest.includes("附属")) return true;
  // 分部标志同样只看上级名称之后的部分：“沈塘桥幼儿园”+“大塘园区”是分部；“庆云院区”+“(卒中胸痛中心)”不是
  if (BRANCH_SUFFIX.test(rest)) return true;
  // 大学名下的小学、中学、幼儿园是独立学校，不是院系
  if (parent && typePart(parent.type, 2) === "高等院校" && ["小学", "中学", "幼儿园"].includes(typePart(child.type, 2))) return true;
  return false;
}

const SCHOOL_NOT_SCHOOL = /(协会|事务所|有限公司|代表处|党校|行政学[院校]|社会主义学院|老年|培训|留学|设计|进修|夜大|业余|领导力|专修|雅思|托福|美育|练字|素养|神学院|社区学校|学会|艺术(中心|空间)|服务中心|信息服务|英语$)/;
// 名称里出现这些字样，就按学校看待（即使高德同时给了“培训机构”类型）
const SCHOOL_WORD = /(中学|小学|幼儿|幼稚园|幼教|托儿所|托育|托幼)/;
const SCHOOL_WORD_ANY = /(大学|学院|学校|中学|小学|幼儿|幼稚园|幼教|托儿所|托育|托幼)/;
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
    const base = baseName(poi.name);
    const looksLikeSchool = SCHOOL_WORD.test(base) || /(大学|学院|学校)$/.test(base);
    if (typePart(poi.type, 1) && typePart(poi.type, 1) !== "学校") return "高德的第一类型不是学校";
    if (/(building|tower|plaza|mansion)/i.test(poi.name)) return "写字楼名称被标成学校";
    if (!looksLikeSchool && types.some((t) => SCHOOL_BAD_SUBTYPE.includes(t.split(";")[2] ?? ""))) return "培训、成人教育或校内设施类型，不是学校";
    if (SCHOOL_NOT_SCHOOL.test(poi.name)) return "名称显示不是学校（培训、成人教育、协会、党校、公司等）";
    if (/教育/.test(poi.name) && !SCHOOL_WORD_ANY.test(poi.name)) return "名称是“某某教育”而没有学校字样，多为培训机构";
  }
  if (category === "hospital") {
    if (/(药店|药房)/.test(poi.name)) return "药店，不是医疗机构";
    if (/(社会工作|社工)/.test(poi.name)) return "社会工作机构，不是医疗机构";
    if (/视力(中心|训练|保健)/.test(poi.name)) return "视力中心（视力训练、配镜），不是医疗机构";
    // 生活美容（高德也标成“整形美容”）：光电、保养、美肤，或以“美容”结尾但不是“医疗/医学美容”；名称里有医院、诊所、门诊的除外
    const salon = /(光电|保养|美肤|皮肤管理|美甲|美睫|SPA)/i.test(poi.name) || (/美容$/.test(baseName(poi.name)) && !/(医疗|医学)美容$/.test(baseName(poi.name)));
    if (salon && !/(医院|诊所|门诊|口腔|齿科|牙)/.test(poi.name)) return "生活美容，不是医疗机构";
  }
  if (category === "industry") {
    if (/[（(]建设中[）)]/.test(poi.name)) return "在建项目，不是现有园区或工厂";
    if (typePart(poi.type, 1) === "产业园区" && /\d+号\d*[A-Za-z]*$/.test(poi.name)) return "名称是门牌地址，不是园区";
    // 门店：名称以“(某某店)”结尾；产业园区除外（如“东安睿锦当代艺术区(北京apm店)”）
    if (typePart(poi.type, 1) !== "产业园区" && /[（(][^）)]{1,8}店[）)]$/.test(poi.name)) return "门店，不是工厂或园区";
    // 真正的工厂不在写字楼、商场里：被标成“工厂”却挂在楼宇或商场名下的，多是公司或店铺
    if (typePart(poi.type, 1) === "工厂" && parentType && ["商务住宅", "购物服务"].includes(parentType.split(";")[0])) {
      return "标为工厂，但位于写字楼或商场内";
    }
  }
  return null;
}

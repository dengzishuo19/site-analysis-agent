import test from "node:test";
import assert from "node:assert/strict";
import { baseName, isIndependentBranch, misclassifiedReason, typePart } from "./poi-rules.ts";

const SCHOOL = "科教文化服务;学校;学校";
const UNIV = "科教文化服务;学校;高等院校";

test("typePart / baseName", () => {
  assert.equal(typePart("科教文化服务;学校;小学", 2), "小学");
  assert.equal(typePart("科教文化服务;学校;学校|科教文化服务;培训机构;培训机构", 1), "学校");
  assert.equal(baseName("北京协和医院(东单院区)"), "北京协和医院");
});

test("附属学校与异地分部是独立设施；院系不是", () => {
  assert.equal(isIndependentBranch({ name: "北京建筑大学附属小学", type: SCHOOL }), true);
  assert.equal(isIndependentBranch({ name: "展览路第一小学低年级部", type: SCHOOL }), true);
  assert.equal(isIndependentBranch({ name: "某某中学-英文高中", type: SCHOOL }), true);
  assert.equal(isIndependentBranch({ name: "某大学法学院", type: UNIV }), false);
  assert.equal(isIndependentBranch({ name: "北京建筑大学西城校区建筑系", type: UNIV }), false);
  // 大学名下的小学、中学、幼儿园
  assert.equal(isIndependentBranch({ name: "某某实验小学", type: "科教文化服务;学校;小学" }, { type: UNIV }), true);
});

test("教育：培训、协会、党校、行政学院、公司不是学校", () => {
  for (const name of ["北京市国汉律师事务所", "中关村技术经理人协会", "中共海淀区委党校", "海淀区行政学院", "海淀区社会主义学院", "某某商务老年大学"]) {
    assert.ok(misclassifiedReason({ name, type: SCHOOL }, "school"), name);
  }
  assert.ok(misclassifiedReason({ name: "北京欧风小语种", type: "科教文化服务;学校;学校|科教文化服务;培训机构;培训机构" }, "school"));
  assert.ok(misclassifiedReason({ name: "某大学2号楼", type: "科教文化服务;学校;学校内部设施" }, "school"));
});

test("教育：名称像学校的，即使同时带培训机构类型也保留", () => {
  assert.equal(
    misclassifiedReason({ name: "北京市西城外国语学校(西直门校区)", type: "科教文化服务;学校;中学|科教文化服务;培训机构;培训机构" }, "school"),
    null,
  );
  assert.equal(misclassifiedReason({ name: "家育苑幼儿园", type: "科教文化服务;学校;幼儿园" }, "school"), null);
});

test("医疗：药店不是医疗机构，诊所是", () => {
  assert.ok(misclassifiedReason({ name: "北京同仁堂药店(东安门大街店)", type: "医疗保健服务;综合医院;综合医院" }, "hospital"));
  assert.equal(misclassifiedReason({ name: "金信康口腔诊所", type: "医疗保健服务;专科医院;口腔医院" }, "hospital"), null);
});

test("工业：在建项目、标为工厂的门店、写字楼里的“工厂”不算；真园区保留", () => {
  const park = "商务住宅;产业园区;产业园区";
  assert.ok(misclassifiedReason({ name: "北京CBD核心区Z3项目(建设中)", type: park }, "industry"));
  assert.ok(misclassifiedReason({ name: "可可兔自然光COCOTO(国贸店)", type: "公司企业;工厂;工厂" }, "industry"));
  assert.ok(misclassifiedReason({ name: "MatchCC", type: "公司企业;工厂;工厂" }, "industry", "商务住宅;楼宇;商务写字楼"));
  // 园区名里带“店”字或括号的，不是门店
  assert.equal(misclassifiedReason({ name: "东安睿锦当代艺术区(北京apm店)", type: park }, "industry"), null);
  // 真工厂（没有挂在楼宇名下）保留
  assert.equal(misclassifiedReason({ name: "凯博橱柜加工厂", type: "公司企业;工厂;工厂" }, "industry"), null);
});

// ===== 派工单 015：外地测试集发现的问题 =====
const HOSP = "医疗保健服务;综合医院;三级甲等医院";

test("“附属”只认上级名称之后的：大学附属小学是独立学校；大学附属医院的科室不是", () => {
  assert.equal(isIndependentBranch({ name: "北京建筑大学附属小学", type: "科教文化服务;学校;小学" }, { type: UNIV, name: "北京建筑大学(西城校区)" }), true);
  assert.equal(isIndependentBranch({ name: "上海中医药大学附属曙光医院(西院)门诊", type: HOSP }, { type: HOSP, name: "上海中医药大学附属曙光医院(西院)" }), false);
  assert.equal(isIndependentBranch({ name: "上海交通大学医学院附属仁济医院西院住院部", type: HOSP }, { type: HOSP, name: "上海交通大学医学院附属仁济医院(西院区)" }), false);
});

test("分部标志只看上级名称之后的部分", () => {
  assert.equal(isIndependentBranch({ name: "沈塘桥幼儿园大塘园区", type: "科教文化服务;学校;幼儿园" }, { type: "科教文化服务;学校;幼儿园", name: "沈塘桥幼儿园" }), true);
  assert.equal(isIndependentBranch({ name: "成都市第二人民医院庆云院区(卒中胸痛中心)", type: HOSP }, { type: HOSP, name: "成都市第二人民医院庆云院区" }), false);
});

test("教育：成人教育、培训、学会、写字楼名、非学校类型都不算学校；名称有学校字样的教育集团保留", () => {
  for (const name of ["上海市沪光进修学院", "上海财经大学夜大黄浦分部", "上海黄浦区摇篮业余艺术学校", "鸿风领导力学院上海总部", "朗阁教育·雅思托福GRE", "致真教育", "湖北省水力发电工程学会", "宇琴艺术空间", "兰考一鸣英语", "成都市锦江区行政学校", "四川神学院"]) {
    assert.ok(misclassifiedReason({ name, type: SCHOOL }, "school"), name);
  }
  assert.ok(misclassifiedReason({ name: "ZhongfuBuildingHuangpuDistriCT", type: "科教文化服务;学校;幼儿园" }, "school"));
  assert.ok(misclassifiedReason({ name: "海藏文化", type: "科教文化服务;科研机构;科研机构" }, "school"));
  for (const name of ["兰考县星河中学教育集团(兰阳校区)", "杭州市朝晖幼儿教育集团(朝一园区)", "橡创托育", "亚洲财经商学院"]) {
    assert.equal(misclassifiedReason({ name, type: "科教文化服务;学校;学校|科教文化服务;培训机构;培训机构" }, "school"), null, name);
  }
});

test("医疗：社会工作、视力中心、生活美容不算；医疗美容、口腔护理算", () => {
  const BEAUTY = "医疗保健服务;专科医院;整形美容";
  for (const name of ["武汉博雅社会工作服务中心", "眼康视力中心中山东街店", "BR光电保养(K11分院)", "道格BTL美肤中心(黄浦店)", "美丽部落熙熙里美容"]) {
    assert.ok(misclassifiedReason({ name, type: BEAUTY }, "hospital"), name);
  }
  for (const name of ["星美宝岛医疗美容", "乔安医学美容", "口腔SPA预防护理中心", "嗨洁牙吧", "伊美尔瑞阳整形"]) {
    assert.equal(misclassifiedReason({ name, type: BEAUTY }, "hospital"), null, name);
  }
});

test("工业：门牌地址的“园区”、任何类型的门店不算；园区名带“店”的保留", () => {
  assert.ok(misclassifiedReason({ name: "上海市黄浦区济南路9号15E", type: "商务住宅;产业园区;产业园区" }, "industry"));
  assert.ok(misclassifiedReason({ name: "上海大隆液压件厂(爱仁里店)", type: "购物服务;家居建材市场;建材五金市场" }, "industry"));
  assert.equal(misclassifiedReason({ name: "莲峰北路14号厂房", type: "公司企业;工厂;工厂" }, "industry"), null);
  assert.equal(misclassifiedReason({ name: "东安睿锦当代艺术区(北京apm店)", type: "商务住宅;产业园区;产业园区" }, "industry"), null);
});

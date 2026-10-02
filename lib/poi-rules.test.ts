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

# 由 docs/testset/labels.json 生成待审阅的 docs/testset/review.md（标注本身在 labels.json 里维护）
import json, sys
sys.stdout.reconfigure(encoding="utf-8")
d = json.load(open("docs/testset/labels.json", encoding="utf-8"))
CAT = {"school": "教育（学校）", "hospital": "医疗（综合/专科医院）", "industry": "工业（工厂+产业园区）"}
LAB = {"K": "保留", "S": "内部子单元", "M": "类别归错", "U": "拿不准"}
L = ["# POI 噪点过滤测试集：标注", "",
     "> 初版标注：Claude；规则由邓子硕审定。依据只有点位的名称、高德类型、所属父级、距离，没有实地核实。", "",
     "## 标注标准", "",
     "每个点位只问一个问题：**它是否应作为“一处该类独立设施”计入统计？**", "",
     "| 标签 | 含义 | 举例 |", "|---|---|---|",
     "| 保留 (K) | 独立设施 | 一所小学、一家诊所、一个产业园 |",
     "| 内部子单元 (S) | 机构内部的院系、科室、楼栋、办公室，应折叠到所属机构 | 北京大学法学院、协和医院皮肤科、园区第 4 幢 |",
     "| 类别归错 (M) | 不属于这一类 | 律师事务所被标成“学校”，服装定制店被标成“工厂”，药店被标成“医院” |",
     "| 拿不准 (U) | 尚未判定 | 见下方“待定” |", "",
     "## 已审定的规则", "",
     "1. **教育（学校）只含宏观意义上的幼儿园、小学、中学、大学。**培训机构（雅思、小语种、留学等）不算，标“类别归错”。",
     "2. **党校、行政学院、社会主义学院、老年大学都不算学校**，标“类别归错”。",
     "3. **医疗美容诊所、口腔诊所等算入医疗**，标“保留”（点位带“医美”标签，便于日后单独统计）。",
     "4. **同一机构的异地分部（低年级部、分址、英文高中部等）算独立设施**，标“保留”。", "",
     "“系统”指当前线上规则：只折叠有 `parent` 的子点位。因此 **S/M 里系统保留的是漏网，K 里系统折叠的是误杀。**", ""]
tot = {"n": 0, "K": 0, "S": 0, "M": 0, "U": 0}; kill = []; miss = []
for g in d:
    for r in g["pois"]:
        tot["n"] += 1; tot[r["label"]] += 1
        if not r["systemKept"] and r["label"] == "K": kill.append(r)
        if r["systemKept"] and r["label"] in "SM": miss.append(r)
sm = tot["S"] + tot["M"]
mm = sum(1 for r in miss if r["label"] == "M")
L += ["## 对照结果（当前线上规则）", "",
      f"- 共 {tot['n']} 个点位：保留 {tot['K']}、内部子单元 {tot['S']}、类别归错 {tot['M']}、拿不准 {tot['U']}。",
      f"- **误杀**（应保留却被折叠）：{len(kill)} 个（{len(kill)}/{tot['K']}）：{'、'.join(r['name'] for r in kill) or '无'}。",
      f"- **漏网**（应去除却被保留）：{len(miss)} 个（{len(miss)}/{sm}）。其中类别归错 {mm} 个，当前规则管不到；内部子单元 {len(miss) - mm} 个，多是没有 `parent` 标记的校内点位。",
      "- 北京大学教育类高德有 190 条，只取到前 75 条，折叠后显示“至少 9”，与真实数量差距很大：数量口径需另行处理。",
      "- 范围：教育、医疗、工业三类，每个场地每类取距离最近的至多 75 条（国贸医疗取了 75/95）。", "",
      "## 逐场地标注", "",
      "只列出非“保留”或有理由的点位；其余“保留”点位在每组末尾一行列出。序号对应 `labels.json`。", ""]
for g in d:
    L.append(f"### {g['siteName']} · {CAT[g['category']]}（高德总数 {g['total']}，已标 {len(g['pois'])}）\n")
    ex = [r for r in g["pois"] if r["label"] != "K" or not r["systemKept"] or r["note"]]
    ks = [r for r in g["pois"] if r["label"] == "K" and r["systemKept"] and not r["note"]]
    if ex:
        L += ["| # | 名称 | 距离 | 标注 | 系统 | 理由 |", "|---|---|---|---|---|---|"]
        for r in ex:
            flag = "❌ 误杀" if r["label"] == "K" and not r["systemKept"] else "⚠ 漏网" if r["label"] in "SM" and r["systemKept"] else ""
            tag = ("（" + "、".join(r["tags"]) + "）") if r["tags"] else ""
            L.append(f"| {r['i']} | {r['name']}{tag} | {r['distanceM']} m | {LAB[r['label']]} | {'保留' if r['systemKept'] else '折叠'} {flag} | {r['note']} |")
        L.append("")
    if ks: L.append("保留（无异议）：" + "、".join(r["name"] for r in ks) + "\n")
open("docs/testset/review.md", "w", encoding="utf-8").write("\n".join(L))
print(tot, "误杀", len(kill), "漏网", len(miss))

// 自动相似度检测：将本作与泡泡卡丁车(PopKart/KartRider)竞速模式逐项对比
// 数据来源：① index.html 静态特征扫描 ② tools/behavior-results.json (无头浏览器实测)
// 用法: NODE_PATH=$(npm root -g) node tools/behavior-test.mjs && node tools/similarity-check.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
           + fs.readFileSync(path.join(ROOT, "js", "game.js"), "utf8");
const behaviorPath = path.join(ROOT, "tools", "behavior-results.json");
if (!fs.existsSync(behaviorPath)){
  console.error("缺少行为测试结果，请先运行: NODE_PATH=$(npm root -g) node tools/behavior-test.mjs");
  process.exit(2);
}
const behavior = JSON.parse(fs.readFileSync(behaviorPath, "utf8"));
const B = id => {
  const r = behavior.find(x => x.id === id);
  return r ? { s: r.ok ? 1 : 0, ev: `实测:${r.ok ? "通过" : "失败"} (${r.detail || ""})` } : { s: 0, ev: "实测:缺失" };
};
const S = (regexes, ev) => {
  const all = [].concat(regexes).every(r => r.test(html));
  return { s: all ? 1 : 0, ev: (all ? "代码特征:存在" : "代码特征:缺失") + (ev ? " · " + ev : "") };
};
// 部分得分：机制存在但与原作实现方式有本质差异
const P = (base, factor, note) => ({ s: base.s * factor, ev: base.ev + ` · 折算${Math.round(factor * 100)}%(${note})` });

// ============ 对比评分表（对标：泡泡卡丁车 竞速模式）============
const RUBRIC = [
  // ---- 手感 (45) ----
  ["手感", "漂移侧滑物理(低抓地甩尾)", 6, () => B("漂移产生侧滑(甩尾)")],
  ["手感", "漂移集气条机制", 6, () => B("漂移积攒集气条")],
  ["手感", "N₂O 氮气喷射(超越普通极速)", 6, () => B("氮气喷射突破普通极速")],
  ["手感", "双喷(漂移结束瞬间接喷射强化)", 5, () => B("双喷(漂移接喷射)触发")],
  ["手感", "断位漂移小喷", 4, () => B("断位漂移小喷")],
  ["手感", "起步加速(倒计时抢油门判定)", 4, () => B("起步加速(完美起步/起步加速)机制")],
  ["手感", "油门加速曲线与极速档位", 3, () => B("油门加速达到高速")],
  ["手感", "赛道加速带", 3, () => S([/padBoostTime/, /pads\.push/])],
  ["手感", "撞墙减速与反弹", 3, () => S([/wallHit/, /speed \*= 0\.72/])],
  ["手感", "出赛道(草地/雪地)减速", 3, () => S([/offroadFactor/, /k\.offroad/])],
  ["手感", "最大侧滑角限制(可控漂移不打转)", 2, () => S([/MAXSLIP/])],
  ["手感", "车与车碰撞推挤", 2, () => S([/kartCollisions/])],
  // ---- 画面 (38) ----
  ["画面", "WebGL 真 3D 第三人称追尾视角", 6, () => {
    const a = S([/THREE\.WebGLRenderer/, /PerspectiveCamera/]), b = B("WebGL 真 3D 渲染上下文");
    return { s: Math.min(a.s, b.s), ev: a.ev + " " + b.ev };
  }],
  ["画面", "真 3D 地形起伏与坡道物理(上下坡)", 3, () => S([/terrainH/, /坡道影响/])],
  ["画面", "Q版卡通 3D 卡丁车(车轮滚动/前轮转向)+头盔车手", 5, () => P(S([/buildKartMesh/, /helmet/, /steerVis/]), 0.9, "原创造型规避版权素材")],
  ["画面", "多主题赛道(村庄/雪谷/沙城)", 4, () => {
    const a = B("第二赛道(冰封雪谷)可加载"), b = B("第三赛道(黄金沙城)可加载");
    return P({ s: (a.s + b.s) / 2, ev: a.ev + " " + b.ev }, 0.85, "3 条主题赛道 vs 原作数十条");
  }],
  ["画面", "红白路缘/棋盘起点线/道路标线", 3, () => S([/e03030.*26, 26|\[26, 26\]/, /棋盘格/])],
  ["画面", "漂移火花+烟雾+持久轮胎痕", 4, () => S([/kind: "spark"/, /kind: "smoke"/, /轮胎痕烙印/])],
  ["画面", "氮气火焰喷射+速度线+FOV冲刺变化", 3, () => S([/flames/, /drawSpeedFX/, /targetFov/])],
  ["画面", "3D 天空穹顶/太阳/立体云/远山", 3, () => S([/天空穹顶/, /远山环/, /cloudMeshes/])],
  ["画面", "路旁 3D 装饰物(树木/路牌/起点拱门)", 3, () => S([/buildTree/, /buildSign/, /buildGate/])],
  ["画面", "车身动态(漂移侧倾/坡道俯仰/颠簸/撞墙抖动)", 2, () => S([/漂移侧倾/, /pitch/, /bob/])],
  ["画面", "起跑信号灯+倒计时缩放动画", 2, () => S([/drawCountdown/, /goFlash/])],
  // ---- 系统与HUD (20) ----
  ["系统", "圆盘速度表(km/h)", 2, () => S([/km\/h/, /速度表/])],
  ["系统", "集气条 HUD", 2, () => S([/DRIFT 集气/])],
  ["系统", "N₂O 储存槽(×2)", 2, () => S([/N₂O/, /nitroCount/])],
  ["系统", "实时小地图+车手位置", 2, () => S([/miniCan/, /小地图/])],
  ["系统", "圈数/名次显示", 2, () => S([/圈数/, /rank/])],
  ["系统", "计时器与最速圈", 2, () => S([/最速圈/, /fmtTime/])],
  ["系统", "6 车竞技 + AI(漂移/氮气/橡皮筋)", 2, () => B("6 车同场竞技(1 玩家 + 5 AI)")],
  ["系统", "结算排行榜(名次/总时间/最快圈)", 2, () => S([/showResult/, /resultTable/])],
  ["系统", "引擎音/漂移音/喷射音/BGM", 1, () => S([/SFX/, /tickBGM/])],
  ["系统", "倒计时 3-2-1-GO 流程", 1, () => B("加载并进入倒计时")],
  ["系统", "逆行警告", 1, () => S([/逆行/])],
  ["系统", "暂停/重开/结算再来一局", 1, () => S([/togglePause/, /再来一局/])]
];

let total = 0, got = 0;
const rows = [], cats = {};
for (const [cat, name, w, fn] of RUBRIC){
  const r = fn();
  total += w; got += w * r.s;
  cats[cat] = cats[cat] || { w: 0, g: 0 };
  cats[cat].w += w; cats[cat].g += w * r.s;
  rows.push({ cat, name, w, s: r.s, ev: r.ev });
}
const pct = (got / total) * 100;

// 迭代记录
const iterPath = path.join(ROOT, "tools", "iterations.json");
const iters = fs.existsSync(iterPath) ? JSON.parse(fs.readFileSync(iterPath, "utf8")) : [];
iters.push({ n: iters.length + 1, score: +pct.toFixed(1),
  behaviorPass: behavior.filter(b => b.ok).length + "/" + behavior.length });
fs.writeFileSync(iterPath, JSON.stringify(iters, null, 2));

// 生成报告
let md = `# 相似度检测报告 —— 对标《泡泡卡丁车》竞速模式

> 本报告由 \`tools/similarity-check.mjs\` 自动生成：静态特征扫描 + Playwright 无头浏览器实机行为测试。
> 评分对象为**玩法机制与视觉特征的还原度**；美术素材与角色均为原创，不使用原作版权资源。

## 总体相似度：**${pct.toFixed(1)}%** ${pct >= 90 ? "✅ 达到 90% 目标" : "❌ 未达 90% 目标"}

| 维度 | 得分 |
|---|---|
${Object.entries(cats).map(([c, v]) => `| ${c} | ${(v.g / v.w * 100).toFixed(1)}% (${v.g.toFixed(1)}/${v.w}) |`).join("\n")}

## 逐项对比明细

| 维度 | 对比项 | 权重 | 得分 | 证据 |
|---|---|---|---|---|
${rows.map(r => `| ${r.cat} | ${r.name} | ${r.w} | ${r.s === 1 ? "✅ 100%" : r.s > 0 ? "🟡 " + Math.round(r.s * 100) + "%" : "❌ 0%"} | ${r.ev} |`).join("\n")}

## 已知差异（授权/规模边界内无法 100% 一致的部分）

1. **美术与角色**：原作角色(宝宝/丁丁等)与车辆为 NEXON 版权素材，本作使用原创 Q 版 3D 造型模仿其风格。
2. **内容规模**：原作有数十条赛道、道具赛、多人联机；本作为 3 条赛道单机竞速模式。
3. **立体结构**：本作已是 WebGL 真 3D（起伏地形、上下坡物理），但暂无原作部分赛道的桥梁/隧道/立交结构。

## 迭代记录

| 轮次 | 相似度 | 行为测试 |
|---|---|---|
${iters.map(i => `| 第 ${i.n} 轮 | ${i.score}% | ${i.behaviorPass} |`).join("\n")}
`;
fs.writeFileSync(path.join(ROOT, "SIMILARITY_REPORT.md"), md);
console.log(`总相似度: ${pct.toFixed(1)}%  (${got.toFixed(1)}/${total})`);
for (const [c, v] of Object.entries(cats)) console.log(`  ${c}: ${(v.g / v.w * 100).toFixed(1)}%`);
for (const r of rows.filter(r => r.s < 1)) console.log(`  待改进: [${r.cat}] ${r.name} → ${Math.round(r.s * 100)}% (${r.ev})`);
console.log("报告已写入 SIMILARITY_REPORT.md");
process.exit(pct >= 90 ? 0 : 1);

// 自动化行为测试：在无头浏览器中实际驾驶卡丁车，验证泡泡卡丁车核心手感机制
// 用法: NODE_PATH=$(npm root -g) node tools/behavior-test.mjs [--shots 目录]
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDirArg = process.argv.indexOf("--shots");
const SHOTS = shotDirArg > -1 ? process.argv[shotDirArg + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(id, ok, detail){
  results.push({ id, ok: !!ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${id}  ${detail || ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 660 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("file://" + path.join(ROOT, "index.html") + "?autotest");
await page.waitForTimeout(400);

const state0 = await page.evaluate(() => window.__game.state);
check("加载并进入倒计时", state0 === "COUNTDOWN", `state=${state0}`);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "01-countdown.png") });

// 在倒计时 ~1s 前按住油门 → 起步加速判定
await page.waitForFunction(() => window.__game.countT < 1.4);
await page.evaluate(() => window.__test.press("up"));
await page.waitForFunction(() => window.__game.state === "RACING", { timeout: 6000 });
const sb = await page.evaluate(() => ({ msg: window.__game.startBoostMsg, boost: window.__game.player.boostT }));
check("起步加速(完美起步/起步加速)机制", sb.boost > 0 || sb.msg, `msg="${sb.msg}" boostT=${sb.boost.toFixed(2)}`);

// 直线加速：自动循线 + 油门，4 秒后速度应接近极速
await page.evaluate(() => window.__test.autoSteer(true));
await page.waitForTimeout(4000);
let p = await page.evaluate(() => ({ speed: window.__game.player.speed, max: window.__test.PH.maxSpd }));
check("油门加速达到高速", p.speed > p.max * 0.55, `speed=${p.speed.toFixed(0)}/${p.max}`);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "02-racing.png") });

// 漂移集气：置于直道，按住转向+Shift，观察集气条增长与侧滑角
await page.evaluate(() => { window.__test.placeOnStraight(230); window.__test.press("right"); window.__test.press("drift"); });
await page.waitForTimeout(900);
const drift = await page.evaluate(() => ({
  drifting: window.__game.player.drifting,
  gauge: window.__game.player.gauge,
  slip: Math.abs(window.__game.player.visSlip)
}));
check("漂移状态触发", drift.drifting, `drifting=${drift.drifting}`);
check("漂移产生侧滑(甩尾)", drift.slip > 0.1, `slip=${drift.slip.toFixed(2)}rad`);
check("漂移积攒集气条", drift.gauge > 5, `gauge=${drift.gauge.toFixed(1)}`);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "03-drift.png") });

// 松开漂移 → 断位小喷 + 双喷窗口
await page.evaluate(() => { window.__test.release("drift"); window.__test.release("right"); });
const cut = await page.evaluate(() => ({ cutT: window.__game.player.cutT, dualT: window.__game.player.dualT }));
check("断位漂移小喷", cut.cutT > 0, `cutT=${cut.cutT.toFixed(2)}`);
check("双喷判定窗口开启", cut.dualT > 0, `dualT=${cut.dualT.toFixed(2)}`);

// 攒满集气 → 获得 N2O → 喷射后速度超过普通极速
await page.evaluate(() => { window.__game.player.gauge = 99.5; window.__test.placeOnStraight(230);
  window.__test.press("left"); window.__test.press("drift"); });
await page.waitForTimeout(400);
await page.evaluate(() => { window.__test.release("drift"); window.__test.release("left"); });
const n2o = await page.evaluate(() => window.__game.player.nitroCount);
check("集气满获得 N₂O", n2o > 0, `nitroCount=${n2o}`);
await page.evaluate(() => { window.__test.placeOnStraight(250); window.__test.press("nitro"); });
let peak = 0;
for (let i = 0; i < 16; i++){
  await page.waitForTimeout(100);
  const s = await page.evaluate(() => window.__game.player.speed);
  if (s > peak) peak = s;
}
p = await page.evaluate(() => ({ max: window.__test.PH.maxSpd }));
check("氮气喷射突破普通极速", peak > p.max * 1.05, `峰值=${peak.toFixed(0)} (普通极速${p.max})`);
const trans = await page.evaluate(() => window.__game.player.transP || 0);
check("氮气变形触发(车体机构展开)", trans > 0.5, `transP=${trans.toFixed(2)}`);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "04-nitro.png") });

// 双喷：漂移结束瞬间接氮气
await page.evaluate(() => {
  const P = window.__game.player;
  P.gauge = 99.5; P.boostT = 0;
  window.__test.placeOnStraight(220);
  window.__test.press("right"); window.__test.press("drift");
});
await page.waitForTimeout(500);
await page.evaluate(() => { window.__test.release("drift"); window.__test.press("nitro"); });
const dual = await page.evaluate(() => window.__game.player.boostKind);
check("双喷(漂移接喷射)触发", dual === "dual", `boostKind=${dual}`);
await page.evaluate(() => { window.__test.release("right"); window.__test.release("nitro"); });

// HUD/系统 状态检查
const sys = await page.evaluate(() => ({
  laps: window.__game.player.lap, rank: window.__game.player.rank,
  karts: window.__game.karts.length, fps: window.__game.fps,
  aiHasNitroLogic: window.__game.karts.some(k => !k.isPlayer && k.ai),
  particles: window.__game.particles.length >= 0
}));
check("6 车同场竞技(1 玩家 + 5 AI)", sys.karts === 6, `karts=${sys.karts}`);
check("排名系统运作", sys.rank >= 1 && sys.rank <= 6, `rank=${sys.rank}`);
// 无头环境为 SwiftShader 软件渲染，帧率远低于真实 GPU；阈值取 8fps 仅作冒烟基线
check("渲染帧率(软渲染基线)≥8fps", sys.fps >= 8, `fps=${sys.fps.toFixed(0)} (headless 软件渲染)`);
const webgl = await page.evaluate(() => !!(window.THREE && document.getElementById("game3d").getContext("webgl2")
  || document.getElementById("game3d").getContext("webgl")));
check("WebGL 真 3D 渲染上下文", webgl, "THREE.WebGLRenderer");

// 其余赛道加载
for (const [ti, tname] of [[1, "第二赛道(冰封雪谷)"], [2, "第三赛道(黄金沙城)"]]){
  await page.evaluate(t => window.__test.start(t, 2), ti);
  await page.waitForTimeout(800);
  const ts = await page.evaluate(() => window.__game.state);
  check(`${tname}可加载`, ts === "COUNTDOWN" || ts === "RACING", `state=${ts}`);
  if (SHOTS){ await page.waitForTimeout(3200);
    await page.evaluate(() => { window.__test.press("up"); window.__test.autoSteer(true); });
    await page.waitForTimeout(2500); await page.screenshot({ path: path.join(SHOTS, `05-track${ti + 1}.png`) }); }
}

check("无 JS 运行错误", errors.length === 0, errors.slice(0, 3).join(" | ") || "clean");

await browser.close();
const pass = results.filter(r => r.ok).length;
console.log(`\n行为测试: ${pass}/${results.length} 通过`);
fs.writeFileSync(path.join(ROOT, "tools", "behavior-results.json"), JSON.stringify(results, null, 2));
process.exit(pass === results.length ? 0 : 1);

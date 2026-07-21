"use strict";
/* ============================================================
   疾风卡丁车 —— 泡泡卡丁车(PopKart/KartRider)风格竞速游戏
   真 3D 版：Three.js WebGL 渲染 · 起伏地形 · 立体车模与场景
   手感核心：漂移集气 / N2O喷射 / 双喷 / 断位漂移 / 完美起步 / 加速带
   ============================================================ */

// ---------- 基础常量 ----------
const W = 960, H = 540;              // 画布逻辑尺寸
const TEX = 2048;                    // 赛道纹理 = 世界尺寸
const ROAD_HALF = 95;                // 路面半宽
const SHOULDER = 78;                 // 路肩(缓冲区)宽
const TOTAL_LAPS = 3;
const KART_COLORS = ["#ff4646", "#3d8bff", "#ffd23d", "#43d05c", "#b45cff", "#ff8c2e"];
const AI_NAMES = ["皮皮", "蓝蓝", "小虎", "糖糖", "阿飞"];

// 手感参数（对标泡泡卡丁车竞速模式）
const PH = {
  maxSpd: 262,          // 普通极速 (显示约188km/h)
  nitroMaxSpd: 344,     // 氮气极速 (显示约248km/h)
  accel: 3.0,           // 油门响应
  nitroTime: 2.3,       // 单次氮气时长
  cutBoostTime: 0.55,   // 断位漂移小喷时长
  dualWindow: 0.45,     // 双喷判定窗口
  turnRate: 1.72,       // 普通转向速率 rad/s
  driftTurnRate: 3.05,  // 漂移转向速率
  gripNormal: 7.5,      // 普通抓地
  gripDrift: 1.55,      // 漂移抓地(低→侧滑)
  gaugeRate: 34,        // 集气速度 (满=100)
  driftMinSpd: 110,     // 可起漂的最低速度
  offroadFactor: 0.45,  // 出弯道减速比例
  padBoostTime: 1.25,   // 加速带时长
  spdKmh: 0.72          // 内部速度→km/h 显示系数
};

const AUTO = /[?&]autotest/.test(location.search);
function mulberry32(a){ return function(){ a|=0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
function angDiff(a, b){ let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// ---------- 地形起伏（真 3D 高低差；跑跑式上下坡） ----------
function terrainH(x, y){
  return 14 * Math.sin(x * 0.0052 + 1.3) * Math.cos(y * 0.0046)
       + 7 * Math.sin((x + y) * 0.0031 + 0.5)
       + 4 * Math.sin(x * 0.011 - y * 0.008);
}

// ---------- 画布 ----------
const hudCv = document.getElementById("game"), ctx = hudCv.getContext("2d");
const glCv = document.getElementById("game3d");
function fitStage(){
  const s = Math.min(innerWidth / W, innerHeight / H) * 0.98;
  const st = document.getElementById("stage");
  st.style.transform = `scale(${s})`; st.style.transformOrigin = "center";
  st.style.width = W + "px"; st.style.height = H + "px";
  document.getElementById("wrap").style.overflow = "visible";
}
addEventListener("resize", fitStage); fitStage();

// ---------- 输入 ----------
const keys = {};
const KEYMAP = { ArrowUp:"up", KeyW:"up", ArrowDown:"down", KeyS:"down",
  ArrowLeft:"left", KeyA:"left", ArrowRight:"right", KeyD:"right",
  ShiftLeft:"drift", ShiftRight:"drift", ControlLeft:"nitro", ControlRight:"nitro", Space:"nitro" };
addEventListener("keydown", e => {
  const k = KEYMAP[e.code]; if (k){ if (!keys[k]) keyPressed(k); keys[k] = true; e.preventDefault(); }
  if (e.code === "Escape") togglePause();
});
addEventListener("keyup", e => { const k = KEYMAP[e.code]; if (k){ keys[k] = false; keyReleased(k); } });

// ---------- 音频 ----------
const SFX = { ac: null, engine: null, engine2: null, engGain: null, driftGain: null, master: null, bgmGain: null, bgmTimer: 0, bgmStep: 0 };
function initAudio(){
  if (SFX.ac) return;
  try {
    const A = new (window.AudioContext || window.webkitAudioContext)();
    SFX.ac = A;
    SFX.master = A.createGain(); SFX.master.gain.value = 0.6; SFX.master.connect(A.destination);
    const lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520;
    SFX.engGain = A.createGain(); SFX.engGain.gain.value = 0;
    SFX.engine = A.createOscillator(); SFX.engine.type = "sawtooth"; SFX.engine.frequency.value = 70;
    SFX.engine2 = A.createOscillator(); SFX.engine2.type = "square"; SFX.engine2.frequency.value = 72;
    const g2 = A.createGain(); g2.gain.value = 0.4;
    SFX.engine.connect(lp); SFX.engine2.connect(g2); g2.connect(lp);
    lp.connect(SFX.engGain); SFX.engGain.connect(SFX.master);
    SFX.engine.start(); SFX.engine2.start();
    const len = A.sampleRate * 1.5, buf = A.createBuffer(1, len, A.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = A.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1150; bp.Q.value = 0.8;
    SFX.driftGain = A.createGain(); SFX.driftGain.gain.value = 0;
    noise.connect(bp); bp.connect(SFX.driftGain); SFX.driftGain.connect(SFX.master); noise.start();
    SFX.noiseBuf = buf;
    SFX.bgmGain = A.createGain(); SFX.bgmGain.gain.value = 0.16; SFX.bgmGain.connect(SFX.master);
  } catch (e) { /* 无音频环境 */ }
}
function blip(freq, dur, type, vol, when){
  if (!SFX.ac) return; const A = SFX.ac, t = A.currentTime + (when || 0);
  const o = A.createOscillator(), g = A.createGain();
  o.type = type || "sine"; o.frequency.value = freq;
  g.gain.setValueAtTime(vol || 0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(SFX.master); o.start(t); o.stop(t + dur + 0.02);
}
function whoosh(){
  if (!SFX.ac) return; const A = SFX.ac, t = A.currentTime;
  const s = A.createBufferSource(); s.buffer = SFX.noiseBuf;
  const hp = A.createBiquadFilter(); hp.type = "highpass"; hp.frequency.setValueAtTime(300, t);
  hp.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
  const g = A.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  s.connect(hp); hp.connect(g); g.connect(SFX.master); s.start(t); s.stop(t + 1);
  blip(180, 0.7, "sawtooth", 0.15);
}
function thud(){ blip(90, 0.18, "square", 0.3); blip(60, 0.25, "sine", 0.35); }
const BGM_MEL = [523,659,784,659, 880,784,659,523, 587,698,880,698, 784,659,523,392,
                 523,659,784,880, 1047,880,784,659, 698,587,698,880, 784,0,523,0];
const BGM_BASS = [131,131,165,165, 175,175,196,196, 147,147,175,175, 196,196,131,131];
function tickBGM(dt){
  if (!SFX.ac || !SFX.bgmGain) return;
  SFX.bgmTimer -= dt;
  if (SFX.bgmTimer <= 0){
    SFX.bgmTimer += 0.16;
    const i = SFX.bgmStep++;
    const m = BGM_MEL[i % BGM_MEL.length];
    if (m){ const A = SFX.ac, t = A.currentTime, o = A.createOscillator(), g = A.createGain();
      o.type = "square"; o.frequency.value = m; g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14); o.connect(g); g.connect(SFX.bgmGain);
      o.start(t); o.stop(t + 0.15); }
    if (i % 2 === 0){ const b = BGM_BASS[(i >> 1) % BGM_BASS.length];
      const A = SFX.ac, t = A.currentTime, o = A.createOscillator(), g = A.createGain();
      o.type = "triangle"; o.frequency.value = b; g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.connect(g); g.connect(SFX.bgmGain);
      o.start(t); o.stop(t + 0.24); }
  }
}

// ---------- 赛道 ----------
const TRACKS = [
  { name: "绿荫村庄", pts: [[420,520],[830,300],[1350,280],[1720,500],[1750,900],[1500,1150],[1650,1450],[1300,1720],[900,1730],[550,1600],[330,1330],[320,1010],[620,900],[400,640]],
    grass:"#4fae3e", grass2:"#469c37", road:"#5c6068", edge:"#8a8f98", skyTop:"#3f9bf5", skyBot:"#bfe9ff",
    mount:"#7fb96a", mount2:"#5f9e50", treeTop:"#2e8f3e", treeTop2:"#57c84d", trunk:"#8a5a2b", cloud:"#ffffff" },
  { name: "冰封雪谷", pts: [[350,350],[900,260],[1450,320],[1750,700],[1600,1050],[1730,1350],[1450,1680],[1000,1600],[700,1750],[380,1550],[280,1180],[450,900],[300,600]],
    grass:"#e8f2fa", grass2:"#d5e6f5", road:"#6d7688", edge:"#a5aec2", skyTop:"#6f9fd8", skyBot:"#e8f4ff",
    mount:"#c9dcef", mount2:"#a8c4e2", treeTop:"#3a7d55", treeTop2:"#5aa878", trunk:"#6a4a28", cloud:"#ffffff" },
  { name: "黄金沙城", pts: [[400,400],[900,300],[1400,350],[1700,620],[1640,960],[1380,1130],[1470,1420],[1180,1680],[780,1720],[460,1560],[300,1240],[420,960],[360,660]],
    grass:"#e2c47c", grass2:"#d4b268", road:"#66605c", edge:"#948c82", skyTop:"#4d9be0", skyBot:"#ffe2b0",
    mount:"#d8a86a", mount2:"#c08c50", treeTop:"#4da05a", treeTop2:"#3d8a4c", trunk:"#7a9a4a", cloud:"#fff4e0" }
];

let path = [], pathN = 0;
let pads = [];        // 加速带
let decors = [];      // 路旁装饰
let texCan, texCtx;   // 赛道纹理（铺在 3D 地形上）
let miniCan;          // 小地图
let theme;

function catmull(p0, p1, p2, p3, t){
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function buildPath(pts){
  path = []; const n = pts.length, SEG = 42;
  for (let i = 0; i < n; i++){
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < SEG; s++){
      const t = s / SEG;
      path.push({ x: catmull(p0[0], p1[0], p2[0], p3[0], t), y: catmull(p0[1], p1[1], p2[1], p3[1], t) });
    }
  }
  pathN = path.length;
  for (let i = 0; i < pathN; i++){
    const a = path[i], b = path[(i + 1) % pathN], c = path[(i + 20) % pathN];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    a.dx = dx / L; a.dy = dy / L;
    a.dir = Math.atan2(dy, dx);
    const dir2 = Math.atan2(c.y - path[(i + 19) % pathN].y, c.x - path[(i + 19) % pathN].x);
    a.curv = angDiff(dir2, a.dir);
  }
}
function strokePath(c, w, color, dash, dashOfs){
  c.beginPath();
  for (let i = 0; i <= pathN; i++){ const p = path[i % pathN]; i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }
  c.closePath(); c.lineWidth = w; c.strokeStyle = color; c.lineJoin = "round"; c.lineCap = "round";
  c.setLineDash(dash || []); c.lineDashOffset = dashOfs || 0; c.stroke(); c.setLineDash([]);
}
function buildTrack(ti){
  theme = TRACKS[ti];
  buildPath(theme.pts);
  const rand = mulberry32(1234 + ti * 999);
  // --- 赛道纹理（红白路缘 / 棋盘起点 / 中线 / 加速带箭头）---
  texCan = document.createElement("canvas"); texCan.width = TEX; texCan.height = TEX;
  const c = texCan.getContext("2d"); texCtx = c;
  c.fillStyle = theme.grass; c.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 900; i++){
    c.fillStyle = i % 2 ? theme.grass2 : "rgba(255,255,255,0.05)";
    const r = 8 + rand() * 30;
    c.beginPath(); c.arc(rand() * TEX, rand() * TEX, r, 0, 7); c.fill();
  }
  strokePath(c, ROAD_HALF * 2 + 34, "#e8e8e8");
  strokePath(c, ROAD_HALF * 2 + 34, "#e03030", [26, 26]);
  strokePath(c, ROAD_HALF * 2 + 10, theme.edge);
  strokePath(c, ROAD_HALF * 2, theme.road);
  strokePath(c, ROAD_HALF * 1.1, "rgba(0,0,0,0.07)");
  strokePath(c, ROAD_HALF * 0.5, "rgba(255,255,255,0.03)");
  strokePath(c, 5, "rgba(255,255,255,0.65)", [30, 46]);
  const sp = path[0];              // 起点终点棋盘格
  c.save(); c.translate(sp.x, sp.y); c.rotate(sp.dir);
  const sq = 12;
  for (let ix = 0; ix < 4; ix++) for (let iy = -8; iy < 8; iy++){
    c.fillStyle = (ix + iy) % 2 ? "#111" : "#fff";
    c.fillRect(ix * sq - 2 * sq, iy * sq, sq, sq);
  }
  c.restore();
  pads = [];
  const padIdx = [Math.floor(pathN * 0.22), Math.floor(pathN * 0.48), Math.floor(pathN * 0.66), Math.floor(pathN * 0.88)];
  for (const pi of padIdx){
    const p = path[pi];
    pads.push({ x: p.x, y: p.y, dir: p.dir });
    c.save(); c.translate(p.x, p.y); c.rotate(p.dir);
    for (let k = 0; k < 3; k++){
      c.save(); c.translate(k * 26 - 26, 0);
      c.beginPath(); c.moveTo(-10, -34); c.lineTo(8, -34); c.lineTo(20, 0); c.lineTo(8, 34);
      c.lineTo(-10, 34); c.lineTo(2, 0); c.closePath();
      c.fillStyle = k === 1 ? "#ffd23d" : "#ff8c00"; c.fill(); c.restore();
    }
    c.restore();
  }
  // --- 路旁装饰位 ---
  decors = [];
  for (let i = 0; i < pathN; i += 10){
    if (rand() < 0.55) continue;
    const p = path[i], side = (i % 20 < 10) ? 1 : -1;
    const off = ROAD_HALF + 70 + rand() * 190;
    const nx = -p.dy, ny = p.dx;
    decors.push({ x: p.x + nx * off * side, y: p.y + ny * off * side,
      type: rand() < 0.85 ? "tree" : "sign", v: rand() < 0.5 ? 0 : 1 });
  }
  decors.push({ x: path[0].x, y: path[0].y, type: "gate", v: 0, dir: path[0].dir });
  // --- 小地图 ---
  miniCan = document.createElement("canvas"); miniCan.width = 150; miniCan.height = 150;
  const mc = miniCan.getContext("2d"), ms = 150 / TEX;
  mc.beginPath();
  for (let i = 0; i <= pathN; i++){ const p = path[i % pathN];
    i ? mc.lineTo(p.x * ms, p.y * ms) : mc.moveTo(p.x * ms, p.y * ms); }
  mc.closePath();
  mc.lineWidth = 9; mc.strokeStyle = "rgba(0,0,0,0.55)"; mc.lineJoin = "round"; mc.stroke();
  mc.lineWidth = 5; mc.strokeStyle = "rgba(255,255,255,0.9)"; mc.stroke();
  const g0 = path[0], gn = { x: -g0.dy, y: g0.dx };
  mc.lineWidth = 2; mc.strokeStyle = "#ffd23d";
  mc.beginPath(); mc.moveTo(g0.x * ms - gn.x * 8, g0.y * ms - gn.y * 8);
  mc.lineTo(g0.x * ms + gn.x * 8, g0.y * ms + gn.y * 8); mc.stroke();
}
function nearestOnPath(x, y, hint){
  let best = hint, bd = 1e18;
  for (let k = -40; k <= 40; k++){
    const i = (hint + k + pathN) % pathN, p = path[i];
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bd){ bd = d; best = i; }
  }
  return best;
}
function shade(hex, amt){
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  return `rgb(${clamp(r,0,255)},${clamp(g,0,255)},${clamp(b,0,255)})`;
}

// ============================================================
//                       Three.js 真 3D 渲染
// ============================================================
let renderer, scene, camera;
let groundTex, marksCan, marksCtx, marksTex, marksDirty = 0;
let kartMeshMap = new Map();       // kart -> {group, wheels, frontL, frontR, shadow, flames}
let padGlows = [], cloudMeshes = [];
let particlePool = [];
const PARTICLE_MAX = 240;

function initThree(){
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ canvas: glCv, antialias: true });
  renderer.setSize(W, H, false);
  camera = new THREE.PerspectiveCamera(62, W / H, 2, 5200);
}
function gridGeometry(seg, hFn){
  const g = new THREE.BufferGeometry();
  const n = seg + 1, pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++){
    const x = ix / seg * TEX, y = iy / seg * TEX, o = (iy * n + ix);
    pos[o * 3] = x; pos[o * 3 + 1] = hFn(x, y); pos[o * 3 + 2] = y;
    uv[o * 2] = ix / seg; uv[o * 2 + 1] = 1 - iy / seg;
  }
  const idx = [];
  for (let iy = 0; iy < seg; iy++) for (let ix = 0; ix < seg; ix++){
    const a = iy * n + ix, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  g.setIndex(idx);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
function makeSpriteTex(draw, size){
  const c = document.createElement("canvas"); c.width = c.height = size || 64;
  draw(c.getContext("2d"), c.width);
  const t = new THREE.CanvasTexture(c);
  return t;
}
const softCircleTex = () => makeSpriteTex((c, s) => {
  const g = c.createRadialGradient(s/2, s/2, 2, s/2, s/2, s/2);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.55, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, s, s);
});
let circleTex = null, blobTex = null;

function toonMat(color){
  return new THREE.MeshToonMaterial({ color });
}
// ---- 环境反射贴图（程序生成天空+地面，车漆/镀铬反射用） ----
let envCube = null;
function makeEnvMap(){
  const faces = [];
  for (let i = 0; i < 6; i++){
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    if (i === 2){            // +Y 天顶
      x.fillStyle = "#eaf6ff"; x.fillRect(0, 0, 64, 64);
      x.fillStyle = "#ffffff"; x.beginPath(); x.arc(32, 32, 18, 0, 7); x.fill();
    } else if (i === 3){     // -Y 地面
      x.fillStyle = theme ? theme.grass2 : "#4a9a3a"; x.fillRect(0, 0, 64, 64);
    } else {                 // 侧面：天空渐变 + 地平线
      const g = x.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, "#bfe4ff"); g.addColorStop(0.62, "#e8f4ff");
      g.addColorStop(0.66, "#8fb87a"); g.addColorStop(1, "#5a8a4a");
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      x.fillStyle = "rgba(255,255,255,0.75)";
      x.beginPath(); x.ellipse(16 + i * 8, 14, 10, 4, 0, 0, 7); x.fill();
    }
    faces.push(c);
  }
  envCube = new THREE.CubeTexture(faces);
  envCube.needsUpdate = true;
}
// ---- 精致车体材质库（按颜色缓存） ----
const kartMatCache = new Map();
function kartMats(colorHex){
  if (kartMatCache.has(colorHex)) return kartMatCache.get(colorHex);
  const col = new THREE.Color(colorHex);
  const M = {
    paint: new THREE.MeshPhongMaterial({ color: col, shininess: 95, specular: 0xbbccdd,
      envMap: envCube, reflectivity: 0.22, combine: THREE.MixOperation }),
    paint2: new THREE.MeshPhongMaterial({ color: col.clone().multiplyScalar(0.62), shininess: 70,
      specular: 0x667788, envMap: envCube, reflectivity: 0.12, combine: THREE.MixOperation }),
    carbon: new THREE.MeshPhongMaterial({ color: 0x181c24, shininess: 30, specular: 0x334455 }),
    chrome: new THREE.MeshPhongMaterial({ color: 0xd8dee8, shininess: 160, specular: 0xffffff,
      envMap: envCube, reflectivity: 0.85, combine: THREE.MixOperation }),
    rim: new THREE.MeshPhongMaterial({ color: 0xf2c14e, shininess: 130, specular: 0xffffff,
      envMap: envCube, reflectivity: 0.25, combine: THREE.MixOperation }),
    tire: new THREE.MeshPhongMaterial({ color: 0x1c1e24, shininess: 12, specular: 0x222831 }),
    suit: new THREE.MeshPhongMaterial({ color: 0xf4f6fa, shininess: 45, specular: 0x99aabb }),
    visor: new THREE.MeshPhongMaterial({ color: 0x2fb9f0, shininess: 150, specular: 0xffffff,
      envMap: envCube, reflectivity: 0.6, combine: THREE.MixOperation }),
    lampW: new THREE.MeshBasicMaterial({ color: 0xffffee }),
    lampR: new THREE.MeshBasicMaterial({ color: 0xff3a2e, transparent: true, opacity: 0.55 }),
    glow: new THREE.MeshBasicMaterial({ color: 0x4de1ff, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    core: new THREE.MeshBasicMaterial({ color: 0x0a2033 })
  };
  kartMatCache.set(colorHex, M);
  return M;
}
function buildKartMesh(colorHex){
  // 商业级精致车模：金属漆/镀铬/碳纤维 + 氮气变形机构（尾翼展开/侧翼板/鼻锥前移/能量光效）
  if (!envCube) makeEnvMap();
  const M = kartMats(colorHex);
  const g = new THREE.Group();
  const mesh = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
  };
  // --- 底盘 / 前铲 / 侧裙 ---
  mesh(new THREE.BoxGeometry(21, 0.9, 11.6), M.carbon, -0.5, 2.7, 0);
  mesh(new THREE.BoxGeometry(5.5, 0.6, 12.4), M.carbon, 11.5, 2.5, 0);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(12, 1.4, 0.9), M.carbon, -1.5, 3.4, 6.0 * s);
  // --- 主车身单体壳 ---
  const tub = mesh(new THREE.BoxGeometry(13.5, 3.4, 9.4), M.paint, -1.5, 4.9, 0);
  // 楔形鼻锥组（变形时前移，露出发光涡轮核心）
  const noseGrp = new THREE.Group(); g.add(noseGrp);
  const noseGeo = new THREE.CylinderGeometry(1.25, 4.7, 10, 4, 1);
  noseGeo.rotateZ(-Math.PI / 2); noseGeo.rotateX(Math.PI / 4);
  const nose = new THREE.Mesh(noseGeo, M.paint);
  nose.scale.set(1, 0.52, 1.2); nose.position.set(0, 0, 0); noseGrp.add(nose);
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), M.chrome);
  noseTip.position.set(5.1, 0.3, 0); noseGrp.add(noseTip);
  for (const s of [-1, 1]){                                  // 大灯
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.75, 8, 8), M.lampW);
    lamp.scale.set(0.6, 0.8, 1.4); lamp.position.set(3.4, 0.7, 2.1 * s); noseGrp.add(lamp);
  }
  noseGrp.position.set(10.6, 4.9, 0);
  // 涡轮核心 + 能量环（鼻锥后方，变形时可见）
  const coreGeo = new THREE.CylinderGeometry(2.1, 2.1, 0.7, 12);
  coreGeo.rotateZ(Math.PI / 2);
  const core = mesh(coreGeo, M.core, 7.3, 4.9, 0);
  for (let i = 0; i < 4; i++){
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.4, 0.9), M.chrome);
    blade.rotation.x = i * Math.PI / 4; core.add(blade);
  }
  const coreRingGeo = new THREE.TorusGeometry(2.5, 0.38, 8, 20);
  coreRingGeo.rotateY(Math.PI / 2);
  const coreRing = mesh(coreRingGeo, M.glow.clone(), 7.6, 4.9, 0);
  // 侧箱 + 进气口 + 能量灯带
  const strips = [coreRing];
  for (const s of [-1, 1]){
    mesh(new THREE.BoxGeometry(10, 2.6, 3.1), M.paint2, -1, 4.6, 5.6 * s);
    mesh(new THREE.BoxGeometry(1.2, 1.7, 2.2), M.carbon, 4.1, 4.6, 5.7 * s);
    const st = mesh(new THREE.BoxGeometry(9.4, 0.42, 0.34), M.glow.clone(), -1, 6.05, 7.15 * s);
    strips.push(st);
    const st2 = mesh(new THREE.BoxGeometry(0.4, 0.42, 8.6), M.glow.clone(), 8.6, 3.4, 0);
    strips.push(st2);
  }
  // 驾驶舱 / 座椅 / 引擎盖
  mesh(new THREE.CylinderGeometry(3.9, 4.3, 1.6, 14), M.carbon, -2.3, 7.0, 0);
  const seat = mesh(new THREE.BoxGeometry(2.2, 4.4, 4.6), M.paint2, -5.6, 8.0, 0);
  seat.rotation.z = 0.18;
  const cowlGeo = new THREE.SphereGeometry(4.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const cowl = mesh(cowlGeo, M.paint, -8.2, 6.4, 0);
  cowl.scale.set(1.25, 1.1, 1.05);
  const finGeo = new THREE.CylinderGeometry(0.5, 2.6, 4.6, 3, 1);
  finGeo.rotateZ(-Math.PI / 2);
  const fin = mesh(finGeo, M.paint2, -8.4, 9.4, 0); fin.scale.set(1, 0.9, 0.28);
  // 方向盘
  const swGeo = new THREE.TorusGeometry(1.5, 0.34, 8, 14);
  const sw = mesh(swGeo, M.carbon, 2.6, 8.6, 0);
  sw.rotation.y = Math.PI / 2; sw.rotation.z = 0.5;
  // --- 车手（赛车服 + 精致头盔） ---
  const torso = mesh(new THREE.CylinderGeometry(2.0, 2.7, 3.6, 12), M.suit, -2.8, 9.0, 0);
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(1.05, 8, 8), M.paint, -2.6, 10.3, 2.2 * s);
  const helmet = mesh(new THREE.SphereGeometry(2.9, 16, 13), M.suit, -2.5, 12.9, 0);
  helmet.scale.set(1.05, 1, 1);
  const visGeo = new THREE.SphereGeometry(2.55, 14, 10, -Math.PI / 2, Math.PI);
  const vis = mesh(visGeo, M.visor, -2.2, 12.9, 0);
  vis.rotation.y = Math.PI / 2; vis.scale.set(1.02, 0.82, 1.02);
  const crest = mesh(new THREE.BoxGeometry(3.6, 0.7, 0.5), M.paint, -2.7, 15.4, 0);
  crest.rotation.z = -0.12;
  // --- 双层尾翼（上层为变形组：喷射时抬升展开） ---
  mesh(new THREE.BoxGeometry(3.0, 0.45, 12.5), M.paint2, -10.2, 8.3, 0).rotation.z = 0.10;
  const wingGrp = new THREE.Group();
  const wing = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.5, 15), M.paint);
  wing.rotation.z = 0.16; wingGrp.add(wing);
  for (const s of [-1, 1]){
    const ep = new THREE.Mesh(new THREE.BoxGeometry(3.8, 3.0, 0.45), M.paint2);
    ep.position.set(0, -0.4, 7.5 * s); wingGrp.add(ep);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.6, 0.7), M.chrome);
    strut.position.set(0.4, -2.2, 4.6 * s); wingGrp.add(strut);
  }
  const wingStrip = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.3, 14.6), M.glow.clone());
  wingStrip.rotation.z = 0.16; wingStrip.position.y = 0.45; wingGrp.add(wingStrip);
  strips.push(wingStrip);
  wingGrp.position.set(-10.4, 10.4, 0); g.add(wingGrp);
  // --- 侧翼板（变形时向外张开的空力板） ---
  const flaps = [];
  for (const s of [-1, 1]){
    const fg = new THREE.Group(); fg.position.set(-5.2, 5.6, 6.2 * s);
    const fp = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.0, 0.4), M.paint);
    fp.position.x = -2.0; fg.add(fp);
    const fs = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.35, 0.42), M.glow.clone());
    fs.position.set(-2.0, 1.0, 0); fg.add(fs);
    strips.push(fs);
    fg.userData.side = s; g.add(fg); flaps.push(fg);
  }
  // --- 排气管（镀铬双管，变形时伸长） ---
  const exhTips = [];
  for (const s of [-1, 1]){
    const pipeGeo = new THREE.CylinderGeometry(0.95, 1.15, 3.2, 12);
    pipeGeo.rotateZ(Math.PI / 2);
    mesh(pipeGeo, M.carbon, -11.4, 4.6, 3.3 * s);
    const tipGeo = new THREE.CylinderGeometry(1.15, 1.35, 2.4, 12);
    tipGeo.rotateZ(Math.PI / 2);
    const tip = mesh(tipGeo, M.chrome, -13.0, 4.6, 3.3 * s);
    const tipIn = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 2.5, 10).rotateZ(Math.PI / 2), M.core);
    tip.add(tipIn);
    exhTips.push(tip);
  }
  // --- 尾灯条 ---
  const tail = mesh(new THREE.BoxGeometry(0.5, 0.9, 8.6), M.lampR.clone(), -12.2, 6.2, 0);
  // --- 车轮：轮胎圆环 + 金色轮圈 + 五辐条 + 刹车盘 + 变形光环 ---
  const wheels = [], fronts = [], spins = [], wheelRings = [];
  const mkWheel = (x, z, front) => {
    const wg = new THREE.Group(); wg.position.set(x, 3.6, z);
    const spinGrp = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(2.45, 1.2, 10, 18), M.tire);
    spinGrp.add(tire);
    const rimGeo = new THREE.CylinderGeometry(1.85, 1.85, 2.0, 14);
    rimGeo.rotateX(Math.PI / 2);
    spinGrp.add(new THREE.Mesh(rimGeo, M.rim));
    for (let i = 0; i < 5; i++){
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.3, 0.5), M.rim);
      spoke.rotation.z = i * Math.PI * 2 / 5;
      spoke.position.z = Math.sign(z) * 1.15;
      spinGrp.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), M.chrome);
    hub.position.z = Math.sign(z) * 1.35; spinGrp.add(hub);
    wg.add(spinGrp); spins.push(spinGrp);
    const discGeo = new THREE.CylinderGeometry(1.45, 1.45, 0.35, 12);
    discGeo.rotateX(Math.PI / 2);
    const disc = new THREE.Mesh(discGeo, M.chrome);
    disc.position.z = -Math.sign(z) * 0.6; wg.add(disc);
    const ringGeo = new THREE.TorusGeometry(3.05, 0.22, 8, 22);
    const ring = new THREE.Mesh(ringGeo, M.glow.clone());
    wg.add(ring); wheelRings.push(ring);
    g.add(wg); wheels.push(wg); if (front) fronts.push(wg);
  };
  mkWheel(8.2, -7.4, true); mkWheel(8.2, 7.4, true);
  mkWheel(-7.8, -7.8, false); mkWheel(-7.8, 7.8, false);
  // --- 车底能量光晕（变形时亮起） ---
  const under = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), M.glow.clone());
  under.rotation.x = -Math.PI / 2; under.position.y = 1.1; g.add(under);
  // --- 贴地阴影 ---
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(32, 32),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.55 }));
  shadow.rotation.x = -Math.PI / 2;
  // --- 氮气火焰 ---
  const flames = [];
  for (const s of [-1, 1]){
    const f = new THREE.Mesh(new THREE.ConeGeometry(1.5, 9, 10),
      new THREE.MeshBasicMaterial({ color: 0x57c8ff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    f.rotation.z = Math.PI / 2;
    f.position.set(-17.5, 4.6, 3.3 * s); f.visible = false;
    g.add(f); flames.push(f);
  }
  return { group: g, wheels, fronts, spins, shadow, flames, spin: 0,
    trans: { wingGrp, wingBaseY: 10.4, noseGrp, noseBaseX: 10.6, core, coreRing, flaps, exhTips,
      exhBaseX: -13.0, strips, under, wheelRings, tail } };
}
function buildTree(v){
  const g = new THREE.Group();
  if (theme.name.includes("沙")){
    const body = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 26, 10), toonMat(theme.treeTop));
    body.position.y = 13; g.add(body);
    for (const s of [-1, 1]){
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 12, 8), toonMat(theme.treeTop2));
      arm.position.set(0, 14 + s * 3, s * 5.4); arm.rotation.x = s * 0.5; g.add(arm);
    }
    const fl = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), toonMat("#ffb0d0"));
    fl.position.y = 27; g.add(fl);
  } else if (theme.name.includes("雪")){
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 10, 8), toonMat(theme.trunk));
    trunk.position.y = 5; g.add(trunk);
    for (let k = 0; k < 3; k++){
      const cone = new THREE.Mesh(new THREE.ConeGeometry(11 - k * 2.6, 12, 10), toonMat(k % 2 ? theme.treeTop : theme.treeTop2));
      cone.position.y = 12 + k * 7.5; g.add(cone);
    }
    const snow = new THREE.Mesh(new THREE.ConeGeometry(3.4, 5, 10), toonMat(0xffffff));
    snow.position.y = 36; g.add(snow);
  } else {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.6, 12, 8), toonMat(theme.trunk));
    trunk.position.y = 6; g.add(trunk);
    const top = new THREE.Mesh(new THREE.SphereGeometry(10, 12, 10), toonMat(v ? theme.treeTop : theme.treeTop2));
    top.position.y = 18; g.add(top);
    const b1 = new THREE.Mesh(new THREE.SphereGeometry(6.5, 10, 8), toonMat(theme.treeTop2));
    b1.position.set(6, 13, 3); g.add(b1);
    const b2 = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), toonMat(theme.treeTop));
    b2.position.set(-6, 13, -3); g.add(b2);
  }
  return g;
}
function buildSign(){
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 20, 8), toonMat(0x8b93a2));
  pole.position.y = 10; g.add(pole);
  const tex = makeSpriteTex((c, s) => {
    c.fillStyle = "#ffd23d"; c.fillRect(0, 0, s, s);
    c.strokeStyle = "#20242c"; c.lineWidth = 6; c.strokeRect(3, 3, s - 6, s - 6);
    c.fillStyle = "#20242c"; c.font = "bold 40px sans-serif"; c.textAlign = "center";
    c.fillText("→", s / 2, s / 2 + 14);
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 1.6),
    new THREE.MeshBasicMaterial({ map: tex }));
  board.position.y = 22; g.add(board);
  return g;
}
function buildGate(dir){
  const g = new THREE.Group();
  for (const s of [-1, 1]){
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(7, 46, 7), toonMat(0xc43a3a));
    pillar.position.set(0, 23, s * (ROAD_HALF + 26)); g.add(pillar);
  }
  const bc = document.createElement("canvas"); bc.width = 1024; bc.height = 64;
  const c2 = bc.getContext("2d");
  const grd = c2.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, "#ffd23d"); grd.addColorStop(1, "#ff9c20");
  c2.fillStyle = grd; c2.fillRect(0, 0, 1024, 64);
  c2.strokeStyle = "#20242c"; c2.lineWidth = 8; c2.strokeRect(2, 2, 1020, 60);
  c2.fillStyle = "#20242c"; c2.font = "bold 44px sans-serif"; c2.textAlign = "center";
  c2.fillText("疾 风 杯 GRAND PRIX", 512, 47);
  const bannerTex = new THREE.CanvasTexture(bc);
  const bw = (ROAD_HALF + 30) * 2;
  for (const s of [-1, 1]){                                 // 正反两面各一块，文字方向都正确
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bw, 15),
      new THREE.MeshBasicMaterial({ map: bannerTex }));
    face.position.set(s * 2.2, 50, 0);
    face.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(face);
  }
  g.rotation.y = -dir;
  return g;
}
function buildScene(){
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(theme.skyBot), 650, 2400);
  renderer.setClearColor(new THREE.Color(theme.skyBot));
  if (!circleTex) circleTex = softCircleTex();
  if (!blobTex) blobTex = makeSpriteTex((c, s) => {
    const g = c.createRadialGradient(s/2, s/2, 2, s/2, s/2, s/2 * 0.9);
    g.addColorStop(0, "rgba(0,0,0,0.75)"); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  });
  // 光照
  scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(theme.grass2), 0.95));
  const sun = new THREE.DirectionalLight(0xfff2d8, 0.85);
  sun.position.set(600, 900, -400); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xcfe4ff, 0.35);       // 轮廓补光(车漆高光)
  rim.position.set(-500, 400, 600); scene.add(rim);
  // 天空穹顶（渐变 + 不受雾影响）
  const skyTex = makeSpriteTex((c, s) => {
    const g = c.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, theme.skyTop); g.addColorStop(0.62, theme.skyBot); g.addColorStop(1, theme.skyBot);
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  }, 256);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3400, 20, 14),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  sky.position.set(TEX / 2, 0, TEX / 2); scene.add(sky);
  // 太阳光晕
  const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: circleTex, color: 0xfff5b4, fog: false, transparent: true, opacity: 0.95 }));
  sunSpr.scale.set(340, 340, 1); sunSpr.position.set(TEX / 2 + 1500, 1250, TEX / 2 - 1100);
  scene.add(sunSpr);
  // 云
  cloudMeshes = [];
  const rand = mulberry32(77);
  for (let i = 0; i < 10; i++){
    const cl = new THREE.Group();
    for (let k = 0; k < 3; k++){
      const puff = new THREE.Mesh(new THREE.SphereGeometry(26 + rand() * 18, 10, 8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.cloud), fog: false }));
      puff.position.set(k * 34 - 34, (k === 1 ? 12 : 0), rand() * 14);
      puff.scale.y = 0.6; cl.add(puff);
    }
    const a = rand() * Math.PI * 2, r = 900 + rand() * 1500;
    cl.position.set(TEX / 2 + Math.cos(a) * r, 380 + rand() * 260, TEX / 2 + Math.sin(a) * r);
    cl.userData.w = 3 + rand() * 5;
    scene.add(cl); cloudMeshes.push(cl);
  }
  // 远山环
  const mrand = mulberry32(31 + G.trackIdx);
  for (let i = 0; i < 16; i++){
    const a = i / 16 * Math.PI * 2 + mrand() * 0.3;
    const r = 1350 + mrand() * 500, hgt = 160 + mrand() * 260;
    const m = new THREE.Mesh(new THREE.ConeGeometry(220 + mrand() * 160, hgt, 7),
      toonMat(i % 2 ? theme.mount : theme.mount2));
    m.position.set(TEX / 2 + Math.cos(a) * r, hgt * 0.32, TEX / 2 + Math.sin(a) * r);
    scene.add(m);
  }
  // 地形 + 赛道纹理
  groundTex = new THREE.CanvasTexture(texCan);
  groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(gridGeometry(150, terrainH),
    new THREE.MeshBasicMaterial({ map: groundTex }));
  scene.add(ground);
  // 轮胎痕迹覆盖层
  marksCan = document.createElement("canvas"); marksCan.width = marksCan.height = 1024;
  marksCtx = marksCan.getContext("2d");
  marksTex = new THREE.CanvasTexture(marksCan);
  const marks = new THREE.Mesh(gridGeometry(100, (x, y) => terrainH(x, y) + 0.8),
    new THREE.MeshBasicMaterial({ map: marksTex, transparent: true, depthWrite: false }));
  scene.add(marks);
  // 加速带光柱
  padGlows = [];
  for (const pad of pads){
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(96, 78),
      new THREE.MeshBasicMaterial({ map: circleTex, color: 0xffa028, transparent: true, opacity: 0.35, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.rotation.z = -pad.dir;
    glow.position.set(pad.x, terrainH(pad.x, pad.y) + 0.9, pad.y);
    scene.add(glow); padGlows.push(glow);
  }
  // 路旁装饰
  for (const d of decors){
    let m;
    if (d.type === "tree") m = buildTree(d.v);
    else if (d.type === "sign") m = buildSign();
    else m = buildGate(d.dir);
    m.position.set(d.x, terrainH(d.x, d.y), d.y);
    if (d.type !== "gate") m.rotation.y = mulberry32(d.x | 0)() * Math.PI * 2;
    scene.add(m);
  }
  // 卡丁车
  kartMeshMap = new Map();
  for (const k of G.karts){
    const km = buildKartMesh(k.color);
    scene.add(km.group); scene.add(km.shadow);
    kartMeshMap.set(k, km);
  }
  // 粒子精灵池
  particlePool = [];
  for (let i = 0; i < PARTICLE_MAX; i++){
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: circleTex, transparent: true, depthWrite: false }));
    s.visible = false; scene.add(s); particlePool.push(s);
  }
}

// ---------- 卡丁车实体 ----------
function makeKart(name, color, isPlayer, startSlot){
  const p0 = path[(pathN - 8 - startSlot * 6 + pathN) % pathN];
  const side = (startSlot % 2 === 0) ? -1 : 1;
  return {
    name, color, isPlayer,
    x: p0.x - p0.dy * side * 42, y: p0.y + p0.dx * side * 42,
    angle: p0.dir, vx: 0, vy: 0, speed: 0, h: 0, pitch: 0, steerVis: 0,
    drifting: false, driftT: 0, gauge: 0, nitroCount: 0,
    boostT: 0, boostKind: "", cutT: 0, dualT: 0, padT: 0, transP: 0, brk: 0,
    idx: (pathN - 8 - startSlot * 6 + pathN) % pathN, lap: 1, halfFlag: false,
    lapTimes: [], lapStart: 0, finished: false, finishTime: 0,
    offroad: false, wallHit: 0, visSlip: 0, rank: startSlot + 1,
    ai: isPlayer ? null : { skill: 0.88 + startSlot * 0.025, look: 26 + (startSlot % 3) * 6,
      lane: (startSlot % 3 - 1) * 34, driftUntil: 0, nitroCd: 3 + startSlot * 2 },
    startCharge: false
  };
}

// ---------- 游戏状态 ----------
const G = {
  state: "MENU",
  karts: [], player: null,
  trackIdx: 0, colorIdx: 0,
  camX: 0, camY: 0, camA: 0, shake: 0, fov: 62,
  time: 0, raceTime: 0, countT: 0, goFlash: 0,
  bestLap: 0, banners: [], particles: [], marks: 0,
  startPressT: -99, startBoostMsg: "", wrongWayT: 0,
  fps: 60, fpsAcc: 0, fpsN: 0, finishCoolT: 0
};
window.__game = G; // 自动测试接口
window.__test = {
  press(k){ if (!keys[k]) keyPressed(k); keys[k] = true; },
  release(k){ keys[k] = false; keyReleased(k); },
  start(t, c){ startRace(t == null ? 0 : t, c == null ? 0 : c); },
  autoSteer(v){ G.autoSteer = !!v; },
  setCam(o){ G.camOverride = o || null; },
  placeOnStraight(spd){
    let bi = 0, bc = 1e9;
    for (let i = 0; i < pathN; i++){
      let c = 0;
      for (let k2 = 0; k2 < 40; k2 += 5) c += Math.abs(path[(i + k2) % pathN].curv);
      if (c < bc){ bc = c; bi = i; }
    }
    const P = G.player, p = path[bi];
    P.x = p.x; P.y = p.y; P.angle = p.dir; P.idx = bi;
    P.speed = spd == null ? 200 : spd;
    P.vx = Math.cos(p.dir) * P.speed; P.vy = Math.sin(p.dir) * P.speed;
    G.camA = p.dir;
  },
  PH
};

function banner(text, color, dur){
  G.banners.push({ text, color: color || "#ffd23d", t: 0, dur: dur || 1.4 });
}

function startRace(trackIdx, colorIdx){
  G.trackIdx = trackIdx; G.colorIdx = colorIdx;
  buildTrack(trackIdx);
  initThree();
  G.karts = [];
  const cols = KART_COLORS.slice();
  const pc = cols.splice(colorIdx, 1)[0];
  G.player = makeKart("玩家", pc, true, 0);
  G.karts.push(G.player);
  for (let i = 0; i < 5; i++) G.karts.push(makeKart(AI_NAMES[i], cols[i % cols.length], false, i + 1));
  for (const k of G.karts){ k.idx = nearestOnPath(k.x, k.y, k.idx); }
  buildScene();
  G.state = "COUNTDOWN"; G.countT = 3.6; G.raceTime = 0; G.bestLap = 0;
  G.banners = []; G.particles = []; G.startPressT = -99; G.startBoostMsg = "";
  G.camA = G.player.angle; G.fov = 62;
  document.getElementById("menu").style.display = "none";
  document.getElementById("result").style.display = "none";
  document.getElementById("pause").style.display = "none";
  initAudio();
  if (SFX.ac && SFX.ac.state === "suspended") SFX.ac.resume();
}

// ---------- 按键事件 ----------
function keyPressed(k){
  const P = G.player; if (!P) return;
  if (k === "up" && G.state === "COUNTDOWN") G.startPressT = G.countT;
  if (k === "nitro" && (G.state === "RACING" || G.state === "FINISH") && !P.finished) tryNitro(P);
}
function keyReleased(k){
  const P = G.player; if (!P) return;
  if (k === "drift" && P.drifting) endDrift(P);
}
function tryNitro(k){
  if (k.nitroCount <= 0) return;
  k.nitroCount--;
  const dual = k.dualT > 0;
  k.boostT = PH.nitroTime + (dual ? 0.5 : 0);
  k.boostKind = dual ? "dual" : "nitro";
  k.dualT = 0;
  if (k.isPlayer){ whoosh(); if (dual) banner("双喷！", "#ff7a00", 1.2); G.shake = Math.max(G.shake, 4); }
}
function endDrift(k){
  if (!k.drifting) return;
  k.drifting = false;
  if (k.driftT > 0.28){
    k.cutT = PH.cutBoostTime;
    k.dualT = PH.dualWindow;
  }
  k.driftT = 0;
}

// ---------- 物理更新 ----------
function fwdOf(a){ return { x: Math.cos(a), y: Math.sin(a) }; }
function updateKart(k, dt){
  const P = k.isPlayer && !k.finished && (G.state === "RACING" || G.state === "FINISH");
  let thr = 0, brk = 0, steer = 0, wantDrift = false;
  if (P){
    thr = keys.up ? 1 : 0; brk = keys.down ? 1 : 0;
    steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    wantDrift = !!keys.drift;
    if (G.autoSteer && steer === 0){ // 测试用自动循线
      const tp = path[(k.idx + 26) % pathN];
      steer = clamp(angDiff(Math.atan2(tp.y - k.y, tp.x - k.x), k.angle) * 3.2, -1, 1);
    }
  } else {
    // ---- AI ----
    const ai = k.ai || (k.ai = { skill: 0.95, look: 26, lane: 0, driftUntil: 0, nitroCd: 4 });
    const tp = path[(k.idx + ai.look) % pathN];
    const nx = -tp.dy, ny = tp.dx;
    const tx = tp.x + nx * ai.lane, ty = tp.y + ny * ai.lane;
    const da = angDiff(Math.atan2(ty - k.y, tx - k.x), k.angle);
    steer = clamp(da * 3.2, -1, 1);
    thr = 1;
    const curvAhead = Math.abs(path[(k.idx + 30) % pathN].curv);
    if (curvAhead > 0.32 && k.speed > 190) thr = 0.55;
    if (curvAhead > 0.3 && k.speed > PH.driftMinSpd && G.time > ai.driftUntil + 1.2){
      ai.driftUntil = G.time + 0.7 + Math.random() * 0.4;
    }
    wantDrift = G.time < ai.driftUntil;
    ai.nitroCd -= dt;
    if (ai.nitroCd <= 0 && k.nitroCount > 0 && Math.abs(da) < 0.12 && curvAhead < 0.15){
      tryNitro(k); ai.nitroCd = 5 + Math.random() * 5;
    }
    const gap = (G.player.lap * pathN + G.player.idx) - (k.lap * pathN + k.idx);
    k.rubber = clamp(gap * 0.0004, -0.06, 0.09) * (k.finished ? 0 : 1);
  }
  if (G.state === "COUNTDOWN"){ thr = 0; brk = 0; steer = 0; wantDrift = false; }
  if (k.finished){
    const tp = path[(k.idx + 24) % pathN];
    const da = angDiff(Math.atan2(tp.y - k.y, tp.x - k.x), k.angle);
    steer = clamp(da * 3, -1, 1); thr = 0.6; wantDrift = false;
  }
  k.steerVis += (steer - k.steerVis) * clamp(10 * dt, 0, 1);
  k.brk = brk;

  // 漂移状态机
  if (wantDrift && !k.drifting && k.speed > PH.driftMinSpd && Math.abs(steer) > 0.15){
    k.drifting = true; k.driftT = 0;
  }
  if (k.drifting){
    k.driftT += dt;
    if (k.speed < PH.driftMinSpd * 0.6 || (!wantDrift)) endDrift(k);
  }
  if (k.dualT > 0) k.dualT -= dt;

  // 集气
  if (k.drifting){
    k.gauge += PH.gaugeRate * dt * (0.7 + Math.abs(steer) * 0.6) * (k.speed / PH.maxSpd);
    if (k.gauge >= 100){
      k.gauge = 0;
      if (k.nitroCount < 2){ k.nitroCount++; if (k.isPlayer){ blip(880, 0.12, "sine", 0.3); blip(1320, 0.2, "sine", 0.3, 0.1); banner("N₂O 充能完毕！", "#3ec4ff", 1.0); } }
    }
  }

  // 速度目标
  let maxS = PH.maxSpd, acc = PH.accel;
  if (k.boostT > 0){ maxS = PH.nitroMaxSpd; acc = 4.6; k.boostT -= dt; }
  else if (k.padT > 0){ maxS = PH.nitroMaxSpd * 0.94; acc = 4.2; k.padT -= dt; }
  else if (k.cutT > 0){ maxS = PH.maxSpd * 1.12; acc = 4.0; k.cutT -= dt; }
  if (k.rubber) maxS *= (1 + k.rubber);
  if (!k.isPlayer) maxS *= k.ai ? k.ai.skill : 1;
  if (k.offroad && k.padT <= 0 && k.boostT <= 0) maxS *= PH.offroadFactor;
  if (k.drifting) maxS *= 0.96;

  if (thr > 0) k.speed += (maxS - k.speed) * clamp(acc * dt, 0, 1) * thr;
  else k.speed -= k.speed * 0.55 * dt;
  if (brk > 0) k.speed -= 260 * brk * dt;
  if (k.speed > maxS) k.speed += (maxS - k.speed) * clamp(2.2 * dt, 0, 1);
  k.speed = Math.max(k.speed, brk > 0 && k.speed <= 2 ? -60 : k.speed < 0 ? k.speed : 0);
  if (k.speed < -60) k.speed = -60;

  // 坡道影响：上坡减速、下坡加速（真 3D 地形反馈）
  const f0 = fwdOf(k.angle);
  const slope = (terrainH(k.x + f0.x * 14, k.y + f0.y * 14) - terrainH(k.x - f0.x * 14, k.y - f0.y * 14)) / 28;
  if (Math.abs(k.speed) > 40) k.speed -= slope * 58 * dt;
  k.pitch = k.pitch + (Math.atan(slope) - k.pitch) * clamp(8 * dt, 0, 1);

  // 转向
  const spdF = clamp(Math.abs(k.speed) / 140, 0, 1);
  const tr = k.drifting ? PH.driftTurnRate : PH.turnRate * (1.15 - 0.3 * spdF);
  k.angle += steer * tr * dt * clamp(Math.abs(k.speed) / 90, 0, 1) * (k.speed < 0 ? -1 : 1);

  // 抓地/漂移滑动模型
  const f = fwdOf(k.angle);
  const grip = k.drifting ? PH.gripDrift : PH.gripNormal;
  const dvx = f.x * k.speed, dvy = f.y * k.speed;
  const t = clamp(grip * dt, 0, 1);
  k.vx += (dvx - k.vx) * t; k.vy += (dvy - k.vy) * t;
  k.x += k.vx * dt; k.y += k.vy * dt;
  k.h = terrainH(k.x, k.y);

  // 视觉侧滑角；限制最大甩尾角，保持泡泡卡丁车式可控漂移
  const velA = Math.hypot(k.vx, k.vy) > 20 ? Math.atan2(k.vy, k.vx) : k.angle;
  k.visSlip = angDiff(k.angle, velA);
  const MAXSLIP = 0.72;
  if (k.drifting && Math.abs(k.visSlip) > MAXSLIP){
    k.angle = velA + Math.sign(k.visSlip) * MAXSLIP;
    k.visSlip = Math.sign(k.visSlip) * MAXSLIP;
  }

  // 赛道定位 / 路肩 / 撞墙
  const prevIdx = k.idx;
  k.idx = nearestOnPath(k.x, k.y, k.idx);
  const cp = path[k.idx];
  const nx = -cp.dy, ny = cp.dx;
  const lat = (k.x - cp.x) * nx + (k.y - cp.y) * ny;
  k.offroad = Math.abs(lat) > ROAD_HALF + 6;
  const wallD = ROAD_HALF + SHOULDER;
  if (Math.abs(lat) > wallD){
    const s = Math.sign(lat);
    k.x = cp.x + nx * s * wallD; k.y = cp.y + ny * s * wallD;
    const vn = k.vx * nx + k.vy * ny;
    k.vx -= vn * nx * 1.4; k.vy -= vn * ny * 1.4;
    k.speed *= 0.72; k.wallHit = 0.3;
    if (k.isPlayer){ G.shake = 7; thud(); }
  }
  if (k.wallHit > 0) k.wallHit -= dt;

  // 加速带
  for (const pad of pads){
    const dx = k.x - pad.x, dy = k.y - pad.y;
    if (dx * dx + dy * dy < 55 * 55){
      if (k.padT <= 0 && k.isPlayer){ blip(520, 0.25, "sawtooth", 0.2); }
      k.padT = Math.max(k.padT, PH.padBoostTime);
    }
  }

  // 圈数
  if (k.idx > pathN * 0.45 && k.idx < pathN * 0.6) k.halfFlag = true;
  if (prevIdx > pathN * 0.9 && k.idx < pathN * 0.1 && k.halfFlag){
    k.halfFlag = false;
    const lapT = G.raceTime - k.lapStart; k.lapStart = G.raceTime;
    if (k.lap >= 1 && lapT > 5) k.lapTimes.push(lapT);
    if (k.isPlayer && lapT > 5 && (!G.bestLap || lapT < G.bestLap)) G.bestLap = lapT;
    k.lap++;
    if (k.lap > TOTAL_LAPS && !k.finished){
      k.finished = true; k.finishTime = G.raceTime;
      if (k.isPlayer){
        G.state = "FINISH"; G.finishCoolT = 8;
        banner("冲线！", "#ffd23d", 2);
        blip(660, 0.15, "square", 0.3); blip(880, 0.15, "square", 0.3, 0.15); blip(1100, 0.3, "square", 0.3, 0.3);
      }
    } else if (k.isPlayer){
      banner(k.lap === TOTAL_LAPS ? "最后一圈！" : `第 ${k.lap} 圈`, "#fff", 1.3);
      blip(740, 0.15, "sine", 0.25);
    }
  } else if (prevIdx < pathN * 0.1 && k.idx > pathN * 0.9 && !k.halfFlag){
    k.lap = Math.max(1, k.lap - 1); k.halfFlag = true;
  }

  // 逆行提示
  if (k.isPlayer){
    const vdot = k.vx * cp.dx + k.vy * cp.dy;
    if (vdot < -40 && k.speed > 40) G.wrongWayT += dt; else G.wrongWayT = 0;
  }
}
function kartCollisions(){
  for (let i = 0; i < G.karts.length; i++) for (let j = i + 1; j < G.karts.length; j++){
    const a = G.karts[i], b = G.karts[j];
    const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
    if (d2 < 26 * 26 && d2 > 0.01){
      const d = Math.sqrt(d2), px = dx / d, py = dy / d, ov = (26 - d) / 2;
      a.x -= px * ov; a.y -= py * ov; b.x += px * ov; b.y += py * ov;
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy, rel = rvx * px + rvy * py;
      if (rel < 0){
        a.vx += px * rel * 0.4; a.vy += py * rel * 0.4;
        b.vx -= px * rel * 0.4; b.vy -= py * rel * 0.4;
        if ((a.isPlayer || b.isPlayer) && Math.abs(rel) > 60){ G.shake = Math.max(G.shake, 4); thud(); }
      }
    }
  }
}
function updateRanks(){
  const arr = G.karts.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1; if (b.finished) return 1;
    return (b.lap * pathN + b.idx) - (a.lap * pathN + a.idx);
  });
  arr.forEach((k, i) => {
    if (k.isPlayer && k.rank !== i + 1 && G.state === "RACING" && G.raceTime > 4){
      if (i + 1 < k.rank) blip(980, 0.1, "sine", 0.15);
    }
    k.rank = i + 1;
  });
}

// ---------- 粒子（世界坐标模拟，3D 精灵渲染） ----------
function spawnParticles(dt){
  for (const k of G.karts){
    // 漂移火花与烟雾
    if (k.drifting && Math.abs(k.visSlip) > 0.12){
      const f = fwdOf(k.angle), rx = -f.y, ry = f.x;
      for (const s of [-1, 1]){
        if (Math.random() < 0.75){
          const wx = k.x - f.x * 10 + rx * 7 * s, wy = k.y - f.y * 10 + ry * 7 * s;
          const full = k.isPlayer && k.gauge > 72;
          G.particles.push({ wx, wy, z: 3, vx: -k.vx * 0.1 + (Math.random() - 0.5) * 40,
            vy: -k.vy * 0.1 + (Math.random() - 0.5) * 40, vz: 30 + Math.random() * 60,
            life: 0.35, t: 0, r: 3.2, color: full ? "#ff5030" : (Math.random() < 0.5 ? "#ffd23d" : "#fff2a0"), alpha: 1, kind: "spark" });
        }
        if (Math.random() < 0.4){
          const wx = k.x - f.x * 12 + rx * 8 * s, wy = k.y - f.y * 12 + ry * 8 * s;
          G.particles.push({ wx, wy, z: 4, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20,
            vz: 26, life: 0.7, t: 0, r: 7, color: "#dcdce1", alpha: 0.55, kind: "smoke" });
        }
      }
      // 轮胎痕烙印
      if (marksCtx && (G.marks++ % 2 === 0)){
        const f2 = fwdOf(k.angle), rx2 = -f2.y, ry2 = f2.x, ms = 1024 / TEX;
        marksCtx.fillStyle = "rgba(30,30,34,0.28)";
        for (const s of [-1, 1]){
          marksCtx.beginPath();
          marksCtx.arc((k.x - f2.x * 10 + rx2 * 7 * s) * ms, (k.y - f2.y * 10 + ry2 * 7 * s) * ms, 1.6, 0, 7);
          marksCtx.fill();
        }
        marksDirty = 1;
      }
    }
    // 氮气/加速火焰粒子
    if (k.boostT > 0 || k.padT > 0 || k.cutT > 0){
      const f = fwdOf(k.angle), rx = -f.y, ry = f.x;
      for (const s of [-1, 1]){
        if (Math.random() < 0.85){
          const wx = k.x - f.x * 14 + rx * 3.4 * s, wy = k.y - f.y * 14 + ry * 3.4 * s;
          const blue = k.boostT > 0;
          G.particles.push({ wx, wy, z: 5, vx: -f.x * 130 + (Math.random() - 0.5) * 30,
            vy: -f.y * 130 + (Math.random() - 0.5) * 30, vz: 8,
            life: 0.28, t: 0, r: 4.6, color: blue ? (Math.random() < 0.5 ? "#57c8ff" : "#cdeeff") : "#ffb020", alpha: 0.95, kind: "flame" });
        }
      }
    }
    // 出弯道尘土
    if (k.offroad && k.speed > 60 && Math.random() < 0.5){
      G.particles.push({ wx: k.x, wy: k.y, z: 3, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 50,
        vz: 40, life: 0.6, t: 0, r: 6,
        color: theme.name.includes("雪") ? "#ffffff" : "#a08250", alpha: 0.7, kind: "smoke" });
    }
  }
  for (let i = G.particles.length - 1; i >= 0; i--){
    const p = G.particles[i]; p.t += dt;
    if (p.t > p.life){ G.particles.splice(i, 1); continue; }
    p.wx += p.vx * dt; p.wy += p.vy * dt; p.z += p.vz * dt; p.vz -= 60 * dt;
    if (p.z < 0) p.z = 0;
  }
  if (G.particles.length > PARTICLE_MAX) G.particles.splice(0, G.particles.length - PARTICLE_MAX);
}

// ---------- 3D 场景逐帧同步 ----------
const _tmpV = () => new THREE.Vector3();
function syncScene(dt){
  // 卡丁车
  for (const k of G.karts){
    const m = kartMeshMap.get(k); if (!m) continue;
    const bob = Math.sin(G.time * 21 + k.idx) * clamp(k.speed / 300, 0, 1) * 0.5;
    m.group.position.set(k.x, k.h + 0.4 + bob, k.y);
    m.group.rotation.order = "YZX";
    m.group.rotation.y = -k.angle;
    m.group.rotation.z = -k.pitch;                        // 上下坡俯仰
    let lean = -k.visSlip * 0.3;                          // 漂移侧倾
    if (k.wallHit > 0) lean += Math.sin(G.time * 40) * 0.06;
    m.group.rotation.x = lean;
    m.spin += k.speed * dt / 3.5;
    for (const sp of m.spins) sp.rotation.z = -m.spin;
    for (const fw of m.fronts) fw.rotation.y = -k.steerVis * 0.42 + (k.drifting ? -k.visSlip * 0.3 : 0);
    m.shadow.position.set(k.x, k.h + 0.55, k.y);
    const boosting = k.boostT > 0;
    // ---- 氮气变形（跑跑卡丁车式：喷射时机甲展开） ----
    k.transP = k.transP == null ? 0 : k.transP;
    const prevP = k.transP;
    k.transP += ((boosting ? 1 : 0) - k.transP) * clamp(7 * dt, 0, 1);
    if (k.isPlayer && prevP < 0.4 && k.transP >= 0.4){          // 变形机械音
      blip(220, 0.09, "square", 0.22); blip(330, 0.09, "square", 0.22, 0.07); blip(520, 0.14, "sawtooth", 0.18, 0.13);
    }
    const p = k.transP * k.transP * (3 - 2 * k.transP);         // 平滑缓动
    const T = m.trans;
    T.wingGrp.position.y = T.wingBaseY + p * 3.2;               // 尾翼抬升展开
    T.wingGrp.rotation.z = p * 0.34;
    T.wingGrp.scale.z = 1 + p * 0.18;
    T.noseGrp.position.x = T.noseBaseX + p * 3.0;               // 鼻锥前移露出涡轮
    for (const fg of T.flaps) fg.rotation.y = -fg.userData.side * p * 0.85;  // 侧翼板张开
    for (let i = 0; i < T.exhTips.length; i++) T.exhTips[i].position.x = T.exhBaseX - p * 2.4;
    T.core.rotation.x += dt * (4 + 46 * p);                     // 涡轮旋转
    T.core.visible = true;
    for (const st of T.strips) st.material.opacity = 0.10 + 0.9 * p;
    for (const r of T.wheelRings){ r.material.opacity = p * 0.95; r.scale.setScalar(1 + p * 0.12); }
    T.under.material.opacity = p * 0.5;
    T.tail.material.opacity = 0.4 + (k.brk ? 0.6 : 0) + p * 0.2; // 刹车灯
    for (const fl of m.flames){
      fl.visible = boosting || k.padT > 0 || k.cutT > 0;
      if (fl.visible){
        const sc = (0.8 + Math.random() * 0.5) * (1 + p * 0.5);
        fl.scale.set(sc, boosting ? 1.25 : 0.65, sc);
        fl.material.color.set(boosting ? 0x57c8ff : 0xffb020);
      }
    }
  }
  // 粒子
  for (let i = 0; i < particlePool.length; i++){
    const s = particlePool[i], p = G.particles[i];
    if (!p){ s.visible = false; continue; }
    s.visible = true;
    const grow = p.kind === "smoke" ? (1 + p.t * 3) : 1;
    const sc = p.r * 2 * grow;
    s.scale.set(sc, sc, 1);
    s.position.set(p.wx, terrainH(p.wx, p.wy) + p.z + 2, p.wy);
    s.material.color.set(p.color);
    s.material.opacity = p.alpha * (1 - p.t / p.life);
  }
  // 加速带脉动
  const pulse = 0.5 + 0.5 * Math.sin(G.time * 8);
  for (const gsp of padGlows){ gsp.material.opacity = 0.22 + 0.3 * pulse; }
  // 云漂移
  for (const cl of cloudMeshes){ cl.position.x += cl.userData.w * dt; }
  // 轮胎痕纹理节流上传
  if (marksDirty && (G.time % 0.14) < dt){ marksTex.needsUpdate = true; marksDirty = 0; }
  // 相机：第三人称追尾 + FOV 冲刺变化 + 地形避障
  const P = G.player;
  const vlen = Math.hypot(P.vx, P.vy);
  const targetA = vlen > 60 ? Math.atan2(P.vy, P.vx) : P.angle;
  G.camA += angDiff(targetA, G.camA) * clamp(5 * dt, 0, 1);
  const boosting = P.boostT > 0;
  const back = 64 + clamp(P.speed / PH.nitroMaxSpd, 0, 1) * 14 + (boosting ? 8 : 0);
  let cx = P.x - Math.cos(G.camA) * back;
  let cy = P.y - Math.sin(G.camA) * back;
  if (G.shake > 0){
    cx += (Math.random() - 0.5) * G.shake; cy += (Math.random() - 0.5) * G.shake;
    G.shake -= 30 * dt;
  }
  const camGround = terrainH(cx, cy);
  const camY = Math.max(P.h + 29, camGround + 9);
  camera.position.set(cx, camY, cy);
  camera.lookAt(P.x + Math.cos(G.camA) * 24, P.h + 10, P.y + Math.sin(G.camA) * 24);
  const targetFov = boosting ? 74 : 62 + clamp(P.speed / PH.maxSpd, 0, 1) * 5;
  G.fov += (targetFov - G.fov) * clamp(6 * dt, 0, 1);
  camera.fov = G.fov; camera.updateProjectionMatrix();
  if (G.camOverride){                                       // 测试/展示用相机覆盖
    const o = G.camOverride;
    camera.position.set(o.x, o.y, o.z); camera.lookAt(o.tx, o.ty, o.tz);
  }
}
// 世界坐标 → HUD 屏幕坐标（供名字标签等）
function worldToScreen(x, h, y){
  const v = new THREE.Vector3(x, h, y).project(camera);
  if (v.z > 1) return null;
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
}

// ---------- HUD（2D 覆盖层） ----------
function fmtTime(t){
  if (!t || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 100);
  return `${m}'${String(s).padStart(2, "0")}"${String(ms).padStart(2, "0")}`;
}
function drawRounded(c, x, y, w, h, r){
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function roundPanel(x, y, w, h){
  ctx.fillStyle = "rgba(10,18,40,0.5)";
  drawRounded(ctx, x, y, w, h, 12); ctx.fill();
}
function drawNameTags(){
  for (const k of G.karts){
    if (k.isPlayer) continue;
    const d2 = (k.x - G.player.x) ** 2 + (k.y - G.player.y) ** 2;
    if (d2 > 600 * 600) continue;
    const s = worldToScreen(k.x, k.h + 19, k.y);
    if (!s || s.x < -40 || s.x > W + 40 || s.y < 0 || s.y > H) continue;
    ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.strokeStyle = "rgba(20,30,60,0.8)"; ctx.lineWidth = 3;
    ctx.strokeText(k.name, s.x, s.y); ctx.fillText(k.name, s.x, s.y);
  }
}
function drawSpeedFX(){
  const P = G.player;
  if (!(P.boostT > 0 || P.padT > 0)) return;
  ctx.save(); ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++){
    const a = Math.random() * Math.PI * 2, r1 = 190 + Math.random() * 80, r2 = r1 + 60 + Math.random() * 130;
    ctx.beginPath();
    ctx.moveTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1 * 0.7);
    ctx.lineTo(W / 2 + Math.cos(a) * r2, H / 2 + Math.sin(a) * r2 * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}
function drawHUD(){
  const P = G.player;
  ctx.textBaseline = "alphabetic";
  // 左上：圈数 + 名次
  roundPanel(14, 12, 150, 74);
  ctx.fillStyle = "#fff"; ctx.font = "bold 15px sans-serif"; ctx.textAlign = "left";
  ctx.fillText("圈数", 28, 36);
  ctx.font = "bold 26px sans-serif";
  ctx.fillText(`${Math.min(P.lap, TOTAL_LAPS)} / ${TOTAL_LAPS}`, 76, 38);
  const rc = P.rank === 1 ? "#ffd23d" : P.rank <= 3 ? "#9fd0ff" : "#fff";
  ctx.fillStyle = rc; ctx.font = "bold 34px sans-serif";
  ctx.fillText(String(P.rank), 30, 78);
  ctx.font = "bold 16px sans-serif"; ctx.fillText(` / ${G.karts.length} 位`, 56, 76);
  // 顶部中央：计时
  roundPanel(W / 2 - 92, 12, 184, 52);
  ctx.fillStyle = "#fff"; ctx.font = "bold 24px 'Consolas', monospace"; ctx.textAlign = "center";
  ctx.fillText(fmtTime(G.raceTime), W / 2, 43);
  ctx.font = "12px sans-serif"; ctx.fillStyle = "#ffd23d";
  ctx.fillText(G.bestLap ? "最速圈 " + fmtTime(G.bestLap) : "最速圈 --'--\"--", W / 2, 59);
  // 右上：小地图
  const mx = W - 168, my = 12;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "rgba(10,18,40,0.68)";
  drawRounded(ctx, mx - 6, my - 4, 162, 162, 12); ctx.fill();
  ctx.drawImage(miniCan, mx, my);
  const ms = 150 / TEX;
  for (const k of G.karts){
    ctx.fillStyle = k.isPlayer ? "#ffd23d" : k.color;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mx + k.x * ms, my + k.y * ms, k.isPlayer ? 5 : 3.6, 0, 7);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  // 底部中央：集气条
  const gx = W / 2 - 130, gy = H - 46;
  ctx.save();
  ctx.fillStyle = "rgba(10,18,40,0.55)";
  drawRounded(ctx, gx - 8, gy - 9, 276, 30, 14); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 2;
  drawRounded(ctx, gx, gy - 2, 260, 16, 8); ctx.stroke();
  const gw = 260 * clamp(P.gauge / 100, 0, 1);
  if (gw > 2){
    const gg = ctx.createLinearGradient(gx, 0, gx + 260, 0);
    gg.addColorStop(0, "#3ec4ff"); gg.addColorStop(0.7, "#57e0ff"); gg.addColorStop(1, "#fff45e");
    ctx.fillStyle = gg;
    drawRounded(ctx, gx, gy - 2, gw, 16, 8); ctx.fill();
  }
  if (P.gauge > 88 || (P.drifting && Math.sin(G.time * 16) > 0)){
    ctx.strokeStyle = "rgba(255,244,94,0.9)"; drawRounded(ctx, gx - 3, gy - 5, 266, 22, 10); ctx.stroke();
  }
  ctx.fillStyle = "#cfe8ff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("DRIFT 集气", gx + 130, gy + 24);
  ctx.restore();
  // 氮气罐
  for (let i = 0; i < 2; i++){
    const nx = W / 2 + 160 + i * 40, ny = H - 42;
    ctx.save();
    ctx.globalAlpha = i < P.nitroCount ? 1 : 0.28;
    const g = ctx.createLinearGradient(nx - 10, ny - 20, nx + 10, ny + 16);
    g.addColorStop(0, "#9fe8ff"); g.addColorStop(0.5, "#2ea8e8"); g.addColorStop(1, "#1a6aa8");
    ctx.fillStyle = g; ctx.strokeStyle = "#0c2a4a"; ctx.lineWidth = 2;
    drawRounded(ctx, nx - 10, ny - 16, 20, 32, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#e8f6ff"; drawRounded(ctx, nx - 5, ny - 22, 10, 8, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("N₂O", nx, ny + 2);
    if (i < P.nitroCount && Math.sin(G.time * 6 + i) > 0.4){
      ctx.strokeStyle = "rgba(255,255,255,0.8)"; drawRounded(ctx, nx - 13, ny - 19, 26, 38, 10); ctx.stroke();
    }
    ctx.restore();
  }
  // 右下：速度表
  const sx = W - 92, sy = H - 88, R = 64;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, R, 0, 7);
  const sg = ctx.createRadialGradient(sx, sy, 10, sx, sy, R);
  sg.addColorStop(0, "rgba(20,30,60,0.82)"); sg.addColorStop(1, "rgba(8,14,34,0.9)");
  ctx.fillStyle = sg; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = P.boostT > 0 ? "#57c8ff" : "rgba(255,255,255,0.75)"; ctx.stroke();
  const kmh = Math.abs(P.speed) * PH.spdKmh + (P.boostT > 0 ? 4 * Math.random() : 0);
  const maxKmh = 260;
  for (let v = 0; v <= maxKmh; v += 20){
    const a = Math.PI * 0.75 + (v / maxKmh) * Math.PI * 1.5;
    const r1 = R - (v % 40 === 0 ? 12 : 7);
    ctx.strokeStyle = v >= 180 ? "#ff7a5a" : "rgba(255,255,255,0.8)"; ctx.lineWidth = v % 40 === 0 ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1);
    ctx.lineTo(sx + Math.cos(a) * (R - 3), sy + Math.sin(a) * (R - 3));
    ctx.stroke();
  }
  const na = Math.PI * 0.75 + clamp(kmh / maxKmh, 0, 1.02) * Math.PI * 1.5;
  ctx.strokeStyle = "#ff4646"; ctx.lineWidth = 4; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(sx - Math.cos(na) * 8, sy - Math.sin(na) * 8);
  ctx.lineTo(sx + Math.cos(na) * (R - 16), sy + Math.sin(na) * (R - 16)); ctx.stroke();
  ctx.fillStyle = "#ffd23d"; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "bold 24px 'Consolas', monospace"; ctx.textAlign = "center";
  ctx.fillText(String(Math.round(kmh)), sx, sy + 34);
  ctx.font = "11px sans-serif"; ctx.fillStyle = "#9fc0e8"; ctx.fillText("km/h", sx, sy + 48);
  ctx.restore();
  // 逆行警告
  if (G.wrongWayT > 0.7 && Math.sin(G.time * 10) > 0){
    ctx.fillStyle = "#ff4646"; ctx.font = "bold 40px sans-serif"; ctx.textAlign = "center";
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 6;
    ctx.strokeText("⚠ 逆行！", W / 2, 180); ctx.fillText("⚠ 逆行！", W / 2, 180);
  }
  // 漂移提示字
  if (P.drifting && Math.abs(P.visSlip) > 0.2){
    ctx.save();
    ctx.translate(W / 2 + Math.sin(G.time * 30) * 2, H * 0.62);
    ctx.rotate(-0.06);
    ctx.font = "italic bold 26px sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = P.gauge > 72 ? "#ff7a30" : "#ffd23d"; ctx.strokeStyle = "#20242c"; ctx.lineWidth = 5;
    ctx.strokeText("DRIFT!", 0, 0); ctx.fillText("DRIFT!", 0, 0);
    ctx.restore();
  }
  // 横幅
  for (let i = G.banners.length - 1; i >= 0; i--){
    const b = G.banners[i];
    b.t += 1 / 60;
    const a = b.t < 0.15 ? b.t / 0.15 : b.t > b.dur - 0.3 ? (b.dur - b.t) / 0.3 : 1;
    if (a <= 0){ G.banners.splice(i, 1); continue; }
    ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = "bold 46px sans-serif"; ctx.textAlign = "center";
    ctx.strokeStyle = "#20242c"; ctx.lineWidth = 8;
    ctx.strokeText(b.text, W / 2, 150 - i * 50);
    ctx.fillStyle = b.color; ctx.fillText(b.text, W / 2, 150 - i * 50);
    ctx.restore();
  }
}
function drawCountdown(){
  const t = G.countT;
  const lx = W / 2, ly = 100;
  ctx.save();
  ctx.fillStyle = "rgba(20,26,40,0.9)";
  drawRounded(ctx, lx - 92, ly - 34, 184, 68, 16); ctx.fill();
  ctx.strokeStyle = "#465068"; ctx.lineWidth = 3;
  drawRounded(ctx, lx - 92, ly - 34, 184, 68, 16); ctx.stroke();
  const n = Math.ceil(t - 0.6);
  for (let i = 0; i < 3; i++){
    const on = G.state === "COUNTDOWN" ? (3 - n >= i + 1 && t > 0.6) : true;
    const green = G.state !== "COUNTDOWN";
    ctx.fillStyle = green ? "#48e858" : on ? "#ff4040" : "#4a2a2a";
    ctx.beginPath(); ctx.arc(lx - 52 + i * 52, ly, 20, 0, 7); ctx.fill();
    if ((on || green)){
      ctx.fillStyle = green ? "rgba(90,255,110,0.3)" : "rgba(255,70,70,0.3)";
      ctx.beginPath(); ctx.arc(lx - 52 + i * 52, ly, 28, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
  if (G.state === "COUNTDOWN" && t <= 3.1 && t > 0.6){
    const num = Math.ceil(t - 0.6);
    const ph = 1 - ((t - 0.6) % 1);
    ctx.save();
    ctx.translate(W / 2, H / 2 - 20);
    ctx.scale(1 + ph * 0.5, 1 + ph * 0.5); ctx.globalAlpha = 1 - ph * 0.6;
    ctx.font = "bold 120px sans-serif"; ctx.textAlign = "center";
    ctx.strokeStyle = "#20242c"; ctx.lineWidth = 12;
    ctx.strokeText(String(num), 0, 40);
    ctx.fillStyle = ["#ffd23d", "#ff9c20", "#ff4646"][num - 1] || "#fff";
    ctx.fillText(String(num), 0, 40);
    ctx.restore();
  }
  if (G.goFlash > 0){
    ctx.save();
    ctx.globalAlpha = clamp(G.goFlash / 0.9, 0, 1);
    ctx.font = "bold 130px sans-serif"; ctx.textAlign = "center";
    ctx.strokeStyle = "#20242c"; ctx.lineWidth = 14;
    ctx.strokeText("GO!", W / 2, H / 2 + 30);
    ctx.fillStyle = "#48e858"; ctx.fillText("GO!", W / 2, H / 2 + 30);
    ctx.restore();
  }
  if (G.startBoostMsg && G.raceTime < 2.2){
    ctx.font = "bold 34px sans-serif"; ctx.textAlign = "center";
    ctx.strokeStyle = "#20242c"; ctx.lineWidth = 6;
    ctx.strokeText(G.startBoostMsg, W / 2, H / 2 + 90);
    ctx.fillStyle = "#57c8ff"; ctx.fillText(G.startBoostMsg, W / 2, H / 2 + 90);
  }
}

// ---------- 结算 ----------
function showResult(){
  G.state = "RESULT";
  const tb = document.getElementById("resultTable");
  const arr = G.karts.slice().sort((a, b) => (a.finished ? a.finishTime : 1e9 + a.rank) - (b.finished ? b.finishTime : 1e9 + b.rank));
  let html = "<tr style='color:#4a6a9a;font-size:13px'><th>名次</th><th>车手</th><th>总时间</th><th>最快圈</th></tr>";
  arr.forEach((k, i) => {
    const best = k.lapTimes.length ? Math.min(...k.lapTimes) : 0;
    const medal = i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
    html += `<tr class="${k.isPlayer ? "me" : ""}"><td>${medal}</td><td>${k.name}</td>` +
      `<td>${k.finished ? fmtTime(k.finishTime) : "—"}</td><td>${best ? fmtTime(best) : "—"}</td></tr>`;
  });
  tb.innerHTML = html;
  document.getElementById("resultTitle").textContent = G.player.rank === 1 ? "🎉 冠军！" : `第 ${G.player.rank} 名`;
  document.getElementById("result").style.display = "flex";
}

// ---------- 暂停 ----------
function togglePause(){
  if (G.state === "RACING" || G.state === "FINISH"){
    G.prevState = G.state; G.state = "PAUSE";
    document.getElementById("pause").style.display = "flex";
  } else if (G.state === "PAUSE"){
    G.state = G.prevState || "RACING";
    document.getElementById("pause").style.display = "none";
  }
}

// ---------- 主循环 ----------
let lastT = performance.now();
function frame(now){
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000; lastT = now;
  if (dt > 0.1) dt = 0.1;
  G.fpsAcc += dt; G.fpsN++;
  if (G.fpsAcc > 0.5){ G.fps = G.fpsN / G.fpsAcc; G.fpsAcc = 0; G.fpsN = 0; }
  if (G.state === "MENU" || G.state === "PAUSE" || G.state === "RESULT"){ return; }
  G.time += dt;
  tickBGM(dt);

  if (G.state === "COUNTDOWN"){
    G.countT -= dt;
    if (G.countT <= 0.6){
      G.state = "RACING"; G.goFlash = 0.9; G.raceTime = 0;
      for (const k of G.karts) k.lapStart = 0;
      blip(880, 0.4, "square", 0.35);
      const dp = G.startPressT;
      if (dp > 0.6 && dp < 1.05){
        G.player.boostT = 3.0; G.player.boostKind = "start";
        G.startBoostMsg = "完美起步！"; whoosh();
      } else if (dp >= 1.05 && dp < 1.7){
        G.player.boostT = 1.2; G.startBoostMsg = "起步加速！";
      } else if (dp >= 1.7 && dp > 0){ G.startBoostMsg = ""; }
      for (const k of G.karts) if (!k.isPlayer && Math.random() < 0.5){ k.boostT = 0.8 + Math.random() * 1.6; }
    } else if (G.countT <= 3.1){
      const num = Math.ceil(G.countT - 0.6);
      if (G.lastCount !== num){ G.lastCount = num; blip(440, 0.18, "square", 0.3); }
    }
  } else {
    G.raceTime += dt;
    if (G.goFlash > 0) G.goFlash -= dt;
  }

  for (const k of G.karts) updateKart(k, dt);
  kartCollisions();
  updateRanks();
  spawnParticles(dt);

  if (G.state === "FINISH"){
    G.finishCoolT -= dt;
    const allDone = G.karts.every(k => k.finished);
    if (allDone || G.finishCoolT <= 0){
      for (const k of G.karts) if (!k.finished){ k.finished = true; k.finishTime = G.raceTime + (G.karts.length - k.rank) * 0.8; }
      showResult();
    }
  }

  // 引擎音
  const P = G.player;
  if (SFX.engine){
    const sp = Math.abs(P.speed);
    SFX.engine.frequency.value = 58 + sp * 0.62 + (P.boostT > 0 ? 40 : 0);
    SFX.engine2.frequency.value = (58 + sp * 0.62) * 1.007 + 2;
    SFX.engGain.gain.value = 0.10 + clamp(sp / PH.maxSpd, 0, 1) * 0.08;
    SFX.driftGain.gain.value = (P.drifting && Math.abs(P.visSlip) > 0.1) ? 0.22 : 0;
  }

  // 3D 渲染 + HUD
  syncScene(dt);
  renderer.render(scene, camera);
  ctx.clearRect(0, 0, W, H);
  drawNameTags();
  drawSpeedFX();
  drawHUD();
  if (G.state === "COUNTDOWN" || G.goFlash > 0 || (G.startBoostMsg && G.raceTime < 2.2)) drawCountdown();
}
requestAnimationFrame(frame);

// ---------- 菜单交互 ----------
{
  const sw = document.getElementById("swatches");
  KART_COLORS.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "swatch" + (i === 0 ? " sel" : ""); d.style.background = c;
    d.onclick = () => { G.colorIdx = i;
      sw.querySelectorAll(".swatch").forEach(e => e.classList.remove("sel")); d.classList.add("sel"); };
    sw.appendChild(d);
  });
  document.querySelectorAll(".trackBtn").forEach(b => {
    b.onclick = () => { G.trackIdx = +b.dataset.t;
      document.querySelectorAll(".trackBtn").forEach(e => e.classList.remove("sel")); b.classList.add("sel"); };
  });
  document.getElementById("startBtn").onclick = () => startRace(G.trackIdx, G.colorIdx);
  document.getElementById("againBtn").onclick = () => startRace(G.trackIdx, G.colorIdx);
  document.getElementById("menuBtn2").onclick = () => { document.getElementById("result").style.display = "none";
    document.getElementById("menu").style.display = "flex"; G.state = "MENU"; };
  document.getElementById("resumeBtn").onclick = togglePause;
  document.getElementById("restartBtn").onclick = () => startRace(G.trackIdx, G.colorIdx);
  document.getElementById("menuBtn").onclick = () => { document.getElementById("pause").style.display = "none";
    document.getElementById("menu").style.display = "flex"; G.state = "MENU"; };
}
if (AUTO){ startRace(0, 0); }

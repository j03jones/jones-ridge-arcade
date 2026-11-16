/* =====================================================================
   FLIPSIDE DINER — an original 3D pinball table for the Jones Ridge Arcade.
   Table design, toys, art and sounds are all original. 3D rendering uses
   three.js (MIT license, bundled in ./lib). Physics are home-made 2D table physics.
   ===================================================================== */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const GAME_ID = 'pin';
const UW = 480;                         // logical width of the 2D interface layer
const HUD = 44, DMD = 66;
const TW = 480, TH = 960;               // table size in table units
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const BALLS_PER_GAME = 3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;

const stage = document.getElementById('stage');
const glCanvas = document.getElementById('gl');
const ui = document.getElementById('ui');
const loadingEl = document.getElementById('loading');
let ctx = ui.getContext('2d');
let UH = 900, stageW = 480, stageH = 900, uiScale = 1;

/* ====================== storage + leaderboards ====================== */
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
let BOARD = [], WEEK = null, BOARD_SHARED = false, MINE = null;
function loadLocal() { try { const l = JSON.parse(lsGet(GAME_ID + '.top10', '[]')); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
function insertLocal(entry) {
  const l = loadLocal(); l.push(entry); l.sort((a, b) => b.score - a.score);
  const top = l.slice(0, 10); lsSet(GAME_ID + '.top10', JSON.stringify(top)); return { top, rank: top.indexOf(entry) + 1 };
}
async function getJSON(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(String(r.status)); const d = await r.json(); if (!Array.isArray(d)) throw new Error('bad'); return d; }
async function refreshBoard() {
  try {
    const [all, week] = await Promise.all([getJSON('/api/scores/' + GAME_ID), getJSON('/api/scores/' + GAME_ID + '?board=week').catch(() => null)]);
    BOARD = all; WEEK = week; BOARD_SHARED = true;
  } catch (e) { if (!BOARD_SHARED) { BOARD = loadLocal(); WEEK = null; } }
}
const beats = (list, score) => list.length < 10 || score > list[list.length - 1].score;
function qualifies(score) { return score > 0 && (beats(BOARD, score) || (WEEK !== null && beats(WEEK, score))); }
async function submitScore(name, score, level) {
  const local = insertLocal({ name, score, level, date: new Date().toISOString().slice(0, 10) });
  if (!BOARD_SHARED) { BOARD = local.top; MINE = { name, score, rank: { all: local.rank, week: 0 } }; return true; }
  try {
    const r = await fetch('/api/scores/' + GAME_ID + '?v=2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, score, level }) });
    if (r.ok) {
      const d = await r.json();
      if (d && Array.isArray(d.all)) { BOARD = d.all; WEEK = Array.isArray(d.week) ? d.week : WEEK; MINE = { name, score, rank: d.rank || { all: 0, week: 0 } }; }
      else if (Array.isArray(d)) { BOARD = d; MINE = { name, score, rank: { all: d.findIndex(e => e.name === name && e.score === score) + 1, week: 0 } }; }
      return true;
    }
    return r.status === 429 ? 'Too many scores from this connection. Try again in a few minutes.' : 'Could not save to the scoreboard (error ' + r.status + ').';
  } catch (e) { return 'Could not reach the scoreboard. Check your connection.'; }
}
function rankLine() {
  if (!MINE || !MINE.rank) return '';
  const { all, week } = MINE.rank;
  if (all) return 'YOU’RE #' + all + (BOARD_SHARED ? ' ALL-TIME!' : ' ON THIS DEVICE!') + (week === 1 && all !== 1 ? '  ·  #1 THIS WEEK' : '');
  if (week) return 'YOU’RE #' + week + ' THIS WEEK!';
  return '';
}
refreshBoard();
function buzz(pattern) { try { if (IS_TOUCH && navigator.vibrate) navigator.vibrate(pattern); } catch (e) {} }

/* ====================== audio (synthesized) ====================== */
let ac = null, muted = lsGet(GAME_ID + '.muted', '0') === '1', noiseBuf = null;
function audio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
  if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
function tone(f, dur, type = 'square', vol = 0.1, f2 = null, delay = 0) {
  if (muted || !ac) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.2, lp = 1200, delay = 0) {
  if (muted || !ac) return;
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = lp;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(ac.destination); s.start(t); s.stop(t + dur + 0.02);
}
const sfxT = {};
function limited(name, ms) { const n = performance.now(); if (n - (sfxT[name] || 0) < ms) return false; sfxT[name] = n; return true; }
const sfx = {
  flip() { if (limited('flip', 40)) { noise(0.05, 0.13, 3200); tone(150, 0.05, 'square', 0.05, 90); } },
  bumper() { if (limited('bump', 45)) { tone(330 + Math.random() * 80, 0.12, 'square', 0.07, 700); noise(0.08, 0.12, 2600); } },
  sling() { if (limited('sling', 50)) { tone(520, 0.08, 'square', 0.06, 260); noise(0.06, 0.12, 3200); } },
  wall(v) { if (limited('wall', 70)) noise(0.04, Math.min(0.12, v / 9000), 1700); },
  target() { tone(880, 0.1, 'triangle', 0.08, 1320); noise(0.05, 0.08, 4000); },
  lane() { tone(1046, 0.08, 'triangle', 0.07); tone(1568, 0.1, 'triangle', 0.05, null, 0.06); },
  spin() { if (limited('spin', 40)) tone(1700 + Math.random() * 300, 0.03, 'square', 0.03); },
  ramp() { [392, 494, 587, 784, 988].forEach((f, i) => tone(f, 0.09, 'square', 0.05, null, i * 0.05)); },
  wire() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.08, 'triangle', 0.06, null, i * 0.05)); noise(0.6, 0.05, 5000); },
  orbit() { tone(600, 0.35, 'sawtooth', 0.04, 1500); },
  grill() { noise(0.45, 0.16, 5000); tone(220, 0.1, 'square', 0.06, 440); },
  scoop() { tone(200, 0.2, 'sine', 0.12, 80); noise(0.1, 0.15, 900); },
  kick() { noise(0.12, 0.25, 1400); tone(160, 0.12, 'square', 0.08, 500); },
  plunge(c) { noise(0.12, 0.2, 800 + 1200 * c); tone(120, 0.1, 'sine', 0.12, 60); },
  drain() { tone(392, 0.25, 'triangle', 0.08, 196); tone(262, 0.4, 'triangle', 0.08, 98, 0.22); },
  save() { [784, 1047, 1319].forEach((f, i) => tone(f, 0.12, 'triangle', 0.08, null, i * 0.08)); },
  lock() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.06, null, i * 0.09)); },
  fridge() { tone(90, 0.3, 'sine', 0.12, 60); noise(0.2, 0.08, 600); },
  intro() { [262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, 0.16, i % 2 ? 'square' : 'triangle', 0.06, null, i * 0.09)); },
  multi() { [262, 330, 392, 523, 392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, i % 2 ? 'square' : 'sawtooth', 0.06, null, i * 0.08)); noise(0.6, 0.15, 900, 0.7); },
  jackpot() { [523, 784, 1047, 1568, 2093].forEach((f, i) => tone(f, 0.2, 'square', 0.07, null, i * 0.07)); noise(0.5, 0.2, 1500); },
  award() { [659, 880, 1175].forEach((f, i) => tone(f, 0.12, 'triangle', 0.08, null, i * 0.07)); },
  fail() { [440, 349, 294].forEach((f, i) => tone(f, 0.18, 'triangle', 0.07, null, i * 0.14)); },
  bonusTick() { tone(1500, 0.03, 'square', 0.03); },
  over() { [440, 370, 294, 220].forEach((f, i) => tone(f, 0.3, 'triangle', 0.09, null, i * 0.22)); },
};

/* ====================== table layout (table units, y grows toward the player) ====================== */
const SEGS = [], CIRCS = [];
function addSeg(ax, ay, bx, by, o = {}) { const s = Object.assign({ ax, ay, bx, by, e: 0.4, kind: 'wall', rad: 0, look: 'rail', h: 2 }, o); SEGS.push(s); return s; }
function addPoly(pts, o) { for (let i = 0; i < pts.length - 1; i++) addSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], o); }
function oneWay(ax, ay, bx, by, o = {}) {   // solid only for a ball arriving from the "up" side of the line
  const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy);
  let nx = dy / l, ny = -dx / l; if (ny > 0) { nx = -nx; ny = -ny; }
  return addSeg(ax, ay, bx, by, Object.assign({ side: [nx, ny] }, o));
}
const ARC = [];
for (let k = 0; k <= 40; k++) { const a = Math.PI + k * Math.PI / 40; ARC.push([245 + 225 * Math.cos(a), 245 + 225 * Math.sin(a)]); }
addSeg(20, 990, 20, 245, { look: 'outer', h: 4 });
addPoly(ARC, { look: 'outer', h: 4 });
addSeg(470, 245, 470, 990, { look: 'outer', h: 4 });
addSeg(436, 960, 436, 272, { look: 'rail', h: 2.2, rad: 1 });
addSeg(436, 952, 470, 952, { look: 'none' });
oneWay(436, 272, 470, 244, { kind: 'gate', look: 'gate', h: 1.6 });
for (const x of [168, 208, 248, 288]) addSeg(x, 56, x, 100, { rad: 3, look: 'rail', h: 1.4 });
addSeg(60, 300, 60, 556, { rad: 3, look: 'plastic', h: 2.4 });             // left orbit wall
addSeg(396, 300, 396, 556, { rad: 3, look: 'plastic', h: 2.4 });           // right orbit wall
oneWay(20, 580, 56, 606, { look: 'rail', h: 1.6, rad: 2 });                // orbit return deflectors
oneWay(436, 580, 400, 606, { look: 'rail', h: 1.6, rad: 2 });
// wall behind the upper flipper's hinge: closes the gap where a ball rolling back off the raised flipper used to slip into the right outlane
addSeg(400, 606, 391, 633, { look: 'rail', h: 1.8, rad: 2 });
addPoly([[74, 428], [74, 384], [122, 384], [122, 396]], { rad: 3, look: 'plastic', h: 2 });   // Order Window scoop pocket
// ramp mouths
addSeg(146, 656, 146, 632, { rad: 3, look: 'plastic', h: 1.8 }); addSeg(146, 632, 190, 616, { rad: 2, look: 'none' }); addSeg(190, 616, 190, 656, { rad: 3, look: 'plastic', h: 1.8 });
addSeg(262, 656, 262, 618, { rad: 3, look: 'plastic', h: 1.8 }); addSeg(262, 618, 306, 634, { rad: 2, look: 'none' }); addSeg(306, 634, 306, 656, { rad: 3, look: 'plastic', h: 1.8 });
// inlane guides end on top of each flipper's pivot so the ball rolls onto the flipper
function pivotTop(side, px, py) { const a = side ? Math.PI - 0.5 : 0.5, dx = Math.cos(a), dy = Math.sin(a), ux = side ? -dy : dy, uy = side ? dx : -dx; return [px - 10 * dx + 9 * ux, py - 10 * dy + 9 * uy]; }
addPoly([[58, 723], [58, 803], pivotTop(0, 148, 872)], { look: 'rail', h: 1.8, rad: 1 });
addPoly([[398, 723], [398, 803], pivotTop(1, 308, 872)], { look: 'rail', h: 1.8, rad: 1 });
// slingshots (the long inner face kicks)
const SLINGS = [[[96, 740], [96, 788], [134, 812]], [[360, 740], [360, 788], [322, 812]]];
SLINGS.forEach((p, i) => { addSeg(p[0][0], p[0][1], p[1][0], p[1][1], { e: 0.55, look: 'none' }); addSeg(p[1][0], p[1][1], p[2][0], p[2][1], { e: 0.55, look: 'none' }); addSeg(p[2][0], p[2][1], p[0][0], p[0][1], { kind: 'sling', id: i, e: 0.6, rad: 2, look: 'none' }); });
// C-H-E-F drop targets
const TARGET_X = [[150, 176], [182, 208], [214, 240], [246, 272]];
TARGET_X.forEach(([a, b], i) => addSeg(a, 480, b, 480, { kind: 'target', id: i, rad: 4, e: 0.3, look: 'none' }));
// round things
[[178, 200], [278, 200], [228, 270]].forEach(([x, y], i) => CIRCS.push({ x, y, r: 21, kind: 'bumper', id: i }));
CIRCS.push({ x: 112, y: 322, r: 22, kind: 'grill' });
CIRCS.push({ x: 58, y: 723, r: 6, kind: 'post' }, { x: 398, y: 723, r: 6, kind: 'post' });
const SCOOP = { x: 98, y: 410 };
const LANES = [[168, 208], [208, 248], [248, 288]];

const FLIPPERS = [
  { x: 148, y: 872, len: 64, r0: 9, r1: 5, rest: 0.5, up: -0.42, ang: 0.5, omega: 0, pressed: false, side: 0 },
  { x: 308, y: 872, len: 64, r0: 9, r1: 5, rest: Math.PI - 0.5, up: Math.PI + 0.42, ang: Math.PI - 0.5, omega: 0, pressed: false, side: 1 },
  { x: 384, y: 640, len: 52, r0: 8, r1: 4.5, rest: Math.PI - 0.45, up: Math.PI + 0.35, ang: Math.PI - 0.45, omega: 0, pressed: false, side: 1, upper: true },
];
const GRAV = 1000, BALL_R = 9, MAXV = 1950, SUBSTEPS = 12;   // gentler table slope and top speed: a slower, more readable ball

/* ---- ramps: [x, y, height in world units] ---- */
function makePath(pts) {
  const P = [pts[0], ...pts, pts[pts.length - 1]], out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let k = 0; k < 10; k++) {
      const t = k / 10, t2 = t * t, t3 = t2 * t;
      const f = c => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
      out.push([f(0), f(1), f(2)]);
    }
  }
  out.push(pts[pts.length - 1]);
  const cum = [0];
  for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1], (out[i][2] - out[i - 1][2]) * 10));
  return { pts: out, cum, len: cum[cum.length - 1], raw: pts };
}
function pathAt(p, d) {
  let i = 0; while (i < p.pts.length - 2 && p.cum[i + 1] < d) i++;
  const a = p.pts[i], b = p.pts[i + 1] || a, seg = (p.cum[i + 1] - p.cum[i]) || 1, k = clamp((d - p.cum[i]) / seg, 0, 1);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
const L_A = [[168, 646, 0], [162, 590, 1.1], [146, 510, 2.5], [124, 430, 3.6], [104, 340, 4.5], [98, 250, 5.1], [112, 172, 5.5]];
const L_B = [[164, 112, 5.7], [240, 92, 5.8], [318, 108, 5.6], [380, 168, 5.2], [414, 258, 4.7], [418, 360, 4.1], [408, 460, 3.4], [396, 560, 2.7], [386, 650, 1.8], [380, 700, 0.9], [379, 738, 0.15]];
const FRIDGE_PTS = [[84, 128, 5.6], [56, 84, 5.8], [42, 62, 5.9]];
const RAMP_L = makePath([...L_A, ...L_B]);
const RAMP_LF = makePath([...L_A, ...FRIDGE_PTS]);
const RAMP_FO = makePath([...FRIDGE_PTS.slice().reverse(), [112, 172, 5.5], ...L_B]);
const RAMP_R = makePath([[284, 646, 0], [292, 572, 1.2], [312, 490, 2.7], [332, 404, 4.0], [338, 326, 5.2], [318, 258, 6.4], [272, 214, 7.2], [210, 204, 7.4], [150, 228, 7.3], [108, 286, 6.8], [82, 370, 5.8], [74, 470, 4.5], [74, 570, 3.0], [76, 654, 1.7], [77, 702, 0.8], [77, 738, 0.15]]);

/* ====================== game state ====================== */
const MODES = [
  { key: 'burger', name: 'BURGER FLIP', goal: 4, what: 'HIT THE GRILL', each: 25000, done: 100000, color: '#ff8a3c' },
  { key: 'shake', name: 'SHAKE SHACK', goal: 3, what: 'SHOOT THE SHAKE RAMP', each: 40000, done: 150000, color: '#7dd8ff' },
  { key: 'sauce', name: 'SAUCE BOSS', goal: 3, what: 'SHOOT THE SAUCE RAMP', each: 40000, done: 150000, color: '#ff5a6a' },
  { key: 'pie', name: 'PIE IN THE SKY', goal: 4, what: 'SHOOT THE ORBITS', each: 30000, done: 120000, color: '#ffd84a' },
];
const G = {
  state: 'title', stateT: 0, titleT: 0, t: 0,
  score: 0, ball: 1, extraBalls: 0, balls: [],
  phase: 'play', phaseT: 0, saveT: 0, saveUsed: false,
  targets: [false, false, false, false], targetAnim: [0, 0, 0, 0], targetFlash: [0, 0, 0, 0], chefDone: 0,
  lanes: [false, false, false], laneFlash: [0, 0, 0], bonusX: 1,
  bumperHits: 0, bumperFlash: [0, 0, 0], slingFlash: [0, 0], sizzleT: 0,
  lockLit: false, locks: 0, multiball: false, jackpots: 0, superLit: false, extraLit: false, kickbackLit: true,
  scoopLit: false, mode: -1, modeT: 0, modeProg: 0, modesPlayed: [false, false, false, false], wizard: false, wizardT: 0,
  rampCount: 0, comboT: 0, combo: 0, lastShot: '',
  skillLane: -1, skillT: 0, skillLive: false,
  spinner: 0, spinnerV: 0, grillAngle: 0, grillV: 0, grillFlash: 0, scoopFlash: 0, kickFlash: 0, rampFlash: [0, 0],
  fridgeOpen: 0, fridgeTarget: 0,
  tally: { ramps: 0, orbits: 0, targets: 0, bumpers: 0, lanes: 0, spins: 0, grill: 0, modes: 0 },
  disp: null, dispQ: [], callouts: [], pops: [], flash: 0, shake: 0, intro: null,
  plunger: 0, charging: false, autoT: 0, queue: 0, pendingOut: [], entryHandled: false,
  chef: { mood: 'idle', t: 0, dur: 0 },
};
function newBall(x, y, vx = 0, vy = 0, state = 'play') { const b = { x, y, vx, vy, r: BALL_R, state, h: 0, trail: [], still: 0, rampD: 0, path: null, hold: 0 }; G.balls.push(b); return b; }
function serveToLane(auto) {
  if (G.balls.some(b => b.state === 'lane')) { G.queue++; return null; }
  const b = newBall(453, 943, 0, 0, 'lane'); b.auto = !!auto; G.autoT = auto ? 0.8 : 0; return b;
}
const activeBalls = () => G.balls.filter(b => b.state === 'play' || b.state === 'lane' || b.state === 'ramp' || b.state === 'scoop');

function addScore(n) { G.score += Math.round(n); }
function best() { return Math.max(+lsGet(GAME_ID + '.best', '0') || 0, BOARD[0] ? BOARD[0].score : 0, G.score); }
function show(big, small = '', dur = 1.8, color = '#ffb347', prio = 1) {
  const m = { big, small, dur, t: 0, color, prio };
  if (!G.disp || prio >= G.disp.prio) G.disp = m; else G.dispQ.push(m);
}
function callout(txt, color = '#ffd84a', sub = '') { G.callouts.push({ txt, sub, color, t: 0 }); fireFlashers(); }
function chef(mood, dur = 1.6) { G.chef = { mood, t: 0, dur }; }
function pop(x, y, txt, color = '#ffffff') { G.pops.push({ x, y, txt, color, t: 1 }); }

function resetBallState() {
  G.targets = [false, false, false, false]; G.lanes = [false, false, false]; G.bonusX = 1;
  G.tally = { ramps: 0, orbits: 0, targets: 0, bumpers: 0, lanes: 0, spins: 0, grill: 0, modes: 0 };
  G.saveT = 0; G.saveUsed = false; G.sizzleT = 0; G.combo = 0; G.comboT = 0;
}
function startGame() {
  audio();
  Object.assign(G, { score: 0, ball: 1, extraBalls: 0, balls: [], chefDone: 0, bumperHits: 0, lockLit: false, locks: 0, multiball: false, jackpots: 0, superLit: false, extraLit: false,
    kickbackLit: true, scoopLit: false, mode: -1, modesPlayed: [false, false, false, false], wizard: false, rampCount: 0,
    callouts: [], pops: [], dispQ: [], disp: null, phase: 'play', queue: 0, pendingOut: [], intro: null, fridgeTarget: 0 });
  MINE = null;
  resetBallState(); serveBall();
  G.state = lsGet(GAME_ID + '.tipsSeen', '0') === '1' ? 'play' : 'tips'; G.stateT = 0;
  if (IS_TOUCH) goFull();
}
function serveBall() {
  G.phase = 'play'; G.phaseT = 0;
  serveToLane(false);
  G.skillLane = (Math.random() * 3) | 0; G.skillLive = true; G.skillT = 0;
  show('BALL ' + G.ball, IS_TOUCH ? 'HOLD, THEN LET GO TO LAUNCH' : 'HOLD SPACE, THEN LET GO', 2.6, '#ffb347', 2);
}
function toTitle() {
  G.state = 'title'; G.stateT = 0;
  G.titleT = MINE && MINE.rank && !MINE.rank.all && MINE.rank.week ? 7 : 0;
  G.balls = []; G.intro = null; refreshBoard();
}
function startIntro(kind, title, sub, color, after) { G.intro = { kind, title, sub, color, t: 0, dur: 2.6, after }; G.disp = null; G.dispQ = []; sfx.intro(); }

/* ====================== scoring events ====================== */
function comboHit(name) {
  if (G.comboT > 0 && G.lastShot !== name) G.combo++; else G.combo = 1;
  G.comboT = 3.2; G.lastShot = name;
  if (G.combo >= 2) { const c = 20000 * (G.combo - 1); addScore(c); show(G.combo + 'X COMBO', '+' + c.toLocaleString(), 1.6, '#7dffd2', 2); }
}
function modeShot(key) {
  if (G.wizard) { addScore(100000); pop(228, 560, '100,000', '#ffd84a'); G.flash = 0.4; return true; }
  if (G.mode < 0 || MODES[G.mode].key !== key) return false;
  const m = MODES[G.mode];
  G.modeProg++; addScore(m.each);
  show(m.name, (m.goal - G.modeProg) > 0 ? (m.goal - G.modeProg) + ' MORE!' : 'COMPLETE!', 1.4, m.color, 3);
  if (G.modeProg >= m.goal) {
    addScore(m.done); G.tally.modes++; G.modesPlayed[G.mode] = true;
    callout(m.name + ' DONE!', m.color, '+' + m.done.toLocaleString()); sfx.jackpot(); chef('cheer', 2); buzz([50, 40, 90]); G.flash = 0.7;
    G.mode = -1; checkWizardReady();
  } else { sfx.award(); chef('flip', 1); }
  return true;
}
function checkWizardReady() { if (G.modesPlayed.every(Boolean) && !G.wizard) { G.scoopLit = true; show('GRAND OPENING', 'IS LIT AT THE ORDER WINDOW!', 3, '#ff6fb5', 3); } }
function hitBumper(c, b) {
  const val = G.wizard ? 20000 : G.sizzleT > 0 ? 5000 : 1000;
  addScore(val); G.bumperFlash[c.id] = 1; G.tally.bumpers++; G.bumperHits++;
  sfx.bumper();
  if (G.sizzleT > 0) pop(c.x, c.y - 28, val.toLocaleString(), '#ff9a3c');
  if (G.sizzleT <= 0 && G.bumperHits >= 30) {
    G.bumperHits = 0; G.sizzleT = 20; callout('SIZZLE MANIA!', '#ff8a3c', 'POTS SCORE 5,000'); sfx.award(); buzz(60); G.flash = 0.5; chef('cheer', 1.5);
  }
  G.skillLive = false;
}
function hitSling(id) { addScore(110); G.slingFlash[id] = 1; sfx.sling(); G.skillLive = false; }
function hitGrill(b, imp) {
  G.grillV = Math.min(30, G.grillV + imp / 60); G.grillFlash = 1; G.tally.grill++; sfx.grill(); G.skillLive = false;
  if (!modeShot('burger')) { addScore(3000); pop(112, 290, '3,000', '#ff8a3c'); }
}
function hitTarget(i) {
  if (G.targets[i]) return;
  G.targets[i] = true; G.targetFlash[i] = 1; addScore(2500); G.tally.targets++; sfx.target();
  pop((TARGET_X[i][0] + TARGET_X[i][1]) / 2, 462, 'CHEF'[i], '#ff6fb5');
  G.skillLive = false;
  if (G.targets.every(Boolean)) {
    G.chefDone++; addScore(25000); sfx.award(); buzz(50); chef('point', 1.6);
    let sub = '+25,000';
    if (!G.multiball && !G.wizard) { G.lockLit = true; sub = 'LOCK IS LIT ON THE SAUCE RAMP'; }
    if (G.chefDone % 2 === 0 && !G.extraLit) { G.extraLit = true; sub = 'EXTRA BALL LIT — LEFT ORBIT'; }
    callout('C·H·E·F!', '#ff6fb5', sub);
    G.resetTargetsT = 1.0;
  }
}
function rolloverLane(i) {
  G.laneFlash[i] = 1; G.tally.lanes++; addScore(2000); sfx.lane();
  if (G.skillLive && i === G.skillLane) { addScore(25000); callout('SKILL SHOT!', '#7dffd2', '+25,000'); sfx.award(); buzz(50); chef('cheer', 1.4); }
  G.skillLive = false;
  if (!G.lanes[i]) {
    G.lanes[i] = true;
    if (G.lanes.every(Boolean)) {
      G.lanes = [false, false, false];
      if (G.bonusX < 6) G.bonusX++;
      addScore(10000); G.laneFlash = [1.5, 1.5, 1.5]; sfx.award();
      if (G.mode < 0 && !G.wizard && !G.scoopLit) { G.scoopLit = true; show('H·O·T!', 'BONUS ' + G.bonusX + 'X — ORDER WINDOW LIT', 2.2, '#ff8a3c', 2); }
      else show('H·O·T!', 'BONUS ' + G.bonusX + 'X', 1.8, '#ff8a3c', 2);
    }
  }
}
function rotateLanes(dir) { if (G.phase !== 'play') return; const l = G.lanes; G.lanes = dir > 0 ? [l[2], l[0], l[1]] : [l[1], l[2], l[0]]; }
function orbitShot(side) {
  G.tally.orbits++; sfx.orbit(); G.skillLive = false;
  if (side === 0 && G.extraLit) { G.extraLit = false; G.extraBalls++; callout('EXTRA BALL!', '#7dff9a', 'SHOOT AGAIN'); sfx.award(); buzz([40, 40, 80]); G.flash = 0.6; chef('cheer', 2); return; }
  if (modeShot('pie')) { comboHit('orbit' + side); return; }
  const val = G.multiball ? 15000 : 5000;
  addScore(val); show(side ? 'RIGHT ORBIT' : 'LEFT ORBIT', '+' + val.toLocaleString(), 1.2, '#7dd8ff');
  comboHit('orbit' + side);
}
function spinnerPass(b) { G.spinnerV = Math.min(60, G.spinnerV + Math.min(40, Math.abs(b.vy) / 40)); }
function rampEntered(b, side) {
  b.state = 'ramp'; b.rampD = 0; b.vx = b.vy = 0; G.rampFlash[side] = 1; G.skillLive = false;
  if (side === 0 && G.lockLit && !G.multiball && !G.wizard && (G.mode < 0 || MODES[G.mode].key !== 'sauce')) { b.path = RAMP_LF; b.toFridge = true; G.fridgeTarget = 1; }
  else { b.path = side === 0 ? RAMP_L : RAMP_R; b.toFridge = false; }
  b.rampSide = side;
  if (side === 0) { sfx.ramp(); fireFlashers(['red'], 0.8); } else { sfx.wire(); fireFlashers(['blue'], 0.8); }
}
function rampFinished(b) {
  const side = b.rampSide;
  if (b.toFridge) {
    G.lockLit = false; G.locks++; b.state = 'locked'; b.lockSlot = G.locks - 1; G.fridgeTarget = 0; sfx.fridge();
    if (G.locks >= 2) {
      startIntro('rush', 'DINNER RUSH!', 'MULTIBALL — BOTH RAMPS ARE JACKPOTS', '#ff6fb5', startMultiball);
      chef('cheer', 3);
    } else { callout('BALL LOCKED', '#7dffd2', 'ORDER UP! 1 OF 2 IN THE FRIDGE'); sfx.lock(); buzz(60); chef('point', 1.4); serveToLane(true); }
    return;
  }
  G.tally.ramps++; G.rampCount++;
  exitRamp(b);
  if (b.fromFridge) { b.fromFridge = false; return; }
  if (G.multiball) {
    G.jackpots++;
    const val = 50000 * Math.min(5, G.jackpots);
    addScore(val); callout('JACKPOT!', '#ffd84a', '+' + val.toLocaleString()); sfx.jackpot(); buzz([60, 40, 120]); G.shake = 0.5; G.flash = 0.8; chef('cheer', 1.5);
    if (G.jackpots === 3) { G.superLit = true; show('SUPER JACKPOT', 'IS LIT AT THE ORDER WINDOW', 2.4, '#ffd84a', 3); }
    return;
  }
  if (modeShot(side === 0 ? 'sauce' : 'shake')) { comboHit('ramp' + side); return; }
  const val = 10000 + 2500 * Math.min(10, G.rampCount);
  addScore(val);
  show(side === 0 ? 'SAUCE RAMP' : 'SHAKE RAMP', '+' + val.toLocaleString(), 1.4, side === 0 ? '#ff5a6a' : '#7dd8ff');
  comboHit('ramp' + side);
}
function exitRamp(b) { const e = b.path.raw[b.path.raw.length - 1]; b.state = 'play'; b.x = e[0]; b.y = e[1]; b.h = 0; b.vx = 0; b.vy = 300; }
function startMultiball() {
  G.multiball = true; G.jackpots = 0; G.superLit = false; G.locks = 0; G.saveT = 14; G.saveUsed = false;
  callout('DINNER RUSH!', '#ff6fb5', 'MULTIBALL!'); sfx.multi(); buzz([80, 60, 80, 60, 160]); G.flash = 1; G.shake = 0.6;
  G.fridgeTarget = 1; G.fridgeHoldT = 2.2;
  G.balls.filter(b => b.state === 'locked').forEach((b, i) => { b.state = 'wait'; G.pendingOut.push({ b, t: 0.5 + i * 0.8 }); });
  serveToLane(true);
}
function startWizard() {
  G.wizard = true; G.wizardT = 45; G.scoopLit = false; G.multiball = true; G.saveT = 15; G.saveUsed = false;
  callout('GRAND OPENING!', '#ff6fb5', 'EVERY SHOT 100,000'); sfx.multi(); G.flash = 1; G.shake = 0.6; chef('cheer', 4);
  G.queue += 2; serveToLane(true);
}
function startMode() {
  let i = G.modesPlayed.findIndex(p => !p);
  if (i < 0) return;
  const m = MODES[i];
  G.scoopLit = false;
  startIntro(m.key, m.name, m.what + ' ' + m.goal + ' TIMES!', m.color, () => { G.mode = i; G.modeT = 30; G.modeProg = 0; G.saveT = Math.max(G.saveT, 6); });
  chef('point', 2.6);
}
function scoopCapture(b) {
  fireFlashers(['yellow']);
  b.state = 'scoop'; b.x = SCOOP.x; b.y = SCOOP.y; b.vx = b.vy = 0; b.hold = 1.2; G.scoopFlash = 1; sfx.scoop(); G.skillLive = false;
  if (G.superLit && G.multiball) {
    G.superLit = false; addScore(500000); callout('SUPER JACKPOT!', '#ffd84a', '+500,000'); sfx.jackpot(); buzz([80, 50, 150]); G.flash = 1; G.shake = 0.8; chef('cheer', 2.5); return;
  }
  if (G.wizard) { modeShot('x'); return; }
  if (G.scoopLit && !G.multiball && G.mode < 0) {
    if (G.modesPlayed.every(Boolean)) { b.hold = 0.4; startIntro('wizard', 'GRAND OPENING!', 'ALL SHOTS LIT — 4 BALL MULTIBALL', '#ff6fb5', startWizard); return; }
    b.hold = 0.4; startMode(); return;
  }
  // random award
  const awards = [['+25,000', () => addScore(25000)], ['KICKBACK LIT', () => { G.kickbackLit = true; }], ['BALL SAVE 10 SEC', () => { G.saveT = Math.max(G.saveT, 10); G.saveUsed = false; }], ['+50,000', () => addScore(50000)]];
  const [txt, fn] = awards[(Math.random() * awards.length) | 0]; fn();
  addScore(5000); show('ORDER WINDOW', txt, 1.6, '#ffd84a', 2); sfx.award();
}
function ballDrained(b) {
  b.state = 'gone';
  const left = activeBalls().length + G.pendingOut.length + G.queue;
  if (G.saveT > 0 && !G.saveUsed && left === 0) { G.saveUsed = !G.multiball; callout('BALL SAVED', '#7dffd2'); sfx.save(); serveToLane(true); chef('point', 1.2); return; }
  if (G.saveT > 0 && G.multiball) { serveToLane(true); show('BALL SAVED', '', 1.2, '#7dffd2', 2); sfx.save(); return; }
  if (G.multiball && left <= 1) {
    if (G.wizard) { G.wizard = false; G.modesPlayed = [false, false, false, false]; show('GRAND OPENING OVER', 'MODES RESET', 2.2, '#ff6fb5', 3); }
    else show('RUSH IS OVER', G.jackpots + ' JACKPOT' + (G.jackpots === 1 ? '' : 'S'), 2, '#ff6fb5', 3);
    G.multiball = false; G.superLit = false;
  }
  if (left === 0) endOfBall();
}
function endOfBall() {
  sfx.drain(); buzz(120); chef('sad', 2.5);
  G.phase = 'bonus'; G.phaseT = 0; G.multiball = false; G.sizzleT = 0; G.wizard = false;
  if (G.mode >= 0) { G.modesPlayed[G.mode] = true; G.mode = -1; checkWizardReady(); }
  const t = G.tally;
  G.bonusLines = [['RAMPS', t.ramps * 4000], ['ORBITS', t.orbits * 2500], ['C-H-E-F TARGETS', t.targets * 750], ['POT BUMPERS', t.bumpers * 150],
    ['GRILL HITS', t.grill * 1000], ['LANES', t.lanes * 600], ['SPINS', t.spins * 80], ['MODES COMPLETED', t.modes * 50000]];
  G.bonusBase = G.bonusLines.reduce((s, l) => s + l[1], 0);
  G.bonusTotal = G.bonusBase * G.bonusX; G.bonusAdded = false;
}
function afterBonus() {
  if (G.extraBalls > 0) { G.extraBalls--; resetBallState(); serveBall(); callout('SHOOT AGAIN', '#7dff9a'); return; }
  if (G.ball >= BALLS_PER_GAME) {
    G.state = 'over'; G.stateT = 0; G.entryHandled = false; G.balls = [];
    if (G.score > (+lsGet(GAME_ID + '.best', '0') || 0)) lsSet(GAME_ID + '.best', String(G.score));
    sfx.over(); return;
  }
  G.ball++; resetBallState(); serveBall();
}

/* ====================== physics ====================== */
function collideSeg(b, s) {
  const abx = s.bx - s.ax, aby = s.by - s.ay, len2 = abx * abx + aby * aby;
  const t = clamp(((b.x - s.ax) * abx + (b.y - s.ay) * aby) / len2, 0, 1);
  const cx = s.ax + abx * t, cy = s.ay + aby * t;
  const dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy, R = b.r + s.rad;
  if (d2 >= R * R) return -1;
  if (s.side && ((b.x - s.ax) * s.side[0] + (b.y - s.ay) * s.side[1]) < 0) return -1;
  const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d;
  b.x = cx + nx * R; b.y = cy + ny * R;
  const vn = b.vx * nx + b.vy * ny;
  b.nx = nx; b.ny = ny;
  if (vn < 0) {
    b.vx -= (1 + s.e) * vn * nx; b.vy -= (1 + s.e) * vn * ny;
    // a hard hit also scrubs off some sideways speed, like a real ball skidding against a rail
    const loss = Math.min(0.06, -vn / 9000), vn2 = b.vx * nx + b.vy * ny, tx = b.vx - vn2 * nx, ty = b.vy - vn2 * ny; b.vx -= tx * loss; b.vy -= ty * loss;
    return -vn;
  }
  return 0;
}
function collideCircle(b, c) {
  const dx = b.x - c.x, dy = b.y - c.y, R = b.r + c.r, d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return -1;
  const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d;
  b.x = c.x + nx * R; b.y = c.y + ny * R;
  const vn = b.vx * nx + b.vy * ny;
  const e = c.kind === 'bumper' ? 0.6 : c.kind === 'post' ? 0.5 : 0.4;
  if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
  if (c.kind === 'bumper') { b.vx += nx * 330; b.vy += ny * 330; return 1000; }
  return vn < 0 ? -vn : 0;
}
function collideFlipper(b, f) {
  const tx = f.x + Math.cos(f.ang) * f.len, ty = f.y + Math.sin(f.ang) * f.len;
  const abx = tx - f.x, aby = ty - f.y, len2 = abx * abx + aby * aby;
  const t = clamp(((b.x - f.x) * abx + (b.y - f.y) * aby) / len2, 0, 1);
  const cx = f.x + abx * t, cy = f.y + aby * t, fr = f.r0 + (f.r1 - f.r0) * t;
  const dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy, R = b.r + fr;
  if (d2 >= R * R) return;
  const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d;
  b.x = cx + nx * R; b.y = cy + ny * R;
  const vsx = -f.omega * (cy - f.y), vsy = f.omega * (cx - f.x);
  const rvx = b.vx - vsx, rvy = b.vy - vsy, vn = rvx * nx + rvy * ny;
  if (vn < 0) { const e = Math.abs(f.omega) > 1 ? 0.32 : 0.12; b.vx = vsx + rvx - (1 + e) * vn * nx; b.vy = vsy + rvy - (1 + e) * vn * ny; }   // a resting flipper's rubber soaks up the ball, so it's easier to catch
}
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
function sensors(b, px, py) {
  for (let i = 0; i < 3; i++) { const [a, c] = LANES[i]; if (inRect(b.x, b.y, a + 4, 66, c - 4, 94) && !inRect(px, py, a + 4, 66, c - 4, 94)) rolloverLane(i); }
  if (b.vy < -80 && inRect(b.x, b.y, 20, 360, 60, 392) && !inRect(px, py, 20, 360, 60, 392)) orbitShot(0);
  if (b.vy < -80 && inRect(b.x, b.y, 396, 360, 436, 392) && !inRect(px, py, 396, 360, 436, 392)) orbitShot(1);
  if ((py < 500) !== (b.y < 500) && b.x > 20 && b.x < 60) spinnerPass(b);
  const sp = Math.hypot(b.vx, b.vy);
  if (b.vy < -120 && sp > 260 && inRect(b.x, b.y, 149, 618, 187, 662)) { rampEntered(b, 0); return true; }
  if (b.vy < -120 && sp > 260 && inRect(b.x, b.y, 265, 618, 303, 662)) { rampEntered(b, 1); return true; }
  if (Math.hypot(b.x - SCOOP.x, b.y - SCOOP.y) < 14 && sp < 1200) { scoopCapture(b); return true; }
  if (G.kickbackLit && inRect(b.x, b.y, 22, 880, 56, 932)) { b.vy = -1450; b.vx = 25; G.kickbackLit = false; G.kickFlash = 1; sfx.kick(); callout('KICKBACK!', '#7dffd2'); buzz(40); }
  return false;
}
function physStep(dt) {
  for (const f of FLIPPERS) {
    const target = f.pressed && G.phase === 'play' ? f.up : f.rest, old = f.ang, sp = f.pressed ? 23 : 15;
    const dir = Math.sign(target - f.ang);
    f.ang += dir * sp * dt;
    if ((dir > 0 && f.ang > target) || (dir < 0 && f.ang < target)) f.ang = target;
    f.omega = (f.ang - old) / dt;
  }
  const live = G.balls.filter(b => b.state === 'play' || b.state === 'lane');
  for (const b of live) {
    const px = b.x, py = b.y;
    b.vy += GRAV * dt;
    b.vx *= 1 - 0.12 * dt; b.vy *= 1 - 0.04 * dt;
    const sp = Math.hypot(b.vx, b.vy); if (sp > MAXV) { b.vx *= MAXV / sp; b.vy *= MAXV / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    for (const s of SEGS) {
      if (s.kind === 'target' && G.targets[s.id]) continue;
      const imp = collideSeg(b, s);
      if (imp < 0) continue;
      if (s.kind === 'sling' && imp > 60) { b.vx += b.nx * 300; b.vy += b.ny * 300; hitSling(s.id); }
      else if (s.kind === 'target' && imp > 40 && b.ny > 0.5) hitTarget(s.id);
      else if (imp > 250) sfx.wall(imp);
    }
    for (const c of CIRCS) { const imp = collideCircle(b, c); if (imp < 0) continue; if (c.kind === 'bumper') hitBumper(c, b); else if (c.kind === 'grill' && imp > 120) hitGrill(b, imp); }
    for (const f of FLIPPERS) collideFlipper(b, f);
    if (b.state === 'play' && sensors(b, px, py)) continue;
    if (b.state === 'lane' && b.x < 436 && b.y < 320) b.state = 'play';
    if (b.state === 'play' && b.x > 438 && b.y > 320 && b.vy > 0) b.state = 'lane';
  }
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], c = live[j], dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
    if (d > 0 && d < a.r + c.r) {
      const nx = dx / d, ny = dy / d, o = (a.r + c.r - d) / 2;
      a.x -= nx * o; a.y -= ny * o; c.x += nx * o; c.y += ny * o;
      const rv = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
      if (rv < 0) { a.vx += rv * nx * 0.95; a.vy += rv * ny * 0.95; c.vx -= rv * nx * 0.95; c.vy -= rv * ny * 0.95; }
    }
  }
}

/* ====================== update ====================== */
function update(dt) {
  G.t += dt; G.stateT += dt;
  if (G.state === 'title') G.titleT += dt;
  if (G.state === 'over' && G.stateT > 1.2 && !G.entryHandled) { G.entryHandled = true; if (qualifies(G.score)) openEntry(); }
  for (const p of G.pops) { p.t -= dt; p.y -= 30 * dt; } G.pops = G.pops.filter(p => p.t > 0);
  for (const c of G.callouts) c.t += dt; G.callouts = G.callouts.filter(c => c.t < 2.2).slice(-2);
  if (G.flash > 0) G.flash -= dt * 2.2; if (G.shake > 0) G.shake -= dt;
  if (G.disp) { G.disp.t += dt; if (G.disp.t > G.disp.dur) G.disp = G.dispQ.shift() || null; }
  const decay = (arr, k) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.max(0, arr[i] - dt * k); };
  decay(G.bumperFlash, 4); decay(G.laneFlash, 2); decay(G.slingFlash, 5); decay(G.targetFlash, 2); decay(G.rampFlash, 1.2);
  G.grillFlash = Math.max(0, G.grillFlash - dt * 2); G.scoopFlash = Math.max(0, G.scoopFlash - dt * 1.5); G.kickFlash = Math.max(0, G.kickFlash - dt * 2);
  for (let i = 0; i < 4; i++) G.targetAnim[i] += ((G.targets[i] ? 1 : 0) - G.targetAnim[i]) * Math.min(1, dt * 14);
  G.grillAngle += G.grillV * dt + (G.state === 'title' ? dt * 0.8 : dt * 0.4); G.grillV *= Math.pow(0.4, dt);
  if (G.fridgeHoldT > 0) { G.fridgeHoldT -= dt; if (G.fridgeHoldT <= 0) G.fridgeTarget = 0; }
  G.fridgeOpen += (G.fridgeTarget - G.fridgeOpen) * Math.min(1, dt * 5);
  G.chef.t += dt; if (G.chef.mood !== 'idle' && G.chef.t > G.chef.dur) G.chef = { mood: 'idle', t: 0, dur: 0 };
  if (G.spinnerV > 0.5) {
    const before = Math.floor(G.spinner / Math.PI);
    G.spinner += G.spinnerV * dt; G.spinnerV *= Math.pow(0.15, dt);
    const after = Math.floor(G.spinner / Math.PI);
    for (let k = before; k < after; k++) { addScore(G.wizard ? 2000 : G.multiball ? 500 : 250); G.tally.spins++; sfx.spin(); }
  } else G.spinnerV = 0;
  if (G.state !== 'play') return;

  // mode intros freeze the table, Pinball FX style
  if (G.intro) {
    G.intro.t += dt;
    if (G.intro.t >= G.intro.dur) { const fn = G.intro.after; G.intro = null; if (fn) fn(); }
    return;
  }
  G.phaseT += dt;
  if (G.resetTargetsT > 0) { G.resetTargetsT -= dt; if (G.resetTargetsT <= 0) { G.targets = [false, false, false, false]; G.targetFlash = [1, 1, 1, 1]; } }
  if (G.saveT > 0) G.saveT -= dt;
  if (G.sizzleT > 0) { G.sizzleT -= dt; if (G.sizzleT <= 0) show('SIZZLE OVER', '', 1.2, '#ff8a3c'); }
  if (G.comboT > 0) G.comboT -= dt;
  if (G.mode >= 0) {
    G.modeT -= dt;
    if (G.modeT <= 0) { const m = MODES[G.mode]; G.modesPlayed[G.mode] = true; G.mode = -1; callout(m.name, '#ff9a9a', 'TIME’S UP'); sfx.fail(); chef('sad', 1.6); checkWizardReady(); }
  }
  if (G.wizard) { G.wizardT -= dt; if (G.wizardT <= 0) { G.wizard = false; G.modesPlayed = [false, false, false, false]; show('GRAND OPENING', 'COMPLETE!', 2.5, '#ff6fb5', 3); } }
  if (G.skillLive) { G.skillT += dt; if (G.balls.some(b => b.state === 'lane')) { if (Math.floor(G.skillT / 0.6) !== Math.floor((G.skillT - dt) / 0.6)) G.skillLane = (G.skillLane + 1) % 3; } else if (G.skillT > 12) G.skillLive = false; }

  if (G.phase === 'bonus') {
    if (!G.bonusAdded && G.phaseT > 2.4) { G.bonusAdded = true; addScore(G.bonusTotal); }
    if (Math.floor(G.phaseT * 10) !== Math.floor((G.phaseT - dt) * 10) && G.phaseT < 2.4) sfx.bonusTick();
    if (G.phaseT > 3.6) afterBonus();
    return;
  }
  // balls leaving the fridge, queued balls, plunger
  for (const p of G.pendingOut) { p.t -= dt; if (p.t <= 0) { const b = p.b; b.state = 'ramp'; b.path = RAMP_FO; b.rampD = 0; b.rampSide = 0; b.toFridge = false; b.fromFridge = true; } }
  G.pendingOut = G.pendingOut.filter(p => p.t > 0);
  if (G.queue > 0 && !G.balls.some(b => b.state === 'lane')) { G.queue--; serveToLane(true); }
  const laneBall = G.balls.find(b => b.state === 'lane' && b.y > 920 && Math.hypot(b.vx, b.vy) < 80);
  if (laneBall) {
    if (laneBall.auto || G.multiball) { G.autoT -= dt; G.plunger = clamp(1 - G.autoT / 0.8, 0, 0.8); if (G.autoT <= 0) launch(laneBall, 0.5 + Math.random() * 0.4); }
    else if (G.charging) G.plunger = Math.min(1, G.plunger + dt * 1.15);
  } else if (!G.charging) G.plunger = Math.max(0, G.plunger - dt * 6);

  const sub = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) physStep(sub);

  for (const b of G.balls) {
    if (b.state === 'ramp') {
      b.rampD += 820 * dt;
      const [x, y, h] = pathAt(b.path, b.rampD); b.x = x; b.y = y; b.h = h;
      if (b.rampD >= b.path.len) rampFinished(b);
    } else if (b.state === 'scoop') {
      if (!G.intro) { b.hold -= dt; if (b.hold <= 0) { b.state = 'play'; b.x = SCOOP.x + 12; b.y = SCOOP.y + 12; b.vx = 330; b.vy = 360; sfx.kick(); G.scoopFlash = 1; } }
    } else if (b.state !== 'locked' && b.state !== 'wait') b.h = 0;
    if (b.state === 'play') {
      if (!isFinite(b.x) || !isFinite(b.y) || b.x < 0 || b.x > TW || b.y < -40) { b.x = 453; b.y = 943; b.vx = b.vy = 0; b.state = 'lane'; b.auto = true; G.autoT = 0.5; continue; }
      if (b.y > TH + 20) { ballDrained(b); continue; }
      const sp = Math.hypot(b.vx, b.vy), cradled = FLIPPERS.some(f => f.pressed) && b.y > 600;
      b.still = sp < 18 && !cradled ? b.still + dt : 0;
      if (b.still > (b.y < 820 ? 2.5 : 4)) { b.vx = (Math.random() - 0.5) * 500; b.vy = -420; b.still = 0; show('BALL SEARCH', '', 1, '#7dd8ff'); }
    }
  }
  G.balls = G.balls.filter(b => b.state !== 'gone');
}
function launch(b, power) {
  b.vy = -(1230 + 240 * power); b.vx = 0; b.auto = false;
  sfx.plunge(power); buzz(25);
  G.plunger = 0; G.charging = false;
  if (!G.multiball && !G.saveUsed && G.saveT <= 0) G.saveT = 10;
}

/* ====================== input ====================== */
let entryOpen = false, lastTouch = 0;
const touches = new Map();
function uiPt(cx, cy) { const r = ui.getBoundingClientRect(); return { x: (cx - r.left) / r.width * UW, y: (cy - r.top) / r.height * UH }; }
function toggleMute() { muted = !muted; lsSet(GAME_ID + '.muted', muted ? '1' : '0'); }
function togglePause() {
  if (G.state === 'play') { G.state = 'paused'; FLIPPERS.forEach(f => f.pressed = false); G.charging = false; touches.clear(); }
  else if (G.state === 'paused') G.state = 'play';
}
function goFull() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  try { const p = el.requestFullscreen({ navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}
function waitingToPlunge() { return G.phase === 'play' && !G.intro && !G.multiball && G.balls.length >= 1 && G.balls.some(b => b.state === 'lane' && !b.auto) && activeBalls().length === 1; }
function setFlipper(side, on) {
  const fl = FLIPPERS.filter(f => f.side === side);
  const was = fl[0].pressed;
  fl.forEach(f => f.pressed = on);
  if (on && !was && G.state === 'play' && G.phase === 'play' && !G.intro) { sfx.flip(); rotateLanes(side ? 1 : -1); }
}
function plungeDown() { if (waitingToPlunge()) G.charging = true; }
function plungeUp() {
  if (!G.charging) return;
  const b = G.balls.find(x => x.state === 'lane' && x.y > 920);
  if (b) launch(b, G.plunger);
  G.charging = false;
}
function menuButtons() {
  const cy = UH / 2;
  const make = (labels, y) => {
    const bw = labels.length === 3 ? 124 : 150, gap = 12, tot = labels.length * bw + (labels.length - 1) * gap;
    return labels.map(([id, label, primary], i) => ({ id, label, primary, x: UW / 2 - tot / 2 + i * (bw + gap), y, w: bw, h: 44 }));
  };
  if (G.state === 'paused') return make([['resume', 'RESUME', true], ['cam', camFollow ? 'CAM: FOLLOW' : 'CAM: FIXED', false], ['arcade', '◀ ARCADE', false]], cy + 14);
  if (G.state === 'over' && G.stateT > 1.3 && G.entryHandled && !entryOpen)
    return make([['again', 'PLAY AGAIN', true], ['top', 'TOP 10', false], ['arcade', '◀ ARCADE', false]], cy + 40);
  return [];
}
function menuAction(id) {
  audio();
  if (id === 'resume') togglePause();
  else if (id === 'cam') toggleCamera();
  else if (id === 'again') startGame();
  else if (id === 'top') toTitle();
  else if (id === 'arcade') location.href = '/';
}
function endTips() { lsSet(GAME_ID + '.tipsSeen', '1'); G.state = 'play'; G.stateT = 0; }
function confirm() {
  if (entryOpen) return;
  audio();
  if (G.state === 'title') startGame();
  else if (G.state === 'tips') { if (G.stateT > 0.4) endTips(); }
  else if (G.state === 'paused') togglePause();
  else if (G.state === 'over') { if (G.stateT > 1.3 && G.entryHandled) startGame(); }
}
function tapUI(x, y) {
  if (entryOpen) return true;
  audio();
  if (y < HUD) {
    if (x > UW - 52) { if (G.state === 'play' || G.state === 'paused') togglePause(); return true; }
    if (x > UW - 102) { toggleMute(); return true; }
    if (x < 130 && G.state === 'title') { location.href = '/'; return true; }
  }
  const mb = menuButtons().find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  if (mb) { menuAction(mb.id); return true; }
  if (G.state === 'over') return true;
  if (G.state === 'play') return false;
  confirm(); return true;
}
function pressAt(id, x, y) {
  if (tapUI(x, y)) return;
  if (G.state !== 'play') return;
  if (waitingToPlunge()) { touches.set(id, 'plunge'); plungeDown(); return; }
  const side = x < UW / 2 ? 0 : 1; touches.set(id, side); setFlipper(side, true);
}
function releaseId(id) {
  const v = touches.get(id); touches.delete(id);
  if (v === 'plunge') plungeUp();
  else if (v === 0 || v === 1) { if (![...touches.values()].includes(v)) setFlipper(v, false); }
}
ui.addEventListener('touchstart', e => { e.preventDefault(); lastTouch = performance.now(); for (const t of e.changedTouches) { const p = uiPt(t.clientX, t.clientY); pressAt('t' + t.identifier, p.x, p.y); } }, { passive: false });
ui.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
const tEnd = e => { e.preventDefault(); lastTouch = performance.now(); for (const t of e.changedTouches) releaseId('t' + t.identifier); };
ui.addEventListener('touchend', tEnd, { passive: false });
ui.addEventListener('touchcancel', tEnd, { passive: false });
ui.addEventListener('mousedown', e => { e.preventDefault(); if (performance.now() - lastTouch < 800) return; const p = uiPt(e.clientX, e.clientY); pressAt('m', p.x, p.y); });
addEventListener('mouseup', () => releaseId('m'));
const LEFT_KEYS = ['ArrowLeft', 'z', 'Z', 'Shift', 'a', 'A'], RIGHT_KEYS = ['ArrowRight', '/', '?', 'x', 'X', 'l', 'L'];
const PLUNGE_KEYS = ['ArrowDown', ' ', 'Enter', 's', 'S'];
addEventListener('keydown', e => {
  if (entryOpen) return;
  audio();
  const isLeft = LEFT_KEYS.includes(e.key) && !(e.key === 'Shift' && e.location === 2);
  const isRight = RIGHT_KEYS.includes(e.key) || (e.key === 'Shift' && e.location === 2);
  if (G.state === 'play') {
    if (isLeft) { e.preventDefault(); setFlipper(0, true); return; }
    if (isRight) { e.preventDefault(); setFlipper(1, true); return; }
    if (PLUNGE_KEYS.includes(e.key)) { e.preventDefault(); if (!e.repeat) plungeDown(); return; }
  }
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) confirm(); return; }
  if (e.key === 'p' || e.key === 'P') togglePause();
  else if (e.key === 'm' || e.key === 'M') toggleMute();
  else if ((e.key === 'c' || e.key === 'C') && !e.repeat) toggleCamera();
  else if (e.key === 'Escape') {
    if (G.state === 'play' || G.state === 'paused') togglePause();
    else if (G.state === 'title') location.href = '/';
    else if (G.state === 'over' && G.entryHandled && G.stateT > 1.3) location.href = '/';
  }
});
addEventListener('keyup', e => {
  if (LEFT_KEYS.includes(e.key) && !(e.key === 'Shift' && e.location === 2)) setFlipper(0, false);
  if (RIGHT_KEYS.includes(e.key) || (e.key === 'Shift' && e.location === 2)) setFlipper(1, false);
  if (PLUNGE_KEYS.includes(e.key)) plungeUp();
});
addEventListener('blur', () => { FLIPPERS.forEach(f => f.pressed = false); if (G.state === 'play') togglePause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play') togglePause(); });

/* ====================== 3D scene ====================== */
const S = 0.1;   // world units per table unit
const W3 = (x, y, h = 0) => new THREE.Vector3((x - TW / 2) * S, h, (y - TH / 2) * S);
let renderer, scene, camera, composer, bloom, R3 = null;
let quality = IS_TOUCH ? 1 : 2;
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function radialTex(rgb) { return canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.25, `rgba(${rgb},.55)`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }); }

// --- realism helpers: worn print, satin finish, printed bumper caps, soft contact shadows ---
function weatherPlayfield(g, w, h) {
  // fine print grain and light wear where balls roll most (around the flippers and the center)
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  g.save(); g.globalCompositeOperation = 'screen';
  for (const [x, y, r, a] of [[0.5, 0.86, 0.32, 0.07], [0.5, 0.55, 0.22, 0.05], [0.36, 0.7, 0.12, 0.04], [0.64, 0.7, 0.12, 0.04]]) {
    const gr = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * w); gr.addColorStop(0, `rgba(255,245,230,${a})`); gr.addColorStop(1, 'rgba(255,245,230,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  g.restore();
}
function pfRoughTex() {
  // satin clear-coat with faint swirl scratches, so reflections break up like on a real playfield
  const t = canvasTex(512, 1024, (g) => {
    g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 1400; i++) { const v = 110 + Math.random() * 90 | 0; g.strokeStyle = `rgba(${v},${v},${v},0.35)`; g.lineWidth = 0.6 + Math.random(); g.beginPath(); const x = Math.random() * 512, y = Math.random() * 1024, r = 8 + Math.random() * 60, a = Math.random() * 6.28; g.arc(x, y, r, a, a + 0.3 + Math.random() * 0.8); g.stroke(); }
  });
  t.colorSpace = THREE.NoColorSpace; return t;
}
let _capTex = null;
function bumperCapTex() {
  if (_capTex) return _capTex;
  _capTex = canvasTex(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128); gr.addColorStop(0, '#fff2f8'); gr.addColorStop(0.7, '#ff8cc4'); gr.addColorStop(1, '#d62f7d'); g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 104, 0, 7); g.stroke();
    g.fillStyle = '#c8203a'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 34 : 78, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); } g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.font = `900 30px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('HOT', 128, 132);
  });
  return _capTex;
}
function addContactShadows(R) {
  const blob = radialTex('0,0,0');
  const strip = canvasTex(16, 64, (g) => { const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 16, 64); });
  const decal = (tex, x, z, w, d, op, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: op, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = ry; m.position.set(x, 0.012, z); m.renderOrder = 1; scene.add(m);
  };
  for (const c of CIRCS) {
    const p = W3(c.x, c.y), k = c.kind;
    if (k === 'bumper') decal(blob, p.x, p.z + 0.4, 7.5, 7.5, 0.6);
    else if (k === 'post') decal(blob, p.x, p.z + 0.2, 2.8, 2.8, 0.5);
    else if (k === 'grill') decal(blob, p.x, p.z + 0.4, 7.5, 7.5, 0.6);
  }
  for (const pts of SLINGS) { const cx = pts.reduce((a, q) => a + q[0], 0) / 3, cy = pts.reduce((a, q) => a + q[1], 0) / 3, p = W3(cx, cy); decal(blob, p.x, p.z, 7, 9, 0.45); }
  for (const s of SEGS) {
    if (s.look === 'none' || s.look === 'gate') continue;
    const a = W3(s.ax, s.ay), b = W3(s.bx, s.by), len = a.distanceTo(b); if (len < 0.5) continue;
    decal(strip, (a.x + b.x) / 2, (a.z + b.z) / 2, len + 0.8, s.look === 'outer' ? 3.2 : 2.2, s.look === 'outer' ? 0.45 : 0.38, -Math.atan2(b.z - a.z, b.x - a.x));
  }
  for (const [tx, ty, w, d] of [[228, 480, 12, 2.4], [42, 50, 8, 7], [400, 70, 5, 5], [92, 912, 7, 5.5], [360, 914, 7, 6]]) { const p = W3(tx, ty); decal(blob, p.x, p.z + 0.3, w, d, 0.5); }
}
function updateBallReflection(R, dt) {
  // The steel ball mirrors the diner. The first capture draws all six views at once; after that one view
  // is redrawn per frame (with the existing shadows), so the refresh never causes a stutter.
  const hideBalls = () => { const vis = R.balls.map(m => m.visible); R.balls.forEach(m => { m.visible = false; }); return vis; };
  if (!R.cubeReady) {
    const vis = hideBalls(); R.cubeCam.update(renderer, scene); R.balls.forEach((m, i) => { m.visible = vis[i]; });
    R.cubeReady = true; R.cubeFace = -1; R.cubeT = 1; return;
  }
  if (R.cubeFace < 0) { R.cubeT -= dt; if (R.cubeT > 0) return; R.cubeFace = 0; }
  const rt = R.cubeRT, face = R.cubeFace, prevRT = renderer.getRenderTarget(), auto = renderer.shadowMap.autoUpdate;
  const vis = hideBalls();
  renderer.shadowMap.autoUpdate = false;
  const gm = rt.texture.generateMipmaps; rt.texture.generateMipmaps = face === 5 && gm;
  renderer.setRenderTarget(rt, face); renderer.render(scene, R.cubeCam.children[face]);
  rt.texture.generateMipmaps = gm;
  renderer.setRenderTarget(prevRT); renderer.shadowMap.autoUpdate = auto;
  R.balls.forEach((m, i) => { m.visible = vis[i]; });
  if (face === 5) { rt.texture.needsPMREMUpdate = true; R.cubeFace = -1; R.cubeT = IS_TOUCH ? 1.5 : 0.5; } else R.cubeFace++;
}

/* ---- diner illustrations shared by the playfield print and the plastics (all original drawings) ---- */
const FOOD = {
  burger(g) { g.fillStyle = '#e0a050'; g.beginPath(); g.ellipse(0, -6, 20, 13, 0, Math.PI, 0); g.fill(); g.fillStyle = '#fff3d6'; for (const [x, y] of [[-8, -12], [0, -15], [8, -11], [-3, -9]]) { g.beginPath(); g.ellipse(x, y, 1.6, 1, 0.4, 0, 7); g.fill(); }
    g.fillStyle = '#4cc43c'; g.fillRect(-22, -7, 44, 4); g.fillStyle = '#ffc21a'; g.beginPath(); g.moveTo(-20, -3); g.lineTo(20, -3); g.lineTo(14, 3); g.lineTo(-14, 3); g.fill(); g.fillStyle = '#6a3418'; g.fillRect(-20, -2, 40, 7); g.fillStyle = '#e0a050'; g.beginPath(); g.ellipse(0, 7, 19, 5, 0, 0, Math.PI); g.fill(); g.fillRect(-19, 4, 38, 4); },
  fries(g) { g.fillStyle = '#ffc21a'; for (let i = 0; i < 8; i++) { g.save(); g.translate(-11 + i * 3.2, -6); g.rotate(-0.25 + i * 0.07); g.fillRect(-1.6, -18, 3.4, 22); g.restore(); }
    g.fillStyle = '#c8203a'; g.beginPath(); g.moveTo(-16, -6); g.lineTo(16, -6); g.lineTo(11, 20); g.lineTo(-11, 20); g.closePath(); g.fill(); g.fillStyle = '#fff6e0'; g.beginPath(); g.arc(0, 7, 5, 0, 7); g.fill(); g.fillStyle = '#c8203a'; g.font = `900 7px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('F', 0, 7.5); },
  shake(g) { g.strokeStyle = '#ffffff'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(4, -26); g.lineTo(10, -40); g.stroke(); g.strokeStyle = '#c8203a'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(4, -26); g.lineTo(10, -40); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#fffaf0'; for (const [x, y, r] of [[-7, -22, 7], [2, -25, 8], [9, -21, 6], [0, -30, 6]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    g.fillStyle = '#e8233c'; g.beginPath(); g.arc(1, -36, 4, 0, 7); g.fill(); g.strokeStyle = '#3a6a20'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(1, -40); g.quadraticCurveTo(4, -45, 7, -45); g.stroke();
    g.fillStyle = '#ff8cc4'; g.beginPath(); g.moveTo(-13, -19); g.lineTo(13, -19); g.lineTo(8, 14); g.lineTo(-8, 14); g.closePath(); g.fill(); g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(-9, -16, 3, 26);
    g.fillStyle = '#d7dbe6'; g.fillRect(-3, 14, 6, 6); g.beginPath(); g.ellipse(0, 22, 11, 3.5, 0, 0, 7); g.fill(); },
  coffee(g) { g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2; for (const x of [-5, 3]) { g.beginPath(); g.moveTo(x, -14); g.bezierCurveTo(x - 5, -20, x + 5, -24, x, -30); g.stroke(); }
    g.fillStyle = '#f4f1e8'; g.beginPath(); g.ellipse(0, 12, 22, 5, 0, 0, 7); g.fill(); g.fillStyle = '#f7f4ec'; g.beginPath(); g.moveTo(-13, -10); g.lineTo(13, -10); g.lineTo(10, 10); g.lineTo(-10, 10); g.closePath(); g.fill();
    g.strokeStyle = '#f7f4ec'; g.lineWidth = 3.5; g.beginPath(); g.arc(14, 0, 5.5, -1.2, 1.4); g.stroke(); g.fillStyle = '#5a2c14'; g.beginPath(); g.ellipse(0, -10, 13, 3, 0, 0, 7); g.fill(); g.fillStyle = '#c8203a'; g.fillRect(-11, -2, 22, 3); },
  pie(g) { g.fillStyle = '#d98a3a'; g.beginPath(); g.moveTo(-20, 8); g.lineTo(18, 14); g.lineTo(2, -18); g.closePath(); g.fill(); g.fillStyle = '#b8243a'; g.beginPath(); g.moveTo(-14, 7); g.lineTo(13, 11); g.lineTo(2, -11); g.closePath(); g.fill();
    g.strokeStyle = '#f0b060'; g.lineWidth = 2; for (const t of [0.3, 0.55, 0.8]) { g.beginPath(); g.moveTo(-20 + 22 * t, 8 - 26 * t); g.lineTo(18 - 16 * t, 14 - 32 * t); g.stroke(); }
    g.fillStyle = '#fffaf0'; g.beginPath(); g.arc(-4, -4, 5, 0, 7); g.arc(1, -6, 4, 0, 7); g.fill(); },
  hotdog(g) { g.rotate(-0.35); g.fillStyle = '#e0a050'; g.beginPath(); g.ellipse(0, 3, 24, 8, 0, 0, 7); g.fill(); g.fillStyle = '#b8402a'; g.beginPath(); g.ellipse(0, -1, 27, 5, 0, 0, 7); g.fill();
    g.strokeStyle = '#ffc21a'; g.lineWidth = 2; g.beginPath(); for (let i = 0; i <= 10; i++) { const x = -20 + i * 4; g.lineTo(x, -1 + (i % 2 ? -2.5 : 2.5)); } g.stroke(); },
  pancakes(g) { for (let i = 0; i < 4; i++) { g.fillStyle = '#c98a40'; g.beginPath(); g.ellipse(0, 10 - i * 6, 22, 6, 0, 0, 7); g.fill(); g.fillStyle = '#e8b060'; g.beginPath(); g.ellipse(0, 8 - i * 6, 21, 5, 0, 0, 7); g.fill(); }
    g.fillStyle = '#ffe9a0'; g.fillRect(-5, -16, 10, 6); g.fillStyle = 'rgba(160,80,20,.85)'; g.beginPath(); g.moveTo(-12, -11); g.quadraticCurveTo(0, -18, 14, -10); g.quadraticCurveTo(17, 0, 13, 4); g.quadraticCurveTo(10, -4, 4, -6); g.quadraticCurveTo(-6, -3, -12, -11); g.fill(); },
};
function drawFood(g, kind, x, y, s = 1, rot = 0) { g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s); FOOD[kind](g); g.restore(); }
function menuBadge(g, x, y, r, kind, label, s = 1) {
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(2, 3, r, 0, 7); g.fill();
  g.fillStyle = '#f4ecd8'; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.strokeStyle = '#c8203a'; g.lineWidth = r * 0.12; g.beginPath(); g.arc(0, 0, r * 0.9, 0, 7); g.stroke();
  g.restore();
  drawFood(g, kind, x, y - r * 0.12, s);
  if (label) { g.save(); g.font = `900 ${Math.round(r * 0.24)}px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#c8203a'; g.fillText(label, x, y + r * 0.66); g.restore(); }
}
function drawDinerPrints(g, K) {
  // extra printed menu art on the playfield
  g.save(); g.scale(K, K);
  menuBadge(g, 352, 452, 30, 'shake', 'MALTS', 0.62);
  menuBadge(g, 100, 592, 26, 'coffee', 'JOE', 0.72);
  menuBadge(g, 292, 340, 24, 'pie', 'PIE', 0.72);
  menuBadge(g, 168, 350, 24, 'hotdog', 'DOGS', 0.62);
  menuBadge(g, 228, 392, 27, 'pancakes', 'STACKS', 0.72);
  // an order ticket clipped to the checker floor
  g.save(); g.translate(228, 800); g.rotate(-0.06);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-29, -17, 62, 40);
  g.fillStyle = '#fffbe8'; g.fillRect(-31, -20, 62, 40);
  g.fillStyle = '#c8203a'; g.fillRect(-31, -20, 62, 7); g.fillStyle = '#fffbe8'; g.font = `900 6px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ORDER  No. 42', 0, -16.5);
  g.fillStyle = '#2a3a8a'; g.font = `italic 700 6.5px ${UI_FONT}`; g.textAlign = 'left';
  ['2  burger + fries', '1  cherry pie', '1  choc. malt'].forEach((t, i) => g.fillText(t, -27, -6 + i * 8));
  g.fillStyle = '#9aa0aa'; g.fillRect(-6, -24, 12, 6);
  g.restore();
  // a few more sparkles
  const star = (x, y, r) => { g.fillStyle = 'rgba(255,240,200,.7)'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.3 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); };
  [[250, 160, 6], [140, 470, 5], [320, 600, 6], [70, 330, 5], [380, 250, 5]].forEach(a => star(...a));
  g.restore();
}

/* ---- printed plastics mounted on posts above the playfield ---- */
function plasticPiece(poly, h, draw, posts = []) {
  const k = 6, xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const tex = canvasTex(Math.ceil((x1 - x0) * k), Math.ceil((y1 - y0) * k), (g) => {
    g.save(); g.scale(k, k); g.translate(-x0, -y0);
    g.beginPath(); poly.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.clip();
    draw(g, x0, y0, x1, y1);
    g.lineWidth = 2.4; g.strokeStyle = '#1a0a10'; g.stroke();
    g.restore();
  });
  const shape = new THREE.Shape(); poly.forEach(([x, y], i) => { const v = W3(x, y); i ? shape.lineTo(v.x, -v.z) : shape.moveTo(v.x, -v.z); }); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
  const a = W3(x0, y0), b = W3(x1, y1), uv = geo.attributes.uv, pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) { const wx = pos.getX(i), wy = pos.getY(i); uv.setXY(i, (wx - a.x) / (b.x - a.x), (wy - (-b.z)) / ((-a.z) - (-b.z))); }
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.25, transparent: true, opacity: 0.93 }));
  m.rotation.x = -Math.PI / 2; m.position.y = h; m.castShadow = true; m.renderOrder = 3; scene.add(m);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: 0.25 });
  for (const [x, y] of posts) { const pst = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, h, 10), postMat); pst.position.copy(W3(x, y, h / 2)); pst.castShadow = true; scene.add(pst); const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 6), postMat); nut.position.copy(W3(x, y, h + 0.2)); scene.add(nut); }
  return m;
}
function buildPlastics() {
  const stripes = (g, x0, y0, x1, y1, a, b, w = 10) => { g.fillStyle = a; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.fillStyle = b; for (let x = x0 - (y1 - y0); x < x1; x += w * 2) { g.beginPath(); g.moveTo(x, y1); g.lineTo(x + w, y1); g.lineTo(x + w + (y1 - y0), y0); g.lineTo(x + (y1 - y0), y0); g.fill(); } };
  const label = (g, t, x, y, size, rot = 0, fill = '#fff6e0') => { g.save(); g.translate(x, y); g.rotate(rot); g.font = `900 ${size}px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = size * 0.28; g.strokeStyle = '#1a0a10'; g.strokeText(t, 0, 0); g.fillStyle = fill; g.fillText(t, 0, 0); g.restore(); };
  // slingshot plastics: fries on the left, a malt on the right
  plasticPiece([[86, 726], [104, 732], [146, 816], [138, 826], [84, 796]], 2.7, (g, x0, y0, x1, y1) => {
    stripes(g, x0, y0, x1, y1, '#c8203a', '#a8182e', 6);
    g.fillStyle = '#f4ecd8'; g.beginPath(); g.arc(102, 772, 15, 0, 7); g.fill(); drawFood(g, 'fries', 102, 774, 0.55);
    label(g, 'HOT', 116, 803, 9, 1.05);
  }, [[90, 732], [90, 794], [138, 820]]);
  plasticPiece([[370, 726], [352, 732], [310, 816], [318, 826], [372, 796]], 2.7, (g, x0, y0, x1, y1) => {
    stripes(g, x0, y0, x1, y1, '#2fb5a8', '#239489', 6);
    g.fillStyle = '#f4ecd8'; g.beginPath(); g.arc(354, 772, 15, 0, 7); g.fill(); drawFood(g, 'shake', 354, 778, 0.42);
    label(g, 'MALT', 340, 803, 8.5, -1.05);
  }, [[366, 732], [366, 794], [318, 820]]);
  // inlane guide plastics
  plasticPiece([[50, 712], [68, 712], [68, 796], [150, 850], [142, 866], [50, 810]], 3.0, (g, x0, y0, x1, y1) => {
    g.fillStyle = '#f4ecd8'; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.fillStyle = '#c8203a'; g.fillRect(x0, y0, 6, y1 - y0);
    for (let y = y0; y < y1; y += 12) { g.fillStyle = (y / 12 | 0) % 2 ? '#141414' : '#f4ecd8'; g.fillRect(x0 + 6, y, 12, 12); }
    label(g, 'ORDER UP!', 108, 834, 9, 0.58, '#c8203a');
  }, [[58, 716], [58, 800], [140, 856]]);
  plasticPiece([[406, 712], [388, 712], [388, 796], [306, 850], [314, 866], [406, 810]], 3.0, (g, x0, y0, x1, y1) => {
    g.fillStyle = '#f4ecd8'; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.fillStyle = '#2fb5a8'; g.fillRect(x1 - 6, y0, 6, y1 - y0);
    for (let y = y0; y < y1; y += 12) { g.fillStyle = (y / 12 | 0) % 2 ? '#141414' : '#f4ecd8'; g.fillRect(x1 - 18, y, 12, 12); }
    label(g, 'COMING UP!', 348, 834, 8.5, -0.58, '#c8203a');
  }, [[398, 716], [398, 800], [316, 856]]);
}

/* ---- ramps built like diner countertops: Formica tops with ribbed chrome edging and a neon strip ---- */
function formicaTex(kind) {
  const t = canvasTex(256, 512, (g) => {
    if (kind === 'boomerang') {
      g.fillStyle = '#f2e8d2'; g.fillRect(0, 0, 256, 512);
      const cols = ['#2fb5a8', '#e8233c', '#f2b23a', '#7a8a94'];
      for (let i = 0; i < 46; i++) { const x = (i * 97) % 256, y = (i * 173) % 512, r = 14 + (i % 3) * 6, rot = i * 1.3; g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = cols[i % 4]; g.globalAlpha = 0.8; g.beginPath(); g.moveTo(-r, 0); g.quadraticCurveTo(0, -r, r, 0); g.quadraticCurveTo(0, -r * 0.4, -r, 0); g.fill(); g.restore(); }
      g.globalAlpha = 1; for (let i = 0; i < 400; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(200,160,60,.7)' : 'rgba(40,40,40,.35)'; g.fillRect(Math.random() * 256, Math.random() * 512, 1.6, 1.6); }
    } else {
      g.fillStyle = '#b3182e'; g.fillRect(0, 0, 256, 512);
      for (let i = 0; i < 260; i++) { const x = Math.random() * 256, y = Math.random() * 512, r = 6 + Math.random() * 18; g.strokeStyle = `rgba(255,${120 + Math.random() * 80 | 0},${130 + Math.random() * 60 | 0},.35)`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) g.lineTo(x + (Math.random() - 0.5) * r * 2, y + (Math.random() - 0.5) * r * 2); g.stroke(); }
      for (let i = 0; i < 900; i++) { g.fillStyle = Math.random() < 0.6 ? 'rgba(255,230,200,.85)' : 'rgba(255,160,180,.6)'; g.fillRect(Math.random() * 256, Math.random() * 512, 1.3, 1.3); }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
let _ribTex = null;
function ribTex() {
  if (_ribTex) return _ribTex;
  _ribTex = canvasTex(64, 64, (g) => { for (let y = 0; y < 64; y += 8) { const gr = g.createLinearGradient(0, y, 0, y + 8); gr.addColorStop(0, '#f6f8fc'); gr.addColorStop(0.5, '#8d93a0'); gr.addColorStop(1, '#e2e6ee'); g.fillStyle = gr; g.fillRect(0, y, 64, 8); } });
  _ribTex.wrapS = _ribTex.wrapT = THREE.RepeatWrapping; return _ribTex;
}
function buildCounterRamp(path, kind, neonColor, short = false) {
  const n = path.pts.length, hw = 1.35, wall = 0.95, skirt = 0.32;
  const floor = { pos: [], uv: [], idx: [] }, trim = { pos: [], uv: [], idx: [] };
  const push = (o, v, u, w) => { o.pos.push(v.x, v.y, v.z); o.uv.push(u, w); return o.pos.length / 3 - 1; };
  let dist = 0, last = null, pf = null, pt = null;
  for (let i = 0; i < n; i++) {
    const { p, side } = rampFrame(path, i);
    if (last) dist += p.distanceTo(last); last = p;
    const L0 = p.clone().addScaledVector(side, -hw), R0 = p.clone().addScaledVector(side, hw);
    const v = dist / 5.5;
    const f = [push(floor, L0, 0, v), push(floor, R0, 1, v)];
    if (pf) floor.idx.push(pf[0], f[0], pf[1], pf[1], f[0], f[1]);
    pf = f;
    // chrome band: left wall top -> left wall bottom -> left skirt, and the same on the right
    const L1 = L0.clone(); L1.y += wall; const Ls = L0.clone(); Ls.y -= skirt; const R1 = R0.clone(); R1.y += wall; const Rs = R0.clone(); Rs.y -= skirt;
    const vt = dist / 1.2;
    const tr = [push(trim, L1, vt, 0), push(trim, Ls, vt, 1), push(trim, R1, vt, 0), push(trim, Rs, vt, 1)];
    if (pt) { trim.idx.push(pt[0], tr[0], pt[1], pt[1], tr[0], tr[1]); trim.idx.push(pt[2], pt[3], tr[2], pt[3], tr[3], tr[2]); }
    pt = tr;
  }
  const mkGeo = (o) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2)); geo.setIndex(o.idx); geo.computeVertexNormals(); return geo; };
  const top = new THREE.Mesh(mkGeo(floor), new THREE.MeshPhysicalMaterial({ map: formicaTex(kind), roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.3, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
  top.castShadow = true; top.receiveShadow = true; top.renderOrder = 2; scene.add(top);
  const band = new THREE.Mesh(mkGeo(trim), new THREE.MeshStandardMaterial({ map: ribTex(), metalness: 0.95, roughness: 0.3, side: THREE.DoubleSide }));
  band.castShadow = true; scene.add(band);
  // neon strip under each outer edge: the part that glows when the ramp is lit
  const neon = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: neonColor, emissiveIntensity: 0.6, roughness: 0.4 });
  for (const sgn of [-1, 1]) {
    const pts = []; for (let i = 0; i < n; i += 2) { const { p, side } = rampFrame(path, i); if (p.y < 0.6) continue; const q = p.clone().addScaledVector(side, sgn * (hw + 0.12)); q.y -= skirt + 0.08; pts.push(q); }
    if (pts.length > 2) scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, 0.13, 6), neon));
  }
  // chrome support posts
  if (!short) for (let i = 12; i < n - 6; i += 18) { const { p } = rampFrame(path, i); if (p.y < 1) continue; const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, p.y - skirt, 8), R3 ? R3.M.chrome : new THREE.MeshStandardMaterial({ color: 0xc0c6d4, metalness: 1, roughness: 0.3 })); post.position.set(p.x, (p.y - skirt) / 2, p.z); post.castShadow = true; scene.add(post); }
  return neon;
}
function rampSign(x, y, text, sub, color) {
  // menu-board sign over a ramp entrance
  const tex = canvasTex(256, 128, (g) => {
    g.fillStyle = '#16121c'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#d8dde8'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 118);
    g.font = `900 56px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = '#ffffff'; g.fillText(text, 128, 54);
    g.shadowBlur = 0; g.font = `800 22px ${UI_FONT}`; g.fillStyle = color; g.fillText(sub, 128, 100);
  });
  const g = new THREE.Group(); g.position.copy(W3(x, y));
  const sign = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.2), [0, 0, 0, 0, 0, 0].map((_, i) => i === 4 ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : new THREE.MeshStandardMaterial({ color: 0xc9ceda, metalness: 1, roughness: 0.3 })));
  sign.position.y = 4.8; sign.rotation.x = -0.4; sign.castShadow = true; g.add(sign);
  for (const sx of [-2.6, 2.6]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.6, 8), new THREE.MeshStandardMaterial({ color: 0xc9ceda, metalness: 1, roughness: 0.3 })); post.position.set(sx, 1.8, -0.3); g.add(post); }
  scene.add(g);
}

/* ---- corner toys: a toaster that pops toast, and a milkshake mixer that whirs ---- */
function buildCornerToys(R) {
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe3ec, metalness: 1, roughness: 0.18 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xf4ecd8, roughness: 0.5 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc8203a, roughness: 0.35 });
  // toaster, bottom-left
  {
    const g = new THREE.Group(); g.position.copy(W3(92, 912)); g.rotation.y = 0.35;
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.6, 2.6), chrome); body.position.y = 1.4; body.castShadow = true; g.add(body);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 4.2, 20, 1, false, 0, Math.PI), chrome); top.rotation.z = Math.PI / 2; top.position.y = 2.7; top.scale.set(1, 0.45, 1); g.add(top);
    for (const z of [-0.6, 0.6]) { const slot = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.06, 0.5), new THREE.MeshBasicMaterial({ color: 0x0a0a0a })); slot.position.set(0, 3.29, z); g.add(slot); }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.24, 0.35, 2.64), red); stripe.position.y = 1.1; g.add(stripe);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0x1a1a1e })); lever.position.set(2.3, 2.0, 0); g.add(lever);
    for (const fx of [-1.4, 1.4]) { const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1e })); foot.position.set(fx, 0.1, 0); g.add(foot); }
    const toastMat = new THREE.MeshStandardMaterial({ color: 0xd9a050, roughness: 0.8 }), crust = new THREE.MeshStandardMaterial({ color: 0x8a4a1a, roughness: 0.8 });
    const toasts = [-0.6, 0.6].map(z => { const t = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 0.35), [crust, crust, crust, crust, toastMat, toastMat]); t.position.set(0, 3.0, z); t.castShadow = true; g.add(t); return t; });
    scene.add(g); R.toaster = { toasts, t: 9, lever };
  }
  // milkshake mixer, bottom-right
  {
    const g = new THREE.Group(); g.position.copy(W3(356, 912)); g.rotation.y = -0.4;
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, 3), cream); base.position.y = 0.3; base.castShadow = true; g.add(base);
    const col = new THREE.Mesh(new THREE.BoxGeometry(1.0, 4.6, 1.0), cream); col.position.set(0, 2.6, -1.0); col.castShadow = true; g.add(col);
    const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 1.6, 6, 14), cream); head.rotation.x = Math.PI / 2; head.position.set(0, 4.7, -0.3); head.castShadow = true; g.add(head);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.3, 16), red); band.rotation.x = Math.PI / 2; band.position.set(0, 4.7, -0.6); g.add(band);
    const spindle = new THREE.Group(); spindle.position.set(0, 4.0, 0.4); g.add(spindle);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6), chrome); rod.position.y = -1.1; spindle.add(rod);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.12), chrome); blade.position.y = -2.1; spindle.add(blade);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.6, 2.4, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xe6ebf5, metalness: 1, roughness: 0.15, side: THREE.DoubleSide })); cup.position.set(0, 1.8, 0.4); cup.castShadow = true; g.add(cup);
    const shake = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.62, 0.3, 20), new THREE.MeshStandardMaterial({ color: 0xff9cc8, roughness: 0.6 })); shake.position.set(0, 2.7, 0.4); g.add(shake);
    // a finished malt waiting beside it
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.32, 1.9, 18), new THREE.MeshPhysicalMaterial({ color: 0xff8cc4, roughness: 0.2, transparent: true, opacity: 0.9 })); glass.position.set(1.9, 1.25, 0.9); glass.castShadow = true; g.add(glass);
    const whip = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.7 })); whip.scale.y = 0.7; whip.position.set(1.9, 2.3, 0.9); g.add(whip);
    const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe8233c, roughness: 0.3 })); cherry.position.set(1.9, 2.75, 0.9); g.add(cherry);
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff })); straw.position.set(2.1, 2.9, 0.8); straw.rotation.z = -0.3; g.add(straw);
    scene.add(g); R.mixer = { spindle, shake, cup, g, base: g.position.clone() };
  }
}
function animateCornerToys(R, dt, t) {
  if (!R.toaster) return;
  // toast pops whenever a big callout appears
  const fresh = G.callouts.some(c => c.t < dt * 1.5);
  if (fresh && R.toaster.t > 1.2) R.toaster.t = 0;
  R.toaster.t += dt;
  const k = R.toaster.t, pop = k < 0.25 ? k / 0.25 * 2.6 : k < 1.4 ? 2.6 - Math.max(0, k - 1.0) * 1.2 : Math.max(0, 2.6 - 0.48 - (k - 1.4) * 4);
  R.toaster.toasts.forEach((m, i) => { m.position.y = 3.0 + Math.max(0, pop) * (i ? 0.92 : 1); m.rotation.z = k < 1.4 ? Math.sin(k * 9 + i) * 0.06 : 0; });
  R.toaster.lever.position.y = 2.0 - (k > 1.4 ? 0.9 : 0);
  // mixer whirs during multiball and the shake mode
  const busy = G.multiball || (G.mode >= 0 && MODES[G.mode].key === 'shake') || G.rampFlash[1] > 0;
  const m = R.mixer;
  m.spindle.rotation.y += dt * (busy ? 40 : 2);
  m.g.position.x = m.base.x + (busy ? Math.sin(t * 60) * 0.03 : 0);
  m.shake.position.y = 2.7 + (busy ? Math.abs(Math.sin(t * 20)) * 0.08 : 0);
}

function drawPlayfieldArt(g, K) {
  // original painted art in a classic 1950s diner palette: teal, cherry red, cream and chrome
  g.save(); g.scale(K, K);
  const lg = (x0, y0, x1, y1, st) => { const gr = g.createLinearGradient(x0, y0, x1, y1); st.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
  g.fillStyle = '#0d2a30'; g.fillRect(0, 0, TW, TH);
  g.save(); g.beginPath(); g.moveTo(20, TH); g.lineTo(20, 245); for (const [x, y] of ARC) g.lineTo(x, y); g.lineTo(470, TH); g.closePath(); g.clip();
  g.fillStyle = lg(0, 0, 0, TH, [[0, '#0f3f4a'], [0.4, '#167a7a'], [0.62, '#0f5560'], [1, '#0a2a30']]); g.fillRect(0, 0, TW, TH);
  // atomic starburst behind the pots
  g.save(); g.translate(228, 220);
  for (let i = 0; i < 24; i++) { g.rotate(Math.PI / 12); g.fillStyle = i % 2 ? 'rgba(255,236,200,.13)' : 'rgba(200,32,58,.18)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(-30, -360); g.lineTo(30, -360); g.closePath(); g.fill(); }
  g.restore();
  g.fillStyle = 'rgba(255,214,120,.25)'; g.beginPath(); g.arc(228, 220, 70, 0, Math.PI * 2); g.fill();
  // boomerangs and sparkles scattered over the upper field
  const boomerang = (x, y, r, rot, c) => { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = c; g.beginPath(); g.moveTo(-r, 0); g.quadraticCurveTo(0, -r * 0.9, r, 0); g.quadraticCurveTo(0, -r * 0.35, -r, 0); g.fill(); g.restore(); };
  [[90, 200, 26, 0.4, '#ff9a3c'], [370, 180, 30, -0.5, '#f4ecd8'], [120, 560, 22, 0.9, '#ff5a6a'], [340, 520, 24, -0.2, '#ffc21a'], [70, 470, 20, 1.6, '#f4ecd8'], [360, 410, 20, 2.4, '#ff9a3c']].forEach(a => boomerang(...a));
  const star = (x, y, r, c) => { g.fillStyle = c; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.3 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); };
  [[150, 150, 9], [310, 140, 7], [200, 380, 6], [300, 360, 8], [100, 620, 6], [350, 640, 7]].forEach(([x, y, r]) => star(x, y, r, 'rgba(255,240,200,.75)'));
  // black-and-white checker linoleum toward the flippers, with a chrome border
  g.save(); g.beginPath(); g.moveTo(20, 700); g.lineTo(436, 700); g.lineTo(436, TH); g.lineTo(20, TH); g.closePath(); g.clip();
  for (let y = 700; y < TH; y += 24) for (let x = 20; x < 440; x += 24) { g.fillStyle = (((x - 20) / 24 + (y - 700) / 24) | 0) % 2 ? '#141414' : '#f2eee2'; g.fillRect(x, y, 24, 24); }
  g.fillStyle = lg(0, 700, 0, 760, [[0, 'rgba(10,40,48,.9)'], [1, 'rgba(10,40,48,0)']]); g.fillRect(0, 700, TW, 60);
  g.restore();
  g.fillStyle = '#c9ced6'; g.fillRect(20, 698, 416, 4); g.fillStyle = '#c8203a'; g.fillRect(20, 694, 416, 4);
  // painted plate of burger and fries between the flippers
  g.save(); g.translate(228, 900);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(4, 6, 62, 22, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f7f4ec'; g.beginPath(); g.ellipse(0, 0, 62, 22, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#c8203a'; g.lineWidth = 3; g.beginPath(); g.ellipse(0, 0, 54, 18, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ffc21a'; for (let i = 0; i < 7; i++) { g.save(); g.translate(22 + i * 4, -6); g.rotate(-0.5 + i * 0.12); g.fillRect(-2, -14, 5, 22); g.restore(); }
  g.fillStyle = '#e0a050'; g.beginPath(); g.ellipse(-14, -10, 22, 11, 0, Math.PI, 0); g.fill(); g.fillStyle = '#6a3418'; g.fillRect(-34, -10, 40, 7); g.fillStyle = '#4cc43c'; g.fillRect(-36, -12, 44, 3); g.fillStyle = '#e0a050'; g.fillRect(-32, -3, 36, 6);
  g.restore();
  // diner logo plaque with a chrome ring
  g.save(); g.translate(224, 548);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(4, 6, 96, 36, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = lg(0, -36, 0, 36, [[0, '#ffffff'], [0.5, '#9aa0aa'], [1, '#e6ebf5']]); g.beginPath(); g.ellipse(0, 0, 96, 36, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c8203a'; g.beginPath(); g.ellipse(0, 0, 88, 29, 0, 0, Math.PI * 2); g.fill();
  g.font = `italic 900 26px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff6e0'; g.fillText('Flipside', 0, -6);
  g.font = `900 11px ${UI_FONT}`; g.fillStyle = '#9fe3d6'; g.fillText('D  I  N  E  R', 0, 15);
  g.restore();
  // painted labels
  g.font = `900 9px ${UI_FONT}`; g.textAlign = 'center'; g.fillStyle = '#f4ecd8';
  g.fillText('ORDER', 106, 468); g.fillText('WINDOW', 106, 478); g.fillText('SAUCE', 168, 704); g.fillText('SHAKE', 284, 704);
  g.fillText('KICK', 44, 872); g.fillText('ORBIT', 42, 678); g.fillText('ORBIT', 414, 678);
  g.font = `900 10px ${UI_FONT}`; g.fillStyle = '#c8203a'; g.fillText('SHOOT AGAIN', 228, 948);
  // insert sockets: dark rings under every light
  // shooter lane
  g.fillStyle = lg(436, 0, 470, 0, [[0, '#0a1e22'], [0.5, '#123a40'], [1, '#0a1e22']]); g.fillRect(436, 260, 34, 700);
  g.restore();
  for (const p of [RAMP_L, RAMP_R]) {
    g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 28; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); p.pts.forEach(([x, y, h], i) => { const ox = x - h * 1.2, oy = y - h * 2.2; i ? g.lineTo(ox, oy) : g.moveTo(ox, oy); }); g.stroke();
  }
  g.restore();
}
function insertTex(label, shape, fg = '#1a0820') {
  return canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#ffffff';
    if (shape === 'circle') { g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill(); }
    else if (shape === 'arrow') { g.beginPath(); g.moveTo(64, 4); g.lineTo(122, 70); g.lineTo(86, 64); g.lineTo(86, 124); g.lineTo(42, 124); g.lineTo(42, 64); g.lineTo(6, 70); g.closePath(); g.fill(); }
    else if (shape === 'pill') { const r = 34; g.beginPath(); g.moveTo(r, 30); g.arcTo(124, 30, 124, 98, r); g.arcTo(124, 98, 4, 98, r); g.arcTo(4, 98, 4, 30, r); g.arcTo(4, 30, 124, 30, r); g.closePath(); g.fill(); }
    if (label) { g.fillStyle = fg; g.font = `900 ${label.length > 2 ? 34 : 56}px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 64, shape === 'arrow' ? 82 : 66); }
  });
}

/* ====================== the diner world around the table (all original designs) ====================== */
function drawBricks(g, w, h, bw = 64, bh = 24, base = '#8c3a2a') {
  g.fillStyle = '#5a2a20'; g.fillRect(0, 0, w, h);
  for (let r = 0; r * bh < h; r++) for (let c = -1; c * bw < w; c++) {
    const x = c * bw + (r % 2) * bw / 2, y = r * bh, k = ((r * 7 + c * 13) % 5) / 5;
    g.fillStyle = `hsl(${10 + k * 8}, ${45 + k * 10}%, ${30 + k * 8}%)`; g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x + 2, y + 2, bw - 4, 3);
  }
}
function diningWallTex() {   // the dining-room wall seen behind the booths (left side)
  return canvasTex(2048, 512, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#9fe3d6'); sky.addColorStop(1, '#6fc8ba'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
    // checker wainscot
    for (let y = 300; y < h; y += 26) for (let x = 0; x < w; x += 26) { g.fillStyle = ((x / 26 + y / 26) | 0) % 2 ? '#111' : '#f4f1e8'; g.fillRect(x, y, 26, 26); }
    g.fillStyle = '#d7dbe6'; g.fillRect(0, 286, w, 14); g.fillStyle = '#c8203a'; g.fillRect(0, 292, w, 4);
    // windows with the night street outside
    for (let i = 0; i < 4; i++) {
      const x = 120 + i * 480, y = 60, ww = 300, wh = 190;
      const ng = g.createLinearGradient(0, y, 0, y + wh); ng.addColorStop(0, '#132a4a'); ng.addColorStop(1, '#2d4f7c'); g.fillStyle = ng; g.fillRect(x, y, ww, wh);
      g.fillStyle = 'rgba(255,220,140,.9)'; g.beginPath(); g.arc(x + 60 + i * 30, y + 70, 14, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,220,140,.25)'; g.beginPath(); g.arc(x + 60 + i * 30, y + 70, 40, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0b1424'; g.fillRect(x, y + wh - 40, ww, 40);
      for (let k = 0; k < 5; k++) { g.fillStyle = `rgba(255,230,160,${0.4 + k * 0.1})`; g.fillRect(x + 20 + k * 55, y + wh - 70 - (k % 3) * 20, 30, 40 + (k % 3) * 20); }
      g.strokeStyle = '#e6ebf5'; g.lineWidth = 10; g.strokeRect(x, y, ww, wh); g.lineWidth = 5; g.beginPath(); g.moveTo(x + ww / 2, y); g.lineTo(x + ww / 2, y + wh); g.stroke();
      // red-and-white awning stripe over each window
      for (let s = 0; s < 10; s++) { g.fillStyle = s % 2 ? '#fff' : '#c8203a'; g.fillRect(x - 10 + s * 32, y - 30, 32, 26); }
    }
    // framed food pictures between windows
    const art = (x, y, kind) => {
      g.fillStyle = '#2a1a10'; g.fillRect(x - 6, y - 6, 92, 92); g.fillStyle = '#fff6e0'; g.fillRect(x, y, 80, 80);
      if (kind === 0) { g.fillStyle = '#e0a050'; g.beginPath(); g.ellipse(x + 40, y + 34, 26, 14, 0, Math.PI, 0); g.fill(); g.fillStyle = '#6a3418'; g.fillRect(x + 14, y + 38, 52, 10); g.fillStyle = '#4cc43c'; g.fillRect(x + 12, y + 34, 56, 5); g.fillStyle = '#e0a050'; g.fillRect(x + 16, y + 50, 48, 9); }
      else if (kind === 1) { g.fillStyle = '#ff9ccf'; g.beginPath(); g.moveTo(x + 24, y + 22); g.lineTo(x + 56, y + 22); g.lineTo(x + 50, y + 70); g.lineTo(x + 30, y + 70); g.closePath(); g.fill(); g.fillStyle = '#c8203a'; g.beginPath(); g.arc(x + 40, y + 16, 7, 0, Math.PI * 2); g.fill(); }
      else { g.fillStyle = '#111'; g.beginPath(); g.arc(x + 40, y + 40, 30, 0, Math.PI * 2); g.fill(); g.fillStyle = '#c8203a'; g.beginPath(); g.arc(x + 40, y + 40, 10, 0, Math.PI * 2); g.fill(); }
    };
    for (let i = 0; i < 4; i++) art(470 + i * 480, 120, i % 3);
  });
}
function kitchenWallTex() {   // the kitchen wall (right side): white tile over bricks
  return canvasTex(2048, 512, (g, w, h) => {
    drawBricks(g, w, h);
    for (let y = 200; y < h; y += 30) for (let x = 0; x < w; x += 46) { g.fillStyle = '#f2f4f6'; g.fillRect(x + 1, y + 1, 44, 28); g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(x + 1, y + 24, 44, 5); }
    g.fillStyle = '#c8203a'; g.fillRect(0, 196, w, 8);
    // menu boards
    for (let i = 0; i < 3; i++) {
      const x = 220 + i * 640, y = 30;
      g.fillStyle = '#5a3a1a'; g.fillRect(x - 10, y - 10, 300, 150); g.fillStyle = '#1f2a24'; g.fillRect(x, y, 280, 130);
      g.fillStyle = '#f4f1e8'; g.font = '900 30px ' + UI_FONT; g.textAlign = 'center'; g.fillText(['TODAY’S SPECIALS', 'ORDER UP!', 'FRESH PIE'][i], x + 140, y + 38);
      g.font = '600 20px ' + UI_FONT; ['BURGER & FRIES', 'MALT SHAKE', 'CHERRY PIE'].forEach((t, k) => g.fillText(t, x + 140, y + 72 + k * 22));
    }
  });
}
function facadeTex() {   // the diner storefront at the far end of the table
  return canvasTex(2048, 640, (g, w, h) => {
    drawBricks(g, w, h, 80, 28);
    // big front windows glowing from inside
    for (let i = 0; i < 3; i++) {
      const x = 140 + i * 640, y = 230, ww = 480, wh = 300;
      const in1 = g.createLinearGradient(0, y, 0, y + wh); in1.addColorStop(0, '#ffe8b0'); in1.addColorStop(1, '#ffb070'); g.fillStyle = in1; g.fillRect(x, y, ww, wh);
      // counter, stools and customers seen through the glass
      g.fillStyle = '#c8203a'; g.fillRect(x, y + wh - 90, ww, 20); g.fillStyle = '#d7dbe6'; g.fillRect(x, y + wh - 70, ww, 70);
      for (let k = 0; k < 5; k++) { const sx = x + 50 + k * 95; g.fillStyle = '#c8203a'; g.beginPath(); g.ellipse(sx, y + wh - 100, 24, 10, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#8a8f9c'; g.fillRect(sx - 3, y + wh - 100, 6, 40);
        if (k % 2 === 0) { g.fillStyle = 'rgba(60,30,40,.55)'; g.beginPath(); g.arc(sx, y + wh - 165, 18, 0, Math.PI * 2); g.fill(); g.fillRect(sx - 20, y + wh - 148, 40, 46); } }
      g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(x + 40, y); g.lineTo(x + 140, y); g.lineTo(x + 60, y + wh); g.lineTo(x - 40 + 40, y + wh); g.closePath(); g.fill();
      g.strokeStyle = '#e6ebf5'; g.lineWidth = 14; g.strokeRect(x, y, ww, wh);
    }
    // stainless band and door
    g.fillStyle = '#c9ced6'; g.fillRect(0, 540, w, 100); for (let x = 0; x < w; x += 22) { g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x, 540, 4, 100); }
    g.fillStyle = '#c8203a'; g.fillRect(0, 200, w, 16);
  });
}
function vinylTex(color) {   // tufted vinyl for the booth seats
  return canvasTex(256, 256, (g) => {
    g.fillStyle = color; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) { const gr = g.createLinearGradient(i * 64, 0, i * 64 + 64, 0); gr.addColorStop(0, 'rgba(0,0,0,.25)'); gr.addColorStop(0.5, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(0,0,0,.25)'); g.fillStyle = gr; g.fillRect(i * 64, 0, 64, 256); }
  });
}
function registerTex() { const c = document.createElement('canvas'); c.width = 512; c.height = 128; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { c, t, last: -1 }; }
function drawRegister(reg, score) {
  if (reg.last === score) return; reg.last = score;
  const g = reg.c.getContext('2d');
  g.fillStyle = '#120404'; g.fillRect(0, 0, 512, 128);
  g.font = '900 78px "Courier New", monospace'; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,40,30,.15)'; g.fillText('88888888', 492, 68);
  g.shadowColor = '#ff3b2a'; g.shadowBlur = 18; g.fillStyle = '#ff5a3a'; g.fillText(String(score).slice(-8), 492, 68);
  reg.t.needsUpdate = true;
}

function buildDiorama(M, R) {
  const H0 = 3;   // height of the side ledges the scenery stands on
  const mk = (geo, mat, x, y, z, ry = 0, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m; };
  const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d), cylG = (r1, r2, h, s = 20) => new THREE.CylinderGeometry(r1, r2, h, s);
  const mat = (color, rough = 0.5, metal = 0, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra));
  const chrome = M.chrome, red = mat(0xc8203a, 0.35), cream = mat(0xf4ecd8, 0.6), black = mat(0x15151a, 0.5);
  const woodTop = new THREE.MeshStandardMaterial({ map: canvasTex(512, 512, (g) => { g.fillStyle = '#3a2416'; g.fillRect(0, 0, 512, 512); for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${90 + (i % 5) * 10},${55 + (i % 3) * 6},30,.35)`; g.fillRect(0, i * 9, 512, 3); } }), roughness: 0.7 });
  const zA = -53, zB = 8;   // ledges run from the far wall to just past the middle of the table
  // ---- cabinet: low sides near the player, tall scenery walls further up
  mk(boxG(2.4, 5, 64), M.cabinet, -25.8, 2.5, 24); mk(boxG(2.4, 5, 64), M.cabinet, 25.8, 2.5, 24);
  for (const sx of [-1, 1]) {
    mk(boxG(6.4, H0, zB - zA), woodTop, sx * 27.7, H0 / 2, (zA + zB) / 2);
    mk(boxG(6.6, 0.25, zB - zA), chrome, sx * 27.7, H0 + 0.12, (zA + zB) / 2, 0, false);
    const wallMat = new THREE.MeshStandardMaterial({ map: sx < 0 ? diningWallTex() : kitchenWallTex(), roughness: 0.75 });
    const wall = mk(new THREE.PlaneGeometry(zB - zA, 12), wallMat, sx * 30.9, H0 + 6, (zA + zB) / 2, sx < 0 ? Math.PI / 2 : -Math.PI / 2, false);
    wall.receiveShadow = true;
    mk(boxG(0.5, 0.5, zB - zA), chrome, sx * 30.7, H0 + 12, (zA + zB) / 2, 0, false);
  }
  // ---- storefront at the far end
  {
    const f = mk(new THREE.PlaneGeometry(62, 18), new THREE.MeshStandardMaterial({ map: facadeTex(), roughness: 0.7, emissive: 0xffffff, emissiveMap: null }), 0, 9, -53.4, 0, false);
    f.material.emissiveIntensity = 0;
    // striped awning across the front
    const aw = canvasTex(1024, 64, (g) => { for (let s = 0; s < 32; s++) { g.fillStyle = s % 2 ? '#f4f1e8' : '#c8203a'; g.fillRect(s * 32, 0, 32, 64); } });
    const awning = mk(new THREE.PlaneGeometry(62, 3.2), new THREE.MeshStandardMaterial({ map: aw, roughness: 0.6, side: THREE.DoubleSide }), 0, 12.2, -52, 0, true);
    awning.rotation.x = -0.6;
    // vertical "EAT" sign
    const eatTex = canvasTex(128, 512, (g) => { g.fillStyle = '#1a0a10'; g.fillRect(0, 0, 128, 512); g.strokeStyle = '#e6ebf5'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 504); g.font = '900 120px ' + UI_FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = '#ff3b4a'; g.shadowBlur = 24; g.fillStyle = '#ffd1d6'; ['E', 'A', 'T'].forEach((c, i) => g.fillText(c, 64, 96 + i * 160)); });
    const eatMat = new THREE.MeshBasicMaterial({ map: eatTex, toneMapped: false });
    const eat = mk(boxG(0.6, 9, 2.4), [black, black, black, black, black, eatMat], -27.5, 13.5, -51.6, Math.PI / 2, false);
    eat.rotation.y = -Math.PI / 2;
    R.eatMat = eatMat;
    // windows glow a little at night
    R.facade = f;
  }
  // ---- left ledge: dining room with booths, a jukebox and a waitress on skates
  const teal = new THREE.MeshStandardMaterial({ map: vinylTex('#2fb5a8'), roughness: 0.35 });
  const top = new THREE.MeshStandardMaterial({ color: 0xff6a7a, roughness: 0.25, metalness: 0.1 });
  const booth = (z) => {
    const x = -28.4;
    for (const dz of [-2.4, 2.4]) {
      mk(boxG(4.2, 1.0, 1.6), teal, x, H0 + 0.5, z + dz);
      mk(boxG(4.2, 2.6, 0.55), teal, x, H0 + 1.6, z + dz + Math.sign(dz) * 0.95);
      mk(boxG(4.4, 0.18, 0.75), chrome, x, H0 + 2.95, z + dz + Math.sign(dz) * 0.95, 0, false);
    }
    mk(cylG(0.18, 0.4, 1.5, 10), chrome, x, H0 + 0.75, z);
    mk(boxG(3.6, 0.2, 2.3), top, x, H0 + 1.55, z); mk(boxG(3.8, 0.12, 2.5), chrome, x, H0 + 1.42, z, 0, false);
    mk(cylG(0.18, 0.2, 0.75, 10), red, x + 0.9, H0 + 2.05, z - 0.4); mk(cylG(0.09, 0.12, 0.2, 8), red, x + 0.9, H0 + 2.5, z - 0.4);
    mk(boxG(0.6, 0.5, 0.3), chrome, x - 0.6, H0 + 1.9, z);
    mk(cylG(0.25, 0.22, 0.5, 12), cream, x + 0.2, H0 + 1.9, z + 0.6);
  };
  booth(-40); booth(-28);
  // jukebox
  {
    const g = new THREE.Group(); g.position.set(-28.2, H0, -12); g.rotation.y = Math.PI / 2; scene.add(g);
    const body = new THREE.Mesh(boxG(3.2, 3.6, 1.8), mat(0x6a2a1a, 0.4)); body.position.y = 1.8; body.castShadow = true; g.add(body);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.8, 24, 1, false, 0, Math.PI), mat(0x6a2a1a, 0.4)); arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2; arch.position.y = 3.6; g.add(arch);
    R.jukeBands = [];
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.25 - i * 0.28, 0.1, 8, 24, Math.PI), new THREE.MeshBasicMaterial({ color: 0xff8a3c, toneMapped: false }));
      band.position.set(0, 3.6, 0.92); g.add(band); R.jukeBands.push(band.material);
    }
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshStandardMaterial({ map: canvasTex(128, 96, (c) => { c.fillStyle = '#d7dbe6'; c.fillRect(0, 0, 128, 96); c.fillStyle = '#333'; for (let x = 6; x < 128; x += 10) c.fillRect(x, 6, 4, 84); }), metalness: 0.6, roughness: 0.3 }));
    grille.position.set(0, 1.4, 0.91); g.add(grille);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), new THREE.MeshBasicMaterial({ color: 0xffe0a0, toneMapped: false })); glass.position.set(0, 2.75, 0.91); g.add(glass); R.jukeGlass = glass.material;
  }
  // stools along the front of the ledge
  for (const z of [-4, 0, 4]) { mk(cylG(0.12, 0.3, 2, 8), chrome, -26.2, H0 + 1, z); mk(cylG(0.65, 0.65, 0.35, 16), red, -26.2, H0 + 2.1, z); }
  R.waitress = buildWaitress();
  // ---- right ledge: the kitchen
  {
    const x = 28.0;
    // stove
    mk(boxG(4.6, 3, 5.4), mat(0xd7dbe6, 0.3, 0.8), x, H0 + 1.5, -36);
    mk(boxG(4.8, 0.2, 5.6), black, x, H0 + 3.05, -36, 0, false);
    R.steam = [];
    for (const [dx, dz] of [[-1, -1.3], [1, -1.3], [-1, 1.3], [1, 1.3]]) {
      mk(new THREE.TorusGeometry(0.8, 0.08, 6, 16), black, x + dx, H0 + 3.2, -36 + dz).rotation.x = Math.PI / 2;
      if (dz < 0) { mk(cylG(0.85, 0.8, 1.2, 18), chrome, x + dx, H0 + 3.8, -36 + dz); mk(cylG(0.9, 0.9, 0.12, 18), chrome, x + dx, H0 + 4.45, -36 + dz, 0, false); }
      else { const pan = mk(cylG(1.0, 0.9, 0.35, 18), black, x + dx, H0 + 3.4, -36 + dz); mk(boxG(0.2, 0.12, 1.6), black, x + dx + 1.5 * Math.sign(dx), H0 + 3.45, -36 + dz, 0, false); }
    }
    for (let i = 0; i < 4; i++) { const knob = mk(cylG(0.22, 0.22, 0.2, 10), black, x - 2.35, H0 + 2.4, -37.8 + i * 1.2); knob.rotation.z = Math.PI / 2; }
    // prep counter
    mk(boxG(4.4, 3, 6), mat(0xd7dbe6, 0.3, 0.8), x, H0 + 1.5, -25);
    mk(boxG(2.6, 0.2, 3.4), woodTop, x - 0.2, H0 + 3.1, -25);
    for (let i = 0; i < 3; i++) mk(new THREE.SphereGeometry(0.42, 12, 10), mat(0xe8233c, 0.4), x + 1.4, H0 + 3.45, -27 + i * 0.95);
    mk(boxG(0.12, 0.08, 1.6), chrome, x - 0.6, H0 + 3.25, -24.2, 0.3, false);
    // order-up bell
    const bell = mk(new THREE.SphereGeometry(0.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.gate, x - 1.4, H0 + 3.2, -21.6); R.bell = bell;
    // shelves with jars, hanging pans
    for (const y of [7.5, 10]) {
      mk(boxG(1.4, 0.2, 18), woodTop, 30.1, H0 + y, -30, 0, true);
      for (let i = 0; i < 7; i++) mk(cylG(0.38, 0.38, 1.1, 12), mat([0xe8233c, 0xffc21a, 0x4cc43c, 0xf4ecd8][(i + y) % 4], 0.3), 29.9, H0 + y + 0.65, -38 + i * 2.6);
    }
    for (let i = 0; i < 4; i++) { const p = mk(cylG(1.0 - i * 0.12, 1.0 - i * 0.12, 0.15, 20), M.darkMetal, 30.4, H0 + 5.2, -17 + i * 2.7); p.rotation.z = Math.PI / 2; }
    // walk-in cooler door
    mk(boxG(0.3, 7, 4.5), mat(0xd7dbe6, 0.25, 0.9), 30.6, H0 + 3.5, -8);
    mk(boxG(0.4, 1.4, 0.3), chrome, 30.3, H0 + 3.6, -6.4, 0, false);
  }
  // ---- the counter along the front (apron) with condiments and a cash register
  {
    const lam = new THREE.MeshStandardMaterial({ map: canvasTex(512, 128, (g) => { g.fillStyle = '#c8203a'; g.fillRect(0, 0, 512, 128); for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`; g.fillRect(Math.random() * 512, Math.random() * 128, 6, 2); } }), roughness: 0.25 });
    const checker = new THREE.MeshStandardMaterial({ map: canvasTex(1024, 64, (g) => { for (let x = 0; x < 1024; x += 32) for (let y = 0; y < 64; y += 32) { g.fillStyle = ((x + y) / 32) % 2 ? '#111' : '#f4f1e8'; g.fillRect(x, y, 32, 32); } }), roughness: 0.5 });
    mk(boxG(54, 2.8, 8), [checker, checker, lam, black, checker, checker], 0, 1.4, 52.2);
    mk(boxG(54.4, 0.3, 0.5), chrome, 0, 2.85, 48.2, 0, false);
    // the counter's front, the diner floor and a row of stools, so tall phones see diner instead of black below the table
    mk(boxG(54, 16, 0.6), lam, 0, -6.6, 56.3, 0, false);
    mk(boxG(54.4, 0.35, 0.7), chrome, 0, 1.2, 56.5, 0, false);
    mk(boxG(54.4, 1.2, 0.7), chrome, 0, -13.8, 56.5, 0, false);
    const floorTex = canvasTex(512, 512, (g) => { for (let x = 0; x < 512; x += 64) for (let z = 0; z < 512; z += 64) { g.fillStyle = ((x + z) / 64) % 2 ? '#141018' : '#efe9dc'; g.fillRect(x, z, 64, 64); } });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(8, 6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -14.4, 90); floor.receiveShadow = true; scene.add(floor);
    for (const sx of [-18, -6, 6, 18]) {
      mk(cylG(0.5, 0.5, 9, 10), chrome, sx, -9.9, 61, 0, false);
      mk(cylG(2.8, 3, 0.4, 20), chrome, sx, -14.2, 61, 0, false);
      mk(cylG(2.6, 2.4, 1.3, 24), mat(0xc8203a, 0.3), sx, -4.8, 61);
      mk(new THREE.TorusGeometry(2.55, 0.2, 8, 28), chrome, sx, -4.2, 61, 0, false).rotation.x = Math.PI / 2;
    }
    const y = 2.8;
    const bottle = (x, z, color) => { mk(cylG(0.42, 0.48, 1.9, 14), mat(color, 0.25), x, y + 0.95, z); mk(cylG(0.12, 0.3, 0.6, 10), mat(color, 0.25), x, y + 2.15, z); mk(cylG(0.08, 0.08, 0.25, 6), mat(0xf4f1e8, 0.4), x, y + 2.55, z); };
    bottle(-19, 51.5, 0xd8202a); bottle(-17.6, 52.4, 0xffc21a);
    for (const [x, c] of [[-15, 0xf4f1e8], [-14.1, 0x333333]]) { mk(cylG(0.28, 0.32, 0.9, 12), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0, transparent: true, opacity: 0.55, roughness: 0.25 }), x, y + 0.45, 51.8); mk(cylG(0.3, 0.3, 0.2, 12), chrome, x, y + 1.0, 51.8); }
    mk(boxG(1.4, 1.2, 0.8), chrome, -11.5, y + 0.6, 52);
    mk(cylG(0.6, 0.5, 1.2, 16), cream, 10, y + 0.6, 51.6); const handle = mk(new THREE.TorusGeometry(0.35, 0.09, 6, 12), cream, 10.65, y + 0.65, 51.6); handle.rotation.y = 0;
    R.coffee = W3(0, 0); R.coffee.set(10, y + 1.3, 51.6);
    // cash register showing the score
    const reg = registerTex(); R.register = reg;
    const regBody = mat(0xb8bcc8, 0.3, 0.9);
    mk(boxG(6.2, 2.4, 4), regBody, 17.5, y + 1.2, 52.4);
    const screen = mk(boxG(5.4, 1.5, 0.6), [regBody, regBody, regBody, regBody, new THREE.MeshBasicMaterial({ map: reg.t, toneMapped: false }), regBody], 17.5, y + 3.1, 51.2, 0, false);
    screen.rotation.x = -0.35;
    for (let i = 0; i < 12; i++) mk(cylG(0.22, 0.22, 0.3, 10), mat([0xf4f1e8, 0xffc21a, 0xd8202a][i % 3], 0.4), 15.6 + (i % 4) * 1.2, y + 2.55, 53.2 + Math.floor(i / 4) * 0.7, 0, false);
  }
  // ---- warm bulbs along the rails and colored flasher domes
  R.bulbs = [];
  const bulbMat = () => new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
  R.bulbPools = []; const warmTex = radialTex('255,190,110');
  const bulbAt = (tx, ty, h = 2.2) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), bulbMat()); m.position.copy(W3(tx, ty, h)); scene.add(m); R.bulbs.push(m.material);
    const onRail = h > 3, px = onRail ? (tx < 240 ? tx + 22 : tx - 22) : tx;
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(onRail ? 7 : 5, onRail ? 7 : 5), new THREE.MeshBasicMaterial({ map: warmTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.14, toneMapped: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.copy(W3(px, ty, 0.022)); scene.add(pool); R.bulbPools.push(pool.material);
  };
  for (let y = 300; y <= 860; y += 70) { bulbAt(14, y, 4.2); bulbAt(475, y, 4.2); }
  for (const p of [[96, 735], [360, 735], [58, 715], [398, 715], [168, 52], [288, 52]]) bulbAt(p[0], p[1]);
  R.flashers = [];
  const flasher = (tx, ty, color, rgb) => {
    const g = new THREE.Group(); g.position.copy(W3(tx, ty)); scene.add(g);
    const post = new THREE.Mesh(cylG(0.18, 0.18, 3.6, 8), chrome); post.position.y = 1.8; g.add(post);
    const domeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat); dome.position.y = 3.6; g.add(dome);
    const base = new THREE.Mesh(cylG(0.8, 0.8, 0.25, 16), black); base.position.y = 3.55; g.add(base);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(rgb), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); spr.position.y = 4; spr.scale.set(14, 14, 1); g.add(spr);
    const f = { domeMat, spr, base: new THREE.Color(color), v: 0 }; R.flashers.push(f); return f;
  };
  R.flash = { red: flasher(132, 600, 0xff3b30, '255,70,60'), yellow: flasher(66, 360, 0xffc21a, '255,200,60'), blue: flasher(318, 596, 0x3ba0ff, '70,170,255') };
}
function buildWaitress() {
  // an original 1950s carhop on roller skates
  const g = new THREE.Group(); g.position.set(-25.6, 3, -20); g.rotation.y = Math.PI / 2.4; g.scale.setScalar(1.55); scene.add(g);
  const skin = new THREE.MeshStandardMaterial({ color: 0xf0c09a, roughness: 0.6 });
  const pink = new THREE.MeshStandardMaterial({ color: 0xff7ab8, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x5a2a12, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2440, roughness: 0.6 });
  const body = new THREE.Group(); g.add(body);
  for (const sx of [-0.3, 0.3]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 1.6, 10), skin); leg.position.set(sx, 0.95, 0); body.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.75), white); boot.position.set(sx, 0.25, 0.1); body.add(boot);
    for (const wz of [-0.22, 0.38]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.12, 10), pink); wh.rotation.z = Math.PI / 2; wh.position.set(sx, 0.06, wz); body.add(wh); }
  }
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.3, 20, 1, true), pink); skirt.position.y = 2.2; skirt.material.side = THREE.DoubleSide; body.add(skirt);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.9), white); apron.position.set(0, 2.1, 0.62); apron.rotation.x = -0.35; body.add(apron);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.7, 6, 12), pink); torso.position.y = 3.1; body.add(torso);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.08, 6, 16), white); collar.rotation.x = Math.PI / 2; collar.position.y = 3.75; body.add(collar);
  const headG = new THREE.Group(); headG.position.y = 4.3; body.add(headG);
  headG.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 14), skin));
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.54, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), hair); hairTop.position.y = 0.05; hairTop.rotation.x = -0.25; headG.add(hairTop);
  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.6, 4, 8), hair); tail.position.set(0, 0.1, -0.55); tail.rotation.x = 0.7; headG.add(tail);
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.06, 6, 12), pink); bow.position.set(0, 0.45, -0.35); headG.add(bow);
  for (const sx of [-0.18, 0.18]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), dark); eye.position.set(sx, 0.05, 0.46); headG.add(eye); }
  const lips = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0xd8202a })); lips.position.set(0, -0.2, 0.47); lips.rotation.z = Math.PI; headG.add(lips);
  const mkArm = (sx) => { const sh = new THREE.Group(); sh.position.set(sx * 0.6, 3.45, 0); body.add(sh); const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.9, 4, 8), skin); a.position.y = -0.55; sh.add(a); return sh; };
  const armL = mkArm(-1), armR = mkArm(1);
  // tray with a milkshake in the raised right hand
  const tray = new THREE.Group(); tray.position.y = -1.15; armR.add(tray);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 18), new THREE.MeshStandardMaterial({ color: 0xd7dbe6, metalness: 0.9, roughness: 0.25 })); tray.add(plate);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.12, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0xff9ccf, roughness: 0.3 })); glass.position.y = 0.33; tray.add(glass);
  const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd8202a })); cherry.position.y = 0.7; tray.add(cherry);
  return { g, body, headG, armL, armR, tray, x0: -25.6, z: -20, dir: 1 };
}
function animateDiorama(R, dt, t) {
  // jukebox color cycle
  if (R.jukeBands) R.jukeBands.forEach((m, i) => m.color.setHSL(((t * 0.15) + i * 0.12) % 1, 0.9, 0.55).multiplyScalar(1.4));
  if (R.jukeGlass) R.jukeGlass.color.setRGB(1, 0.85 + 0.1 * Math.sin(t * 3), 0.6);
  // the EAT sign flickers now and then
  if (R.eatMat) R.eatMat.color.setScalar(Math.sin(t * 13) > -0.96 ? 1.2 : 0.4);
  // waitress skates up and down the aisle, and cheers with the chef
  const w = R.waitress; if (w) {
    const mood = G.state === 'title' ? 'skate' : G.chef.mood;
    w.z += w.dir * dt * (mood === 'cheer' ? 4 : 1.6);
    if (w.z > -6) w.dir = -1; if (w.z < -34) w.dir = 1;
    w.g.position.z = w.z; w.g.rotation.y = w.dir > 0 ? 0 : Math.PI;
    w.body.position.y = Math.abs(Math.sin(t * 4)) * 0.08 + (mood === 'cheer' ? Math.abs(Math.sin(t * 8)) * 0.6 : 0);
    w.body.rotation.z = Math.sin(t * 2) * 0.06;
    w.armR.rotation.z = mood === 'cheer' ? -2.6 : -2.4 + Math.sin(t * 2) * 0.1;
    w.armR.rotation.x = 0.2;
    w.tray.rotation.z = -w.armR.rotation.z;
    w.armL.rotation.z = mood === 'cheer' ? 2.6 + Math.sin(t * 12) * 0.3 : 0.2 + Math.sin(t * 4) * 0.25;
    w.headG.rotation.y = Math.sin(t * 0.9) * 0.4;
  }
  // order-up bell bounces on big moments
  if (R.bell) { const k = G.chef.mood === 'cheer' ? Math.abs(Math.sin(t * 18)) * 0.25 : 0; R.bell.position.y = 3 + 3.2 + k; }
  // warm bulbs: gentle flicker, chase during multiball
  if (R.bulbs) R.bulbs.forEach((m, i) => { let k = 0.9 + 0.1 * Math.sin(t * 7 + i * 1.7); if (G.multiball || G.state === 'title') k = (Math.floor(t * 8) + i) % 4 === 0 ? 1.8 : 0.6; m.color.setRGB(1, 0.85, 0.62).multiplyScalar(k); if (R.bulbPools && R.bulbPools[i]) R.bulbPools[i].opacity = 0.13 * k; });
  // flashers
  if (R.flashers) R.flashers.forEach(f => { f.v = Math.max(0, f.v - dt * 3); f.domeMat.color.copy(f.base).multiplyScalar(0.35 + f.v * 2.2); f.spr.material.opacity = f.v * 0.9; });
  if (R.register) drawRegister(R.register, G.score);
}
function fireFlashers(which = ['red', 'yellow', 'blue'], v = 1) { if (!R3 || !R3.flash) return; which.forEach(k => { if (R3.flash[k]) R3.flash[k].v = Math.max(R3.flash[k].v, v); }); }

function buildScene() {
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0608);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;
  camera = new THREE.PerspectiveCamera(36, 0.55, 1, 400);

  scene.add(new THREE.HemisphereLight(0xffe6cc, 0x2a1a14, 0.4));
  const key = new THREE.DirectionalLight(0xfff0dc, 1.5);
  key.position.set(-16, 58, 30); key.target.position.set(0, 0, -4);
  key.castShadow = true; key.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048); key.shadow.radius = 3;
  Object.assign(key.shadow.camera, { left: -34, right: 34, top: 60, bottom: -60, near: 10, far: 160 });
  key.shadow.bias = -0.0008; key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const pinkL = new THREE.PointLight(0xffb070, 26, 90, 2); pinkL.position.set(-6, 40, -14); scene.add(pinkL);
  const cyanL = new THREE.PointLight(0x9fe3ff, 18, 90, 2); cyanL.position.set(8, 40, 10); scene.add(cyanL);

  const M = {
    chrome: new THREE.MeshStandardMaterial({ color: 0xc9ceda, metalness: 1, roughness: 0.22 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x3a3f4c, metalness: 0.9, roughness: 0.35 }),
    outer: new THREE.MeshStandardMaterial({ color: 0xf4ecd8, metalness: 0, roughness: 0.6 }),
    cabinet: new THREE.MeshStandardMaterial({ color: 0x8a1a2a, metalness: 0.2, roughness: 0.45 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0xc8203a, roughness: 0.45, metalness: 0, transparent: true, opacity: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0xf6f4f2, roughness: 0.75 }),
    redRubber: new THREE.MeshStandardMaterial({ color: 0xe2337f, roughness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }),
    blackRubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.85 }),
    gate: new THREE.MeshStandardMaterial({ color: 0xe7c35a, metalness: 1, roughness: 0.25 }),
  };
  const R = { M, inserts: [], sprites: {}, balls: [], ballShadows: [], poolTex: radialTex('255,255,255') };
  const box = (w, h, d, mat, x, y, z, ry = 0, shadow = true) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m; };
  const cyl = (rt, rb, h, mat, seg = 24) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.castShadow = true; m.receiveShadow = true; return m; };

  // playfield
  const K = 1024 / TW;
  const pfTex = canvasTex(1024, 2048, (g) => { drawPlayfieldArt(g, K); drawDinerPrints(g, K); weatherPlayfield(g, 1024, 2048); });
  const pf = new THREE.Mesh(new THREE.PlaneGeometry(TW * S, TH * S), new THREE.MeshPhysicalMaterial({ map: pfTex, roughnessMap: pfRoughTex(), roughness: 1, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.32 }));
  pf.rotation.x = -Math.PI / 2; pf.receiveShadow = true; scene.add(pf);
  // the diner world around the table
  buildDiorama(M, R);
  // walls built from the physics segments
  for (const s of SEGS) {
    if (s.look === 'none' || s.kind === 'target' || s.kind === 'sling') continue;
    const a = W3(s.ax, s.ay), b = W3(s.bx, s.by), len = a.distanceTo(b);
    if (len < 0.01) continue;
    const ry = -Math.atan2(b.z - a.z, b.x - a.x), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (s.look === 'outer') { const oh = s.h * 1.25; box(len + 0.6, oh, 1.2, M.outer, mx, oh / 2, mz, ry); box(len + 0.6, 0.35, 1.4, M.chrome, mx, oh + 0.17, mz, ry, false); }
    else if (s.look === 'plastic') { box(len, s.h, (s.rad * 2 + 2) * S, M.plastic, mx, s.h / 2, mz, ry); box(len, 0.25, (s.rad * 2 + 3) * S, M.chrome, mx, s.h + 0.12, mz, ry, false); }
    else if (s.look === 'gate') { box(len, 0.25, 0.25, M.gate, mx, s.h, mz, ry, false); }
    else { box(len, s.h, (s.rad * 2 + 4) * S, M.chrome, mx, s.h / 2, mz, ry); }
  }
  // posts and rubber rings
  for (const c of CIRCS.filter(c => c.kind === 'post')) {
    const p = cyl(0.45, 0.45, 2.2, M.chrome); p.position.copy(W3(c.x, c.y, 1.1)); scene.add(p);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.2, 10, 24), M.rubber); ring.rotation.x = Math.PI / 2; ring.position.copy(W3(c.x, c.y, 0.9)); scene.add(ring);
  }
  // slingshots: translucent plastic + rubber band
  R.slings = SLINGS.map((p, i) => {
    const shape = new THREE.Shape(); p.forEach(([x, y], k) => { const v = W3(x, y); k ? shape.lineTo(v.x, -v.z) : shape.moveTo(v.x, -v.z); }); shape.closePath();
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x7cc8ff, emissive: 0x2a7cff, emissiveIntensity: 0.15, roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.3, transparent: true, opacity: 0.72 });
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: true, bevelSize: 0.15, bevelThickness: 0.15, bevelSegments: 2 }), mat);
    m.rotation.x = -Math.PI / 2; m.castShadow = true; scene.add(m);
    const pts = [...p, p[0]].map(([x, y]) => W3(x, y, 0.9));
    const band = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.05), 64, 0.22, 8, true), M.rubber);
    scene.add(band);
    p.forEach(([x, y]) => { const post = cyl(0.3, 0.3, 2.2, M.chrome, 12); post.position.copy(W3(x, y, 1.1)); scene.add(post); });
    return mat;
  });
  // pop bumpers ("pots")
  R.bumpers = CIRCS.filter(c => c.kind === 'bumper').map(c => {
    const g = new THREE.Group(); g.position.copy(W3(c.x, c.y));
    const base = cyl(2.25, 2.35, 0.5, M.darkMetal); base.position.y = 0.25; g.add(base);
    const body = cyl(1.75, 1.85, 1.5, new THREE.MeshPhysicalMaterial({ color: 0xffd6ea, emissive: 0xff4f9a, emissiveIntensity: 0.18, roughness: 0.25, clearcoat: 0.5, clearcoatRoughness: 0.3, transparent: true, opacity: 0.8 })); body.position.y = 1.2; g.add(body);
    const skirt = cyl(2.55, 2.6, 0.12, M.chrome, 32); skirt.position.y = 0.62; g.add(skirt);
    const rubberBase = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.22, 10, 32), M.blackRubber); rubberBase.rotation.x = Math.PI / 2; rubberBase.position.y = 0.55; g.add(rubberBase);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xff6fb5, emissive: 0xff2f8a, emissiveIntensity: 0.6, roughness: 0.3 });
    const cap = cyl(2.15, 2.05, 0.6, capMat); cap.position.y = 2.2; g.add(cap);
    const decal = new THREE.Mesh(new THREE.CircleGeometry(1.95, 40), new THREE.MeshStandardMaterial({ map: bumperCapTex(), transparent: true, roughness: 0.3, emissive: 0xffffff, emissiveMap: bumperCapTex(), emissiveIntensity: 0.25 })); decal.rotation.x = -Math.PI / 2; decal.position.y = 2.51; g.add(decal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.16, 10, 32), M.chrome); ring.rotation.x = Math.PI / 2; ring.position.y = 1.0; g.add(ring);
    for (const sx of [-1, 1]) { const handle = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.4), M.darkMetal); handle.position.set(sx * 2.4, 1.9, 0); g.add(handle); }
    scene.add(g);
    return { g, capMat, ring };
  });
  // grill toy with a burger on top
  {
    const g = new THREE.Group(); g.position.copy(W3(112, 322));
    const base = cyl(2.35, 2.45, 0.7, M.darkMetal, 32); base.position.y = 0.35; g.add(base);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xff5a1a, toneMapped: false });
    const fire = cyl(2.0, 2.0, 0.1, fireMat, 32); fire.position.y = 0.75; g.add(fire);
    const spin = new THREE.Group(); spin.position.y = 0.8; g.add(spin);
    const grate = new THREE.Group(); spin.add(grate);
    for (let i = -3; i <= 3; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, Math.sqrt(4.2 - (i * 0.58) ** 2) * 1.0 * 2 || 0.1), M.chrome); bar.position.set(i * 0.58, 0.05, 0); grate.add(bar); }
    const bun = new THREE.MeshStandardMaterial({ color: 0xe0a050, roughness: 0.55 });
    const b1 = cyl(1.3, 1.25, 0.4, bun, 28); b1.position.y = 0.35; spin.add(b1);
    const patty = cyl(1.42, 1.42, 0.38, new THREE.MeshStandardMaterial({ color: 0x5a2c14, roughness: 0.8 }), 28); patty.position.y = 0.72; spin.add(patty);
    const cheese = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 2.3), new THREE.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.5 })); cheese.position.y = 0.95; cheese.rotation.y = 0.4; spin.add(cheese);
    const lettuce = cyl(1.5, 1.5, 0.1, new THREE.MeshStandardMaterial({ color: 0x4cc43c, roughness: 0.6 }), 12); lettuce.position.y = 1.03; spin.add(lettuce);
    const top = new THREE.Mesh(new THREE.SphereGeometry(1.3, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), bun); top.scale.y = 0.75; top.position.y = 1.08; top.castShadow = true; spin.add(top);
    for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 0.3 + (i % 3) * 0.3; const seed = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), M.white); seed.position.set(Math.cos(a) * r, 1.08 + 0.95 * Math.sqrt(Math.max(0, 1 - (r / 1.3) ** 2)) * 0.98, Math.sin(a) * r); seed.scale.set(1, 0.5, 1.6); spin.add(seed); }
    scene.add(g);
    R.grill = { g, spin, fireMat };
  }
  // C-H-E-F drop targets
  R.targets = TARGET_X.map(([a, b], i) => {
    const tex = canvasTex(128, 128, (g) => { const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#ffb3d8'); gr.addColorStop(1, '#b0175f'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.fillStyle = '#fff'; g.font = `900 88px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('CHEF'[i], 64, 70); });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, emissive: 0xff2f8a, emissiveIntensity: 0 });
    const m = new THREE.Mesh(new THREE.BoxGeometry((b - a) * S, 1.9, 0.5), [M.darkMetal, M.darkMetal, M.darkMetal, M.darkMetal, mat, mat]);
    m.position.copy(W3((a + b) / 2, 480, 0.95)); m.castShadow = true; scene.add(m);
    return { m, mat };
  });
  // spinner in the left orbit
  {
    const g = new THREE.Group(); g.position.copy(W3(40, 500, 1.4));
    for (const sx of [-1, 1]) { const post = cyl(0.12, 0.12, 2.8, M.chrome, 8); post.position.set(sx * 1.9, 0, 0); g.add(post); }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.3, 0.1), new THREE.MeshStandardMaterial({ color: 0xffd84a, metalness: 0.8, roughness: 0.3, emissive: 0x553300 }));
    plate.position.y = -0.4; plate.geometry.translate(0, -0.25, 0);
    const pivot = new THREE.Group(); pivot.position.y = 0.6; pivot.add(plate); g.add(pivot);
    scene.add(g); R.spinner = pivot;
  }
  // scoop ("Order Window"): a dark hole with a glowing ring
  {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.25, 32), new THREE.MeshBasicMaterial({ color: 0x000000 })); hole.rotation.x = -Math.PI / 2; hole.position.copy(W3(SCOOP.x, SCOOP.y, 0.02)); scene.add(hole);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd84a, toneMapped: false, transparent: true });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.65, 32), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.copy(W3(SCOOP.x, SCOOP.y, 0.03)); scene.add(ring);
    R.scoopRing = ringMat;
  }
  // flippers
  R.flippers = FLIPPERS.map(f => {
    const shape = new THREE.Shape();
    const L = f.len * S, r0 = f.r0 * S, r1 = f.r1 * S;
    shape.absarc(0, 0, r0, Math.PI / 2, Math.PI * 1.5, false);
    shape.lineTo(L, -r1); shape.absarc(L, 0, r1, -Math.PI / 2, Math.PI / 2, false); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 });
    geo.rotateX(-Math.PI / 2);
    const body = new THREE.Mesh(geo, M.white); body.castShadow = true;
    const rub = new THREE.Mesh(geo, M.redRubber); rub.scale.set(1.04, 0.35, 1.18); rub.position.y = 0.55;
    const g = new THREE.Group(); g.add(body, rub); g.position.copy(W3(f.x, f.y, 0.05));
    const cap = cyl(0.35, 0.35, 0.3, M.chrome, 12); cap.position.y = 1.75; g.add(cap);
    scene.add(g); return g;
  });
  // ramps
  R.rampL = buildCounterRamp(RAMP_L, 'boomerang', 0xff4f8a);
  buildCounterRamp(makePath(FRIDGE_PTS.map(p => p)), 'boomerang', 0x4fe0ff, true);
  R.rampR = buildCounterRamp(RAMP_R, 'sparkle', 0x4fe0ff);
  rampSign(168, 612, 'SAUCE', 'RAMP', '#ff6f9a');
  rampSign(284, 612, 'SHAKES', 'RAMP', '#6fe4ff');
  buildPlastics();
  buildCornerToys(R);
  // toys: fridge (ball lock) and chef
  R.fridge = buildFridge();
  R.chef = buildChef();
  // neon sign standing behind the table
  {
    const tex = canvasTex(1024, 256, (g) => {
      g.clearRect(0, 0, 1024, 256);
      g.font = `900 120px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = '#ff4fa8'; g.shadowBlur = 30; g.fillStyle = '#ffd1ea'; g.fillText('FLIPSIDE', 512, 100);
      g.font = `900 64px ${UI_FONT}`; g.shadowColor = '#4fd0ff'; g.fillStyle = '#d8f6ff'; g.fillText('D I N E R', 512, 200);
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(30, 7.5), mat); sign.position.set(0, 16.5, -53); scene.add(sign);
    R.signMat = mat;
  }
  // inserts (lights in the playfield)
  const ins = (x, y, size, shape, label, color, rot = 0) => {
    const mat = new THREE.MeshBasicMaterial({ map: insertTex(label, shape), color, transparent: true, toneMapped: false, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size * S, size * S), mat); m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.copy(W3(x, y, 0.03 + R.inserts.length * 0.0005));
    scene.add(m); const it = { m, mat, base: new THREE.Color(color), lit: 0 }; R.inserts.push(it);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(size * S * 2.6, size * S * 2.6), new THREE.MeshBasicMaterial({ map: R.poolTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, toneMapped: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.copy(m.position); pool.position.y = 0.025; scene.add(pool); it.pool = pool.material;
    return it;
  };
  R.ins = {
    hot: LANES.map(([a, b], i) => ins((a + b) / 2, 120, 22, 'circle', 'HOT'[i], 0xff8a3c)),
    bonus: [2, 3, 4, 5, 6].map((n, i) => ins(178 + i * 25, 724, 22, 'pill', n + 'X', 0xffd84a)),
    rampL: ins(168, 676, 26, 'arrow', '', 0xff5a6a), rampR: ins(284, 676, 26, 'arrow', '', 0x7dd8ff),
    orbitL: ins(40, 650, 24, 'arrow', '', 0x7dd8ff), orbitR: ins(416, 650, 24, 'arrow', '', 0x7dd8ff),
    scoop: ins(98, 452, 24, 'arrow', '', 0xffd84a, 0.35),
    kick: ins(39, 852, 20, 'circle', 'K', 0x7dffd2), save: ins(228, 930, 22, 'circle', '♥', 0x7dffd2),
    chef: TARGET_X.map(([a, b], i) => ins((a + b) / 2, 504, 16, 'circle', '', 0xff6fb5)),
    chev: [],
    modes: MODES.map((m, i) => ins(174 + i * 34, 600, 22, 'circle', ['\u{1F354}', '\u{1F964}', '\u{1F336}', '\u{1F967}'][i] ? ['B', 'S', 'H', 'P'][i] : '', new THREE.Color(m.color).getHex())),
  };
  // stacked chevrons that chase toward each lit shot
  for (const [key, x, y] of [['rampL', 168, 676], ['rampR', 284, 676], ['orbitL', 40, 650], ['orbitR', 416, 650]]) {
    const main = R.ins[key];
    for (let k = 1; k <= 2; k++) { const c = ins(x, y + k * 17, 18 - k * 2, 'arrow', '', main.base.getHex()); c.main = main; c.k = k; R.ins.chev.push(c); }
  }
  // glow sprites (flashers)
  const spr = (rgb, x, y, h, size) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(rgb), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); m.position.copy(W3(x, y, h)); m.scale.set(size, size, 1); scene.add(m); return m; };
  R.sprites.bumpers = CIRCS.filter(c => c.kind === 'bumper').map(c => spr('255,200,90', c.x, c.y, 3, 9));
  R.sprites.slings = SLINGS.map(p => spr('90,190,255', (p[0][0] + p[2][0]) / 2, (p[0][1] + p[2][1]) / 2, 1.5, 9));
  R.sprites.grill = spr('255,120,40', 112, 322, 2, 10);
  R.sprites.scoop = spr('255,216,74', SCOOP.x, SCOOP.y, 1, 8);
  R.sprites.rampL = spr('255,90,140', 168, 640, 2, 10);
  R.sprites.rampR = spr('90,200,255', 284, 640, 2, 10);
  R.sprites.fridge = spr('180,240,255', 42, 62, 6, 14);
  R.sprites.kick = spr('125,255,210', 39, 900, 1, 9);
  // balls
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, envMapIntensity: 1.6 });
  R.cubeRT = new THREE.WebGLCubeRenderTarget(IS_TOUCH ? 96 : 192, { type: THREE.HalfFloatType });
  R.cubeCam = new THREE.CubeCamera(0.5, 300, R.cubeRT); R.cubeCam.position.set(0, 2.5, 10); scene.add(R.cubeCam);
  ballMat.envMap = R.cubeRT.texture; R.ballMat = ballMat; R.cubeT = 0;
  // make the ball easy to follow: a soft light halo under it and a short glowing trail when it moves fast
  const haloTex = radialTex('200,235,255'), trailTex = radialTex('255,244,220');
  R.ballHalos = []; R.ballTrails = [];
  for (let i = 0; i < 6; i++) {
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), new THREE.MeshBasicMaterial({ map: haloTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.5, toneMapped: false }));
    halo.rotation.x = -Math.PI / 2; halo.visible = false; halo.renderOrder = 4; scene.add(halo); R.ballHalos.push(halo);
    const trail = []; for (let k = 0; k < 9; k++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: trailTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, toneMapped: false })); sp.scale.setScalar(1.7 - k * 0.12); scene.add(sp); trail.push(sp); }
    R.ballTrails.push({ sprites: trail, hist: [] });
  }
  // overhead cabinet lights: only the ball's reflection sees them (layer 1), giving it the bright steel glint of a real ball
  R.cubeCam.children.forEach(c => c.layers.enable(1));
  for (const [x, z, w] of [[-9, -5, 4], [9, -5, 4], [0, 26, 30]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, w === 30 ? 3 : 60), new THREE.MeshBasicMaterial({ color: 0xfff1dc, toneMapped: false }));
    panel.rotation.x = Math.PI / 2; panel.position.set(x, 55, z); panel.layers.set(1); scene.add(panel);
  }
  const shadowTex = radialTex('0,0,0');
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * S, 32, 20), ballMat); m.castShadow = true; m.visible = false; scene.add(m); R.balls.push(m);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.45, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.visible = false; scene.add(sh); R.ballShadows.push(sh);
  }
  // plunger
  { const p = cyl(0.55, 0.55, 3, M.chrome, 16); p.rotation.x = Math.PI / 2; p.position.copy(W3(453, 970, 0.8)); scene.add(p); R.plunger = p; }

  addContactShadows(R);
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(480, 900, { type: THREE.HalfFloatType, samples: IS_TOUCH ? 2 : 4 }));
  composer.addPass(new RenderPass(scene, camera));
  // Phone graphics chips can produce a few overflowing pixels on shiny highlights; the glow pass would then
  // spread them into a white haze. Cap the brightness and drop broken pixels before the glow.
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'precision highp float; uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); bvec3 bad = bvec3(!(c.r >= 0.0 && c.r < 60000.0), !(c.g >= 0.0 && c.g < 60000.0), !(c.b >= 0.0 && c.b < 60000.0)); if (any(bad)) c.rgb = vec3(0.0); c.rgb = min(c.rgb, vec3(3.0)); c.a = clamp(c.a, 0.0, 1.0); gl_FragColor = c; }'
  }));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 512), IS_TOUCH ? 0.34 : 0.42, 0.35, IS_TOUCH ? 1.0 : 0.95);
  composer.addPass(bloom);
  if (IS_IOS) bloom.enabled = false;   // iPhone graphics turned the glow into a white haze over the left side
  composer.addPass(new OutputPass());
  // soft vignette and a touch of contrast, like a camera looking at a real table
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - vec2(0.5, 0.52); float v = smoothstep(0.85, 0.32, length(d * vec2(1.25, 1.0))); c.rgb = mix(c.rgb * 0.62, c.rgb, v); c.rgb = clamp((c.rgb - 0.5) * 1.06 + 0.5, 0.0, 1.0); gl_FragColor = c; }'
  }));
  R3 = R;
}
function rampFrame(path, i) {
  const P = path.pts, a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
  const t = new THREE.Vector3((b[0] - a[0]) * S, b[2] - a[2], (b[1] - a[1]) * S).normalize();
  const side = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0, 1, 0)).normalize();
  return { p: W3(P[i][0], P[i][1], P[i][2]), side };
}
function buildPlasticRamp(path, color, short = false) {
  const n = path.pts.length, hw = 1.35, wall = 1.1, pos = [], idx = [];
  const add = (v) => { pos.push(v.x, v.y, v.z); return pos.length / 3 - 1; };
  let prev = null;
  for (let i = 0; i < n; i++) {
    const { p, side } = rampFrame(path, i);
    const L0 = p.clone().addScaledVector(side, -hw), R0 = p.clone().addScaledVector(side, hw);
    const L1 = L0.clone(); L1.y += wall; const R1 = R0.clone(); R1.y += wall;
    const ids = [add(L1), add(L0), add(R0), add(R1)];
    if (prev) for (let k = 0; k < 3; k++) { const a = prev[k], b = prev[k + 1], c = ids[k], d = ids[k + 1]; idx.push(a, c, b, b, c, d); }
    prev = ids;
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), roughness: 0.22, clearcoat: 0.5, clearcoatRoughness: 0.35, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false, emissive: color, emissiveIntensity: 0.05 });
  const m = new THREE.Mesh(geo, mat); m.renderOrder = 2; scene.add(m);
  // chrome lips and posts
  for (const sgn of [-1, 1]) {
    const pts = []; for (let i = 0; i < n; i += 2) { const { p, side } = rampFrame(path, i); const q = p.clone().addScaledVector(side, sgn * hw); q.y += wall; pts.push(q); }
    if (pts.length > 2) scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, 0.1, 6), R3 ? R3.M.chrome : new THREE.MeshStandardMaterial({ color: 0xe6ebf5, metalness: 1, roughness: 0.16 })));
  }
  if (!short) for (let i = 12; i < n - 6; i += 18) { const { p } = rampFrame(path, i); if (p.y < 1) continue; const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, p.y, 8), new THREE.MeshStandardMaterial({ color: 0xc0c6d4, metalness: 1, roughness: 0.3 })); post.position.set(p.x, p.y / 2, p.z); scene.add(post); }
  return mat;
}
function buildWireRamp(path) {
  const n = path.pts.length, chrome = new THREE.MeshStandardMaterial({ color: 0xe6ebf5, metalness: 1, roughness: 0.14 });
  const offs = [[-0.55, -0.35], [0.55, -0.35], [-1.05, 0.45], [1.05, 0.45]];
  for (const [o, dy] of offs) {
    const pts = []; for (let i = 0; i < n; i += 2) { const { p, side } = rampFrame(path, i); const q = p.clone().addScaledVector(side, o); q.y += dy + 0.4; pts.push(q); }
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, 0.12, 8), chrome));
  }
  for (let i = 10; i < n - 6; i += 14) { const { p, side } = rampFrame(path, i); if (p.y < 1.2) continue; for (const o of [-1, 1]) { const q = p.clone().addScaledVector(side, o * 1.05); const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, q.y + 0.4, 6), chrome); post.position.set(q.x, (q.y + 0.4) / 2, q.z); scene.add(post); } }
  return chrome;
}
function buildFridge() {
  const g = new THREE.Group(); g.position.copy(W3(42, 50)); g.rotation.y = 0.5;
  const body = new THREE.MeshStandardMaterial({ color: 0x9be8d8, roughness: 0.35, metalness: 0.1 });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(5.2, 9, 4.2), body); shell.position.y = 4.5; shell.castShadow = true; g.add(shell);
  const inside = new THREE.Mesh(new THREE.BoxGeometry(4.4, 7.6, 0.2), new THREE.MeshBasicMaterial({ color: 0xbff4ff, toneMapped: false })); inside.position.set(0, 4.6, 2.05); g.add(inside);
  const hinge = new THREE.Group(); hinge.position.set(-2.6, 4.5, 2.15); g.add(hinge);
  const door = new THREE.Mesh(new THREE.BoxGeometry(5.2, 8.6, 0.45), body); door.position.set(2.6, 0, 0.2); door.castShadow = true; hinge.add(door);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), new THREE.MeshStandardMaterial({ color: 0xe6ebf5, metalness: 1, roughness: 0.2 })); handle.position.set(4.6, 0.6, 0.55); hinge.add(handle);
  const lampMats = [0, 1].map(() => new THREE.MeshBasicMaterial({ color: 0x224433, toneMapped: false }));
  lampMats.forEach((m, i) => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), m); l.position.set(-1.1 + i * 2.2, 9.3, 0.8); g.add(l); });
  const logoTex = canvasTex(256, 64, (c) => { c.fillStyle = '#ff6fb5'; c.font = `900 40px ${UI_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('FRIDGE', 128, 34); });
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true })); logo.position.set(2.6, 2.6, 0.24); hinge.add(logo);
  scene.add(g);
  return { g, hinge, lampMats };
}
function buildChef() {
  const g = new THREE.Group(); g.position.copy(W3(436, 48)); g.rotation.y = -0.55; g.scale.setScalar(1.15);
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c29b, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2440, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd93a2b, roughness: 0.5 });
  const brown = new THREE.MeshStandardMaterial({ color: 0x5a3218, roughness: 0.7 });
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.6, 28), new THREE.MeshStandardMaterial({ color: 0x2a0f2e, roughness: 0.4, metalness: 0.4 })); plat.position.y = 0.3; g.add(plat);
  const body = new THREE.Group(); body.position.y = 0.6; g.add(body);
  for (const sx of [-0.55, 0.55]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.38, 2.2, 12), dark); leg.position.set(sx, 1.1, 0); leg.castShadow = true; body.add(leg); const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 1.2), dark); shoe.position.set(sx, 0.2, 0.25); body.add(shoe); }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(1.35, 1.6, 6, 16), white); torso.position.y = 3.4; torso.castShadow = true; body.add(torso);
  for (let i = 0; i < 4; i++) { const btn = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0x9a9a9a })); btn.position.set(i % 2 ? 0.35 : -0.35, 3.8 - Math.floor(i / 2) * 0.7, 1.3); body.add(btn); }
  const scarf = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.8, 3), red); scarf.rotation.x = Math.PI; scarf.position.set(0, 4.5, 1.05); body.add(scarf);
  const headG = new THREE.Group(); headG.position.y = 5.6; body.add(headG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.15, 24, 16), skin); head.castShadow = true; headG.add(head);
  for (const sx of [-0.4, 0.4]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), dark); eye.position.set(sx, 0.2, 1.05); headG.add(eye); }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skin); nose.position.set(0, -0.05, 1.15); headG.add(nose);
  for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.45, 4, 8), brown); m.rotation.z = sx * 1.25; m.position.set(sx * 0.32, -0.32, 1.05); headG.add(m); }
  const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.8, 20), white); hatBand.position.y = 1.15; headG.add(hatBand);
  for (const [x, y, r] of [[-0.45, 1.8, 0.62], [0.45, 1.8, 0.62], [0, 2.1, 0.72]]) { const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), white); puff.position.set(x, y, 0); puff.castShadow = true; headG.add(puff); }
  const mkArm = (sx) => {
    const sh = new THREE.Group(); sh.position.set(sx * 1.45, 4.3, 0); body.add(sh);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.5, 4, 10), white); arm.position.y = -1.0; sh.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), skin); hand.position.y = -2.0; sh.add(hand);
    return sh;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  const spat = new THREE.Group(); spat.position.y = -2.0; armR.add(spat);
  const handleS = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 6), brown); handleS.position.set(0, -0.2, 0.7); handleS.rotation.x = Math.PI / 2; spat.add(handleS);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 1.0), new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 1, roughness: 0.25 })); blade.position.set(0, -0.2, 1.8); spat.add(blade);
  const patty = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 16), brown); patty.position.set(0, -0.05, 1.8); spat.add(patty);
  scene.add(g);
  return { g, body, headG, armL, armR, patty };
}

let camFollow = lsGet(GAME_ID + '.camFollow', '1') !== '0';
function toggleCamera() { camFollow = !camFollow; lsSet(GAME_ID + '.camFollow', camFollow ? '1' : '0'); callout(camFollow ? 'FOLLOW CAMERA' : 'FIXED CAMERA', '#9fe3ff'); }
const _camP = new THREE.Vector3(), _camL = new THREE.Vector3(), _camP2 = new THREE.Vector3(), _camL2 = new THREE.Vector3();
function updateCamera(R, dt, t, attract) {
  // Follow camera, in the spirit of modern pinball video games: it rises toward the upper table when the ball
  // goes up there, and swings back down early (looking ahead along the ball's path) so the flippers are always
  // on screen with plenty of time before the ball arrives. The lowest ball always wins during multiball.
  const follow = camFollow && !attract && G.state !== 'over';
  let target = 0, focusX = 228;
  if (follow) {
    const live = G.balls.filter(b => b.state === 'play' || b.state === 'ramp');
    const b = live.sort((a, c) => (c.state === 'play') - (a.state === 'play') || c.y - a.y)[0];
    if (b && G.phase === 'play') {
      const look = b.state === 'ramp' ? b.y : b.y + clamp(b.vy, -900, 900) * (b.vy > 0 ? 0.45 : 0.2);
      target = smooth01((600 - Math.max(look, b.state === 'play' && b.vy > 120 ? b.y + 160 : -1e9)) / 320);
      if (live.some(o => o.state === 'play' && o.y > 560)) target = 0;
      focusX = b.x;
    }
  }
  R.camU = R.camU || 0;
  if (target < R.camU) R.camU = Math.max(target, R.camU - (R.camU - target) * Math.min(1, dt * 6) - dt * 0.6);   // come down fast
  else R.camU += (target - R.camU) * Math.min(1, dt * 2.2);                                                         // go up gently
  const u = R.camU, eu = u * u * (3 - 2 * u);
  let shift;
  if (follow) { _camP.lerpVectors(R.poseLow.pos, R.poseHigh.pos, eu); _camL.lerpVectors(R.poseLow.look, R.poseHigh.look, eu); shift = lerp(R.poseLow.shift, R.poseHigh.shift, eu); }
  else { _camP.copy(R.poseFull.pos); _camL.copy(R.poseFull.look); shift = R.poseFull.shift; }
  R.camShift = lerp(R.camShift ?? shift, shift, Math.min(1, dt * 8));
  if (Math.abs(R.camShift) > 0.002) camera.setViewOffset(stageW, stageH, 0, -R.camShift / 2 * stageH, stageW, stageH); else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  // a little sideways lean toward the ball, and a slow drift on the title screen
  const leanX = attract ? Math.sin(t * 0.18) * 0.8 : clamp((focusX - 228) * S * (0.03 + eu * 0.05), -1.2, 1.2);
  const driftZ = attract ? Math.sin(t * 0.25) * 1.2 : 0;
  R.camX = lerp(R.camX || 0, leanX, Math.min(1, dt * 2));
  const prevP = R.camPrevP || _camP.clone(), prevL = R.camPrevL || _camL.clone();
  _camP2.lerpVectors(prevP, _camP, Math.min(1, dt * 8)); _camL2.lerpVectors(prevL, _camL, Math.min(1, dt * 8));
  R.camPrevP = _camP2.clone(); R.camPrevL = _camL2.clone();
  const sh = G.shake > 0 ? G.shake : 0;
  camera.position.set(_camP2.x + R.camX + (Math.random() - 0.5) * sh, _camP2.y + (Math.random() - 0.5) * sh, _camP2.z + driftZ);
  camera.lookAt(_camL2.x + R.camX, _camL2.y, _camL2.z + driftZ);
}
const smooth01 = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function updateScene(dt) {
  const R = R3; if (!R) return;
  const t = G.t, attract = G.state === 'title';
  const blink = (rate) => Math.floor(t * rate) % 2 === 0;
  updateCamera(R, dt, t, attract);
  // flippers
  FLIPPERS.forEach((f, i) => { R.flippers[i].rotation.y = -f.ang; });
  // balls
  const visible = G.balls.filter(b => b.state !== 'gone' && b.state !== 'wait' || b.state === 'wait');
  R.balls.forEach((m, i) => {
    const b = visible[i];
    const halo = R.ballHalos[i], tr = R.ballTrails[i];
    if (!b || G.state === 'title') { m.visible = false; R.ballShadows[i].visible = false; halo.visible = false; tr.hist.length = 0; tr.sprites.forEach(sp => { sp.material.opacity = 0; }); return; }
    let x = b.x, y = b.y, h = b.h || 0;
    if (b.state === 'locked' || b.state === 'wait') { const slot = b.lockSlot || 0; x = 42 + slot * 4; y = 58; h = 2 + slot * 2.2; }
    if (b.state === 'scoop') h = -0.6;
    m.visible = true; m.scale.setScalar(1.12); m.position.copy(W3(x, y, h + BALL_R * S * 1.12));
    if (b.state === 'play' || b.state === 'lane') { m.rotation.x += b.vy * dt * 0.012; m.rotation.z -= b.vx * dt * 0.012; }
    const s = R.ballShadows[i]; s.visible = h < 0.5 && b.state !== 'scoop'; s.position.copy(W3(x + 3, y + 5, 0.06));
    halo.visible = b.state !== 'scoop' && b.state !== 'locked' && b.state !== 'wait'; halo.position.copy(W3(x, y, h + 0.04));
    // trail: remember recent positions and fade a row of glows along them, brighter the faster the ball moves
    const speed = Math.hypot(b.vx || 0, b.vy || 0), moving = (b.state === 'play' || b.state === 'ramp') && (speed > 500 || b.state === 'ramp');
    tr.hist.unshift(m.position.clone()); if (tr.hist.length > 18) tr.hist.length = 18;
    tr.sprites.forEach((sp, k) => { const q = tr.hist[k * 2 + 1]; if (!q || !moving) { sp.material.opacity = Math.max(0, sp.material.opacity - dt * 4); if (q) sp.position.copy(q); return; } sp.position.copy(q); sp.material.opacity = (b.state === 'ramp' ? 0.4 : clamp((speed - 500) / 1200, 0.15, 0.55)) * (1 - k / 9); });
  });
  // bumpers
  R.bumpers.forEach((bm, i) => {
    const f = G.bumperFlash[i], siz = G.sizzleT > 0;
    bm.capMat.emissiveIntensity = 0.5 + f * 3 + (attract ? 0.6 * (blink(3) === (i % 2 === 0)) : 0) + (siz ? 0.8 + 0.6 * Math.sin(t * 12 + i) : 0);
    bm.capMat.emissive.set(siz ? 0xff6a1a : 0xff2f8a);
    bm.ring.position.y = 1.0 - f * 0.6;
    R.sprites.bumpers[i].material.opacity = 0.15 + f * 0.9 + (siz ? 0.3 : 0);
  });
  R.slings.forEach((m, i) => { m.emissiveIntensity = 0.35 + G.slingFlash[i] * 3; R.sprites.slings[i].material.opacity = 0.1 + G.slingFlash[i] * 0.9; });
  // grill toy
  R.grill.spin.rotation.y = G.grillAngle; R.grill.spin.position.y = 0.8 + G.grillFlash * 0.5 * Math.abs(Math.sin(t * 20));
  R.grill.fireMat.color.setRGB(1, 0.3 + 0.2 * Math.sin(t * 9), 0.1).multiplyScalar(0.6 + G.grillFlash * 1.5 + (G.mode >= 0 && MODES[G.mode].key === 'burger' ? 0.8 * blink(4) : 0));
  R.sprites.grill.material.opacity = 0.2 + G.grillFlash * 0.9 + (G.mode >= 0 && MODES[G.mode].key === 'burger' ? 0.4 : 0);
  // targets
  R.targets.forEach((tg, i) => { tg.m.position.y = 0.95 - G.targetAnim[i] * 1.95; tg.mat.emissiveIntensity = G.targetFlash[i] * 1.5; });
  R.spinner.rotation.x = G.spinner;
  // fridge
  R.fridge.hinge.rotation.y = -G.fridgeOpen * 1.6;
  R.fridge.lampMats.forEach((m, i) => m.color.set(i < G.locks ? 0x7dffd2 : (G.lockLit && blink(4) ? 0x2a8c6a : 0x173326)));
  R.sprites.fridge.material.opacity = G.fridgeOpen * 0.8 + (G.lockLit ? 0.25 + 0.2 * Math.sin(t * 6) : 0);
  // chef animation
  const c = R.chef, mood = attract ? (Math.floor(t / 4) % 3 === 1 ? 'flip' : 'idle') : G.chef.mood, ct = attract ? t % 4 : G.chef.t;
  let bodyY = 0.6 + Math.sin(t * 2.2) * 0.08, aL = 0.15, aR = -0.2, headTilt = Math.sin(t * 1.3) * 0.12, headNod = 0, pattyY = -0.05, pattyRot = 0;
  if (mood === 'cheer') { bodyY += Math.abs(Math.sin(ct * 7)) * 1.4; aL = -2.6 + Math.sin(ct * 14) * 0.3; aR = 2.6 - Math.sin(ct * 14) * 0.3; headTilt = Math.sin(ct * 10) * 0.25; }
  else if (mood === 'sad') { aL = 0.05; aR = -0.05; headNod = 0.45; bodyY -= 0.15; }
  else if (mood === 'point') { aR = -1.6 + Math.sin(ct * 8) * 0.15; headTilt = -0.2; }
  else if (mood === 'flip') { const k = (ct * 1.6) % 1; aR = -0.4 - Math.sin(k * Math.PI) * 1.4; pattyY = -0.05 + Math.sin(k * Math.PI) * 2.2; pattyRot = k * Math.PI * 2; }
  c.body.position.y = bodyY; c.armL.rotation.z = aL; c.armR.rotation.z = aR; c.headG.rotation.z = headTilt; c.headG.rotation.x = headNod;
  c.patty.position.y = pattyY; c.patty.rotation.x = pattyRot;
  // ramps glow
  const modeKey = G.mode >= 0 ? MODES[G.mode].key : '';
  R.rampL.emissiveIntensity = 0.5 + G.rampFlash[0] * 2.5 + (G.multiball || modeKey === 'sauce' ? 1 + 0.8 * Math.sin(t * 8) : 0) + (G.lockLit ? 0.6 : 0);
  R.rampR.emissiveIntensity = 0.5 + G.rampFlash[1] * 2.5 + (G.multiball || modeKey === 'shake' ? 1 + 0.8 * Math.sin(t * 8) : 0);
  animateCornerToys(R, dt, t);
  R.sprites.rampL.material.opacity = G.rampFlash[0] * 0.9 + (G.multiball || G.lockLit || modeKey === 'sauce' ? 0.3 * blink(3) : 0);
  R.sprites.rampR.material.opacity = G.rampFlash[1] * 0.9 + (G.multiball || modeKey === 'shake' ? 0.3 * blink(3) : 0);
  R.sprites.scoop.material.opacity = G.scoopFlash * 0.9 + (G.scoopLit || G.superLit ? 0.35 * blink(4) : 0);
  R.sprites.kick.material.opacity = G.kickFlash * 0.9;
  R.scoopRing.color.set(G.superLit ? 0xffd84a : G.scoopLit ? 0xff6fb5 : 0x553311).multiplyScalar(G.scoopLit || G.superLit ? (blink(5) ? 2 : 0.6) : 1);
  R.signMat.opacity = Math.sin(t * 17) > -0.95 ? 1 : 0.55;
  // inserts
  const I = R.ins, set = (it, on, k = 1.8) => { it.lit = !!on; it.mat.color.copy(it.base).multiplyScalar(on ? k : 0.16); it.pool.color.copy(it.base); it.pool.opacity = on ? 0.32 : 0; };
  I.hot.forEach((it, i) => set(it, G.lanes[i] || G.laneFlash[i] > 0 || (attract && Math.floor(t * 3) % 3 === i) || (G.skillLive && G.skillLane === i && G.balls.some(b => b.state === 'lane') && blink(6))));
  I.bonus.forEach((it, i) => set(it, G.bonusX >= i + 2 || (attract && Math.floor(t * 4) % 5 === i)));
  set(I.rampL, G.multiball || G.lockLit || modeKey === 'sauce' || G.wizard ? blink(G.multiball ? 8 : 3) : attract ? blink(2) : G.rampFlash[0] > 0);
  I.rampL.base.set(G.multiball ? 0xffd84a : G.lockLit ? 0x7dffd2 : 0xff5a6a);
  set(I.rampR, G.multiball || modeKey === 'shake' || G.wizard ? blink(G.multiball ? 8 : 3) : attract ? !blink(2) : G.rampFlash[1] > 0);
  I.rampR.base.set(G.multiball ? 0xffd84a : 0x7dd8ff);
  I.orbitL.base.set(G.extraLit ? 0x7dff9a : 0x7dd8ff);
  set(I.orbitL, G.extraLit ? blink(5) : modeKey === 'pie' || G.wizard ? blink(3) : attract ? blink(3) : G.comboT > 0);
  set(I.orbitR, modeKey === 'pie' || G.wizard ? !blink(3) : attract ? !blink(3) : G.comboT > 0);
  set(I.scoop, G.scoopLit || G.superLit ? blink(4) : attract && blink(2));
  set(I.kick, G.kickbackLit);
  set(I.save, G.saveT > 0 && (G.saveT > 2 || blink(6)));
  I.chef.forEach((it, i) => set(it, G.targets[i] || G.targetFlash[i] > 0 || (attract && blink(2) === (i % 2 === 0))));
  I.modes.forEach((it, i) => set(it, G.modesPlayed[i] || (G.mode === i && blink(5)) || (G.wizard && blink(8)) || (attract && Math.floor(t * 2) % 4 === i)));
  I.chev.forEach(c => { c.base.copy(c.main.base); const on = c.main.lit || (G.state === 'title'); const chase = (Math.floor(t * 7) + 3 - c.k) % 3 === 0; c.mat.color.copy(c.base).multiplyScalar(on ? (chase ? 1.9 : 0.45) : 0.12); c.pool.color.copy(c.base); c.pool.opacity = on && chase ? 0.28 : 0; });
  animateDiorama(R, dt, t);
  // plunger pull
  R.plunger.position.z = W3(453, 970).z + G.plunger * 2.4;
}
function sizeCamera() {
  const aspect = stageW / stageH;
  camera.aspect = aspect;
  // frame the whole table below the score display
  const R = R3;
  camera.fov = 38;
  camera.updateProjectionMatrix();
  // Fit a part of the table on any screen: try a range of viewing angles, and for each one move the camera
  // back until every given point lands inside the area below the score display. Keep the angle that shows
  // that part biggest, pinned to the bottom (or top) of the view.
  const topLimit = 1 - 2 * (HUD + DMD) / UH - 0.03, bottomLimit = -1 + 0.035, sideLimit = 0.97;
  const v = new THREE.Vector3();
  const fitPose = (list, degMin, degMax, anchor, close = false) => {
    const pts = list.map(p => new THREE.Vector3(...p));
    const measure = (pitch, dist, tz) => {
      camera.position.set(0, dist * Math.sin(pitch), tz + dist * Math.cos(pitch)); camera.lookAt(0, 0, tz); camera.updateMatrixWorld();
      let minY = 9, maxY = -9, maxX = 0;
      for (const p of pts) { v.copy(p).project(camera); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); maxX = Math.max(maxX, Math.abs(v.x)); }
      return { ok: minY >= bottomLimit && maxY <= topLimit && maxX <= sideLimit, minY, maxY };
    };
    let best = null;
    for (let deg = degMin; deg <= degMax; deg += 2) {
      const pitch = deg * Math.PI / 180;
      let fit = null;
      for (let d = 40; d <= 280 && !fit; d += 2) for (let tz = -50; tz <= 50; tz += 2) { if (measure(pitch, d, tz).ok) { fit = { d, tz }; break; } }
      if (!fit) continue;
      const d = fit.d + 2;
      let tzC = fit.tz, gapC = 9;
      for (let tz = -50; tz <= 50; tz += 0.5) {
        const f = measure(pitch, d, tz); if (!f.ok) continue;
        const gap = anchor === 'top' ? Math.abs((topLimit - f.maxY) - Math.min(0.02, f.minY - bottomLimit)) : Math.abs((f.minY - bottomLimit) - Math.min(0.02, topLimit - f.maxY));
        if (gap < gapC) { gapC = gap; tzC = tz; }
      }
      const f = measure(pitch, d, tzC);
      camera.updateMatrixWorld(); const wide = Math.abs(v.copy(pts[0]).project(camera).x);
      const score = (close ? (f.maxY - f.minY) / d : (f.maxY - f.minY) * wide) * (1 - (deg - degMin) * 0.012 - Math.max(0, deg - 50) * 0.02);   // follow views prefer the closest camera   // bigger is better; slight preference for a lower, more dramatic angle
      if (!best || score > best.score) best = { pitch, dist: d, tz: tzC, score };
    }
    if (!best) best = { pitch: 57 * Math.PI / 180, dist: 200, tz: 0 };
    const pos = new THREE.Vector3(0, best.dist * Math.sin(best.pitch), best.tz + best.dist * Math.cos(best.pitch));
    // On tall screens the width sets the zoom, which can leave spare room above or below. A lens shift moves
    // the picture up or down without changing its width, so the spare room lands on the side we choose.
    const f = measure(best.pitch, best.dist, best.tz), spare = (f.minY - bottomLimit) + (topLimit - f.maxY);
    const shift = anchor === 'top' ? -(topLimit - f.maxY) : anchor === 'bottom-shift' ? f.minY - bottomLimit : 0;
    return { pos, look: new THREE.Vector3(0, 0, best.tz), shift, spare };
  };
  // the whole table (title screen and fixed camera)
  camera.clearViewOffset();
  R.poseFull = fitPose([[-24.5, 0, 47], [24.5, 0, 47], [-23, 0, 38], [23, 0, 38], [-24.5, 0, -46], [24.5, 0, -46], [-20, 9.5, -43.5], [19.6, 9.5, -43.5], [0, 19, -53], [-27, 6, -20], [27, 6, -20]], 36, 60, 'bottom');
  // follow camera: the lower table with the flippers, and the upper table with the toys
  R.poseLow = fitPose([[-24.5, 0, 47], [24.5, 0, 47], [-23, 0, 38], [23, 0, 38], [-24.5, 0, -17], [24.5, 0, -17], [-12, 4.8, -15], [11, 5.4, -15]], 34, 56, 'bottom-shift', true);
  if (R.poseLow.spare > 0.06) R.poseLow = R.poseFull;   // tall phone: the width already limits the zoom, so show the whole table
  R.poseHigh = fitPose([[-24.5, 0, 18], [24.5, 0, 18], [-24.5, 0, -46], [24.5, 0, -46], [-20, 9.5, -43.5], [19.6, 9.5, -43.5], [0, 13, -53]], 34, 56, 'top', true);
  const pr = Math.min(window.devicePixelRatio || 1, quality >= 2 ? 1.75 : quality === 1 ? 1.35 : 1);
  renderer.setPixelRatio(pr);
  renderer.setSize(stageW, stageH, false);
  composer.setPixelRatio(pr); composer.setSize(stageW, stageH);
  bloom.resolution.set(stageW / 2, stageH / 2);
}

/* ====================== 2D interface layer ====================== */
function fit() {
  const wrap = document.getElementById('wrap');
  const aw = wrap.clientWidth || innerWidth, ah = wrap.clientHeight || innerHeight;
  const aspect = clamp(ah / aw, 1.45, 2.2);
  stageW = Math.floor(Math.min(aw, ah / aspect)); stageH = Math.floor(stageW * aspect);
  stage.style.width = stageW + 'px'; stage.style.height = stageH + 'px';
  UH = Math.round(UW * aspect);
  const d = Math.min(2, window.devicePixelRatio || 1);
  ui.width = Math.round(stageW * d); ui.height = Math.round(stageH * d);
  uiScale = stageW * d / UW;
  if (R3) sizeCamera();
}
addEventListener('resize', fit);
if (window.visualViewport) visualViewport.addEventListener('resize', fit);

function rr(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function circle(x, y, r, c) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); }
function lin(x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of stops) g.addColorStop(o, c); return g; }
function text(s, x, y, size, color, align = 'center', weight = '800', spacing = 0) {
  ctx.font = `${weight} ${size}px ${UI_FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = spacing + 'px';
  ctx.fillStyle = color; ctx.fillText(s, x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
function bigText(s, x, y, size, top = '#ffffff', bottom = '#ff6fb5') {
  ctx.save(); ctx.font = `900 ${size}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = size * 0.4; ctx.shadowOffsetY = size * 0.08;
  ctx.fillStyle = lin(0, y - size / 2, 0, y + size / 2, [[0, top], [1, bottom]]); ctx.fillText(s, x, y);
  ctx.shadowColor = 'transparent'; ctx.lineWidth = Math.max(1, size / 28); ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.strokeText(s, x, y);
  ctx.restore();
}
function glassButton(x, y, w, h, active = false) {
  rr(x, y, w, h, h / 2);
  ctx.fillStyle = lin(0, y, 0, y + h, active ? [[0, 'rgba(255,130,200,.55)'], [1, 'rgba(190,40,120,.45)']] : [[0, 'rgba(30,10,40,.6)'], [1, 'rgba(10,2,16,.6)']]);
  ctx.fill(); ctx.strokeStyle = 'rgba(255,170,220,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
}
function panel(x, y, w, h, alpha = 0.92) {
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
  rr(x, y, w, h, 18); ctx.fillStyle = lin(0, y, 0, y + h, [[0, `rgba(60,18,64,${alpha})`], [1, `rgba(14,4,20,${alpha + 0.03})`]]); ctx.fill();
  ctx.restore();
  ctx.save(); rr(x, y, w, h, 18); ctx.clip(); ctx.fillStyle = lin(0, y, 0, y + 70, [[0, 'rgba(255,255,255,.09)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(x, y, w, 70); ctx.restore();
  rr(x, y, w, h, 18); ctx.strokeStyle = 'rgba(255,170,220,.4)'; ctx.lineWidth = 1.5; ctx.stroke();
}
function iconSpeaker(cx, cy, off) {
  ctx.fillStyle = off ? '#8c7c88' : '#ffffff';
  ctx.beginPath(); ctx.moveTo(cx - 8, cy - 3.5); ctx.lineTo(cx - 4, cy - 3.5); ctx.lineTo(cx + 1, cy - 8); ctx.lineTo(cx + 1, cy + 8); ctx.lineTo(cx - 4, cy + 3.5); ctx.lineTo(cx - 8, cy + 3.5); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = off ? '#ff6a5a' : '#ffffff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  if (off) { ctx.beginPath(); ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx + 10, cy + 4); ctx.moveTo(cx + 10, cy - 4); ctx.lineTo(cx + 4, cy + 4); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(cx + 2, cy, 5, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + 2, cy, 9, -0.8, 0.8); ctx.stroke(); }
}

/* ---- little animated scenes for the display and the mode intros (all original drawings) ---- */
function sceneBurger(cx, cy, s, t) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  for (let i = 0; i < 3; i++) { const ph = (t * 1.2 + i / 3) % 1; ctx.strokeStyle = `rgba(255,255,255,${0.4 * (1 - ph)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10 + i * 10, 6 - ph * 22); ctx.quadraticCurveTo(-6 + i * 10, -2 - ph * 22, -10 + i * 10, -8 - ph * 22); ctx.stroke(); }
  ctx.fillStyle = '#3a3f4c'; rr(-24, 14, 48, 6, 3); ctx.fill();
  ctx.fillStyle = '#ff5a1a'; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 9 - 4, 20); ctx.quadraticCurveTo(i * 9, 12 - Math.abs(Math.sin(t * 9 + i)) * 6, i * 9 + 4, 20); ctx.fill(); }
  const k = (t * 1.3) % 1, jump = Math.sin(k * Math.PI) * 26;
  ctx.save(); ctx.translate(0, 8 - jump); ctx.rotate(k * Math.PI * 2);
  ctx.fillStyle = '#6a3418'; rr(-16, -4, 32, 8, 4); ctx.fill(); ctx.fillStyle = '#ffc21a'; ctx.fillRect(-14, -5, 28, 2);
  ctx.restore();
  ctx.save(); ctx.translate(20, 6); ctx.rotate(-0.5 - Math.sin(k * Math.PI) * 0.7);
  ctx.fillStyle = '#c9ced6'; rr(-2, -2, 18, 4, 2); ctx.fill(); ctx.fillStyle = '#7a4b22'; rr(16, -2, 14, 4, 2); ctx.fill();
  ctx.restore(); ctx.restore();
}
function sceneShake(cx, cy, s, t) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  const lvl = (Math.sin(t * 1.5) * 0.5 + 0.5) * 0.8 + 0.15;
  ctx.beginPath(); ctx.moveTo(-14, -22); ctx.lineTo(14, -22); ctx.lineTo(9, 22); ctx.lineTo(-9, 22); ctx.closePath();
  ctx.save(); ctx.clip(); ctx.fillStyle = '#ff9ccf'; const top = 22 - 44 * lvl; ctx.beginPath(); ctx.moveTo(-16, 24); for (let x = -16; x <= 16; x += 4) ctx.lineTo(x, top + Math.sin(x * 0.4 + t * 6) * 1.5); ctx.lineTo(16, 24); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.strokeStyle = 'rgba(220,240,255,.9)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = '#ff5a6a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(4, 10); ctx.lineTo(12, -32); ctx.stroke();
  circle(-2, -24 - Math.abs(Math.sin(t * 3)) * 3, 4, '#e8233c');
  ctx.restore();
}
function sceneSauce(cx, cy, s, t) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  const tilt = -0.9 + Math.sin(t * 2) * 0.3;
  ctx.save(); ctx.translate(-6, -6); ctx.rotate(tilt);
  ctx.fillStyle = '#e8233c'; rr(-8, -18, 16, 30, 5); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(-8, -4, 16, 6); ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.moveTo(-3, -18); ctx.lineTo(3, -18); ctx.lineTo(0, -26); ctx.closePath(); ctx.fill();
  ctx.restore();
  for (let i = 0; i < 4; i++) { const ph = (t * 1.6 + i / 4) % 1; circle(10 + ph * 6, -8 + ph * 30, 2.4 * (1 - ph * 0.4), '#e8233c'); }
  ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.ellipse(12, 24, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function scenePie(cx, cy, s, t) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  ctx.rotate(t * 0.8);
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 22, i * Math.PI / 3 + 0.04, (i + 1) * Math.PI / 3 - 0.04); ctx.closePath(); ctx.fillStyle = i % 2 ? '#e8a050' : '#d68a3a'; ctx.fill(); ctx.fillStyle = '#b8243c'; ctx.beginPath(); ctx.arc(Math.cos(i * Math.PI / 3 + 0.5) * 12, Math.sin(i * Math.PI / 3 + 0.5) * 12, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
function scenePlates(cx, cy, s, t) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  for (let i = 0; i < 3; i++) { const x = ((t * 60 + i * 30) % 90) - 45; ctx.save(); ctx.translate(x, Math.sin(t * 5 + i) * 4); ctx.rotate(t * 4 + i); ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.ellipse(0, 0, 12, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#ff6fb5'; ctx.lineWidth = 2; ctx.stroke(); circle(0, 0, 5, '#6a3418'); ctx.restore(); }
  ctx.restore();
}
function sceneFireworks(cx, cy, s, t) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  for (let k = 0; k < 3; k++) { const ph = (t * 0.9 + k / 3) % 1, ox = (k - 1) * 24, oy = -6 + (k % 2) * 8; const col = ['#ff6fb5', '#ffd84a', '#7dd8ff'][k];
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; ctx.globalAlpha = 1 - ph; circle(ox + Math.cos(a) * ph * 20, oy + Math.sin(a) * ph * 20, 2, col); } }
  ctx.globalAlpha = 1; ctx.restore();
}
const SCENES = { burger: sceneBurger, shake: sceneShake, sauce: sceneSauce, pie: scenePie, rush: scenePlates, wizard: sceneFireworks };

function drawHUD() {
  ctx.fillStyle = lin(0, 0, 0, HUD, [[0, 'rgba(42,15,46,.96)'], [1, 'rgba(18,6,26,.92)']]); ctx.fillRect(0, 0, UW, HUD);
  if (G.state === 'title') {
    glassButton(8, 7, 118, 30);
    ctx.strokeStyle = '#ffd6ee'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(27, 16); ctx.lineTo(21, 22); ctx.lineTo(27, 28); ctx.stroke();
    text('ARCADE', 72, 22.5, 14, '#fff0f8', 'center', '800', 1.5);
  } else { text('SCORE', 12, 13, 10, '#ffa6d6', 'left', '800', 1.5); text(G.score.toLocaleString(), 12, 30, 19, '#ffffff', 'left', '800'); }
  text('HIGH', 214, 13, 10, '#ffa6d6', 'center', '800', 1.5); text(best().toLocaleString(), 214, 30, 17, '#ffd84a', 'center', '800');
  text('BALL', 322, 13, 10, '#ffa6d6', 'center', '800', 1.5); text(G.state === 'title' ? '-' : String(Math.min(G.ball, BALLS_PER_GAME)), 322, 30, 19, '#ffffff', 'center', '800');
  glassButton(UW - 98, 7, 42, 30); iconSpeaker(UW - 77, 22, muted);
  glassButton(UW - 50, 7, 42, 30, G.state === 'paused');
  ctx.fillStyle = '#ffffff';
  if (G.state === 'paused') { ctx.beginPath(); ctx.moveTo(UW - 34, 15); ctx.lineTo(UW - 22, 22); ctx.lineTo(UW - 34, 29); ctx.closePath(); ctx.fill(); }
  else { rr(UW - 36, 15, 4, 14, 2); ctx.fill(); rr(UW - 28, 15, 4, 14, 2); ctx.fill(); }
}
function drawDisplay() {
  const y = HUD, h = DMD;
  ctx.fillStyle = 'rgba(8,3,6,.9)'; ctx.fillRect(0, y, UW, h);
  rr(8, y + 4, UW - 16, h - 8, 10); ctx.fillStyle = lin(0, y, 0, y + h, [[0, '#1d0a18'], [1, '#0b0410']]); ctx.fill();
  ctx.strokeStyle = 'rgba(255,111,181,.45)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.save(); rr(8, y + 4, UW - 16, h - 8, 10); ctx.clip();
  const glowText = (s, x, yy, size, color = '#ffb347', align = 'center') => { ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 12; text(s, x, yy, size, color, align, '900', 1.5); ctx.restore(); };
  const cy = y + h / 2, m = G.disp, t = G.t;
  const scene = (key, x) => { if (SCENES[key]) SCENES[key](x, cy, 0.95, t); };
  if (G.state === 'title') {
    const msgs = ['FLIPSIDE DINER', 'NOW SERVING HIGH SCORES', 'PRESS START'];
    scene('burger', 52); scene('shake', UW - 52);
    glowText(msgs[Math.floor(G.titleT / 2.5) % msgs.length], UW / 2, cy, 18, '#ffb347');
  } else if (G.phase === 'bonus' && G.state === 'play') {
    const k = Math.min(1, G.phaseT / 2.4);
    glowText('BONUS ' + G.bonusX + 'X', UW / 2, y + 22, 13, '#ffd84a');
    glowText(Math.floor(G.bonusTotal * k).toLocaleString(), UW / 2, y + 44, 21);
  } else if (m) {
    const pulse = 1 + Math.max(0, 0.25 - m.t) * 1.6;
    ctx.save(); ctx.translate(UW / 2, m.small ? y + 24 : cy); ctx.scale(pulse, pulse); glowText(m.big, 0, 0, m.small ? 18 : 22, m.color); ctx.restore();
    if (m.small) glowText(m.small, UW / 2, y + 46, 11, '#ffe1b8');
  } else if (G.wizard) {
    scene('wizard', 56); scene('wizard', UW - 56);
    glowText('GRAND OPENING', UW / 2, y + 24, 18, '#ff6fb5'); glowText(Math.ceil(G.wizardT) + ' SEC — EVERY SHOT 100K', UW / 2, y + 46, 11, '#ffe1b8');
  } else if (G.mode >= 0) {
    const md = MODES[G.mode];
    scene(md.key, 52);
    glowText(md.name, UW / 2 + 20, y + 22, 17, md.color);
    glowText(md.what + '  ' + G.modeProg + '/' + md.goal, UW / 2 + 20, y + 44, 11, '#ffe1b8');
    const k = clamp(G.modeT / 30, 0, 1); ctx.fillStyle = 'rgba(255,255,255,.12)'; rr(UW - 66, y + 14, 46, 8, 4); ctx.fill(); ctx.fillStyle = md.color; rr(UW - 66, y + 14, 46 * k, 8, 4); ctx.fill();
    glowText(String(Math.ceil(G.modeT)), UW - 43, y + 40, 16, md.color);
  } else if (G.multiball) {
    scene('rush', 60);
    glowText('DINNER RUSH', UW / 2 + 20, y + 22, 18, '#ff6fb5');
    glowText(G.superLit ? 'SUPER JACKPOT AT THE ORDER WINDOW!' : 'RAMPS = JACKPOT  ·  ' + G.jackpots + ' SO FAR', UW / 2 + 20, y + 44, 11, '#ffe1b8');
  } else {
    glowText('BALL ' + Math.min(G.ball, BALLS_PER_GAME), 24, cy, 13, '#ffb347', 'left');
    const mid = G.sizzleT > 0 ? 'SIZZLE MANIA ' + Math.ceil(G.sizzleT) : G.scoopLit ? (G.modesPlayed.every(Boolean) ? 'GRAND OPENING IS LIT' : 'ORDER WINDOW: START ' + MODES[G.modesPlayed.findIndex(p => !p)].name) : G.lockLit ? 'LOCK IS LIT — SAUCE RAMP' : G.extraLit ? 'EXTRA BALL — LEFT ORBIT' : 'SPELL C·H·E·F  ·  ROLL H·O·T';
    glowText(mid, UW / 2 + 8, cy, 11.5, '#ffb347');
    glowText(G.bonusX + 'X', UW - 24, cy, 13, '#ffb347', 'right');
  }
  ctx.globalAlpha = 0.28; ctx.fillStyle = '#000'; for (let yy = y + 4; yy < y + h; yy += 3) ctx.fillRect(8, yy, UW - 16, 1); ctx.globalAlpha = 1;
  ctx.restore();
}
function drawCallouts() {
  const c = G.callouts[G.callouts.length - 1]; if (!c) return;
  const t = c.t, s = t < 0.25 ? 0.4 + (t / 0.25) * 0.75 : t < 0.4 ? 1.15 - (t - 0.25) : 1, a = t > 1.8 ? Math.max(0, 1 - (t - 1.8) / 0.4) : 1;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(UW / 2, HUD + DMD + (UH - HUD - DMD) * 0.36); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(10,2,16,.55)'; rr(-205, -42, 410, c.sub ? 88 : 70, 22); ctx.fill();
  bigText(c.txt, 0, -6, 40, '#ffffff', c.color);
  if (c.sub) text(c.sub, 0, 30, 13, '#ffe9f4', 'center', '900', 1);
  ctx.restore();
}
function drawIntro() {
  const I = G.intro; if (!I) return;
  const t = I.t, k = Math.min(1, t / 0.35), out = t > I.dur - 0.35 ? (I.dur - t) / 0.35 : 1;
  ctx.save(); ctx.globalAlpha = Math.min(k, out);
  ctx.fillStyle = 'rgba(8,2,14,.78)'; ctx.fillRect(0, HUD + DMD, UW, UH - HUD - DMD);
  const cy = HUD + DMD + (UH - HUD - DMD) * 0.42;
  // light rays
  ctx.save(); ctx.translate(UW / 2, cy); ctx.rotate(t * 0.6);
  for (let i = 0; i < 16; i++) { ctx.rotate(Math.PI / 8); ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(255,111,181,.07)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-40, -520); ctx.lineTo(40, -520); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  const sc = 2.6 + Math.sin(Math.min(1, t * 2) * Math.PI) * 0.6;
  if (SCENES[I.kind]) SCENES[I.kind](UW / 2, cy - 30, sc, G.t);
  const slide = (1 - Math.min(1, t / 0.5)) * 300;
  bigText(I.title, UW / 2 - slide, cy + 90, 42, '#ffffff', I.color);
  ctx.globalAlpha *= Math.min(1, Math.max(0, (t - 0.4) / 0.3));
  text(I.sub, UW / 2 + slide, cy + 132, 14, '#ffe9f4', 'center', '900', 1.5);
  ctx.restore();
}
function boardPages() { return WEEK !== null ? ['all', 'week', 'help'] : ['all', 'help']; }
function drawTitle() {
  const cx = UW / 2, top = HUD + DMD + 30, ph = Math.min(UH - top - 30, 640);
  panel(30, top, UW - 60, ph, 0.8);
  bigText('FLIPSIDE', cx, top + 50 + Math.sin(G.titleT * 3) * 3, 52, '#ffffff', '#ff6fb5');
  bigText('DINER', cx, top + 98 - Math.sin(G.titleT * 3) * 3, 40, '#e9fbff', '#5ad1ff');
  text('P I N B A L L', cx, top + 132, 13, '#ffd84a', 'center', '900', 3);
  const pages = boardPages(), page = pages[Math.floor(G.titleT / 7) % pages.length];
  let y = top + 170;
  const dots = () => pages.forEach((p, i) => circle(cx - (pages.length - 1) * 7 + i * 14, y + 14, 3, p === page ? '#ffa6d6' : 'rgba(255,166,214,.3)'));
  if (page === 'help') {
    text('ON THE MENU', cx, y, 13, '#ffa6d6', 'center', '800', 2.5); dots(); y += 40;
    const rows = [['C·H·E·F targets', 'light the fridge LOCK'], ['Sauce Ramp', 'lock 2 balls → DINNER RUSH'], ['Dinner Rush', 'both ramps are JACKPOTS'],
      ['H·O·T lanes', 'light a mode at the Order Window'], ['4 cooking modes', '→ GRAND OPENING wizard'], ['Burger grill', 'spin it, flip it, score it'], ['Skill shot', 'plunge into the flashing lane']];
    rows.forEach(([a, b], i) => { const yy = y + i * 38; if (i % 2 === 0) { rr(cx - 180, yy - 15, 360, 30, 10); ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fill(); } text(a, cx - 168, yy, 13.5, '#ffffff', 'left', '800'); text(b, cx + 168, yy, 11.5, '#ffcbe6', 'right', '600'); });
  } else {
    const list = page === 'week' ? WEEK : BOARD;
    text(page === 'week' ? 'TOP 10 THIS WEEK' : BOARD_SHARED ? 'TOP 10 ALL-TIME' : 'TOP 10 ON THIS DEVICE', cx, y, 13, '#ffa6d6', 'center', '800', 2.5); dots(); y += 40;
    if (!list.length) { text(page === 'week' ? 'No scores this week yet' : 'No scores yet', cx, y + 30, 17, '#ffffff', 'center', '700'); text('Be the first!', cx, y + 56, 17, '#ffd84a', 'center', '800'); }
    list.slice(0, 10).forEach((e, i) => {
      const yy = y + i * 27, me = MINE && e.name === MINE.name && e.score === MINE.score;
      if (me) { ctx.save(); ctx.shadowColor = 'rgba(255,216,74,.6)'; ctx.shadowBlur = 12; rr(cx - 172, yy - 12, 344, 24, 9); ctx.fillStyle = 'rgba(255,216,74,.22)'; ctx.fill(); ctx.restore(); rr(cx - 172, yy - 12, 344, 24, 9); ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 1.5; ctx.stroke(); text('YOU', cx + 192, yy, 10, '#ffd84a', 'center', '900', 1); }
      else if (i % 2 === 0) { rr(cx - 170, yy - 11, 340, 22, 8); ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fill(); }
      if (i === 0) { circle(cx - 150, yy, 9, '#ffd84a'); text('1', cx - 150, yy + 0.5, 11, '#3a2a00', 'center', '900'); }
      else text(String(i + 1), cx - 150, yy, 14, '#ffa6d6', 'center', '800');
      const c = i === 0 ? '#ffe27a' : '#fff3fa';
      text(String(e.name || '???'), cx - 120, yy, 15, c, 'left', '800', 2);
      text(Number(e.score).toLocaleString(), cx + 160, yy, 15, c, 'right', '800');
    });
  }
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(G.titleT * 4);
  text(IS_TOUCH ? 'TAP TO START' : 'PRESS ENTER OR CLICK TO START', cx, top + ph - 46, 16, '#ffffff', 'center', '800', 2); ctx.globalAlpha = 1;
  if (!IS_TOUCH) text('← / Z  LEFT FLIPPER  ·  → / X  RIGHT FLIPPERS  ·  SPACE  PLUNGER', cx, top + ph - 22, 10, '#ffa6d6', 'center', '700', 1);
}
function drawTips() {
  const x = 28, y = HUD + DMD + 24, w = UW - 56, h = Math.min(UH - y - 24, 600);
  panel(x, y, w, h);
  bigText('HOW TO PLAY', UW / 2, y + 42, 30, '#ffffff', '#ff6fb5');
  const rows = IS_TOUCH ? [
    ['☝', 'Tap the LEFT half of the screen', 'for the left flipper.'], ['☝', 'Tap the RIGHT half for both', 'right flippers (lower and upper).'], ['⏬', 'To launch, hold your finger down,', 'then let go. Longer = stronger.'],
  ] : [
    ['←', 'Left arrow, Z or Left Shift', 'for the left flipper.'], ['→', 'Right arrow, X or Right Shift', 'for both right flippers.'], ['⏬', 'Hold Space or Down, then let go', 'to launch. Longer = stronger.'],
  ];
  rows.push(['★', 'Spell C·H·E·F, then lock 2 balls in the', 'fridge with the Sauce Ramp: DINNER RUSH!']);
  rows.push(['\u{1F525}', 'Roll through H·O·T, then shoot the', 'Order Window to start a cooking mode.']);
  rows.forEach(([icon, l1, l2], i) => {
    const ry = y + 100 + i * Math.min(84, (h - 160) / 5), ix = x + 44;
    circle(ix, ry, 24, 'rgba(255,255,255,.08)'); text(icon, ix, ry + 1, 20, '#ffd84a', 'center', '900');
    text(l1, x + 80, ry - 10, 14, '#ffffff', 'left', '700'); text(l2, x + 80, ry + 11, 14, '#ffcbe6', 'left', '600');
  });
  if (G.stateT > 0.4) { ctx.globalAlpha = 0.55 + 0.45 * Math.sin(G.stateT * 4); text(IS_TOUCH ? 'TAP TO START' : 'PRESS ENTER TO START', UW / 2, y + h - 28, 15, '#ffffff', 'center', '800', 2); ctx.globalAlpha = 1; }
}
function drawOverlays() {
  const cy = UH / 2;
  if (G.state === 'paused') { panel(UW / 2 - 180, cy - 74, 360, 152); bigText('PAUSED', UW / 2, cy - 26, 38); }
  else if (G.state === 'over') {
    panel(UW / 2 - 210, cy - 96, 420, 204);
    bigText('GAME OVER', UW / 2, cy - 54, 42, '#ffffff', '#ff6a5a');
    text('FINAL SCORE ' + G.score.toLocaleString(), UW / 2, cy - 12, 16, '#ffffff', 'center', '800', 1);
    const rl = rankLine(); if (rl) text(rl, UW / 2, cy + 14, 14, '#ffd84a', 'center', '900', 1);
  }
  for (const b of menuButtons()) { glassButton(b.x, b.y, b.w, b.h, b.primary); text(b.label, b.x + b.w / 2, b.y + b.h / 2 + 0.5, 14, '#ffffff', 'center', '800', 1.2); }
  if (G.state === 'play' && G.phase === 'bonus') {
    const y0 = HUD + DMD + 120;
    panel(UW / 2 - 175, y0, 350, 300);
    bigText('BONUS', UW / 2, y0 + 34, 30, '#ffffff', '#ffd84a');
    G.bonusLines.forEach(([name, v], i) => { if (G.phaseT < i * 0.2) return; text(name, UW / 2 - 145, y0 + 72 + i * 22, 13, '#ffe9f4', 'left', '700'); text(v.toLocaleString(), UW / 2 + 145, y0 + 72 + i * 22, 13, '#ffffff', 'right', '800'); });
    text('× ' + G.bonusX + '   =   ' + G.bonusTotal.toLocaleString(), UW / 2, y0 + 268, 18, '#ffd84a', 'center', '900', 1);
  }
}
function drawPops() {
  // score pop-ups follow their spot on the table using the camera projection
  for (const p of G.pops) {
    const v = W3(p.x, p.y, 3).project(camera);
    const x = (v.x * 0.5 + 0.5) * UW, y = (-v.y * 0.5 + 0.5) * UH;
    ctx.save(); ctx.globalAlpha = clamp(p.t * 2, 0, 1); ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 6; text(p.txt, x, y, 14, p.color, 'center', '900', 1); ctx.restore();
  }
}
function drawUI() {
  ctx.setTransform(uiScale, 0, 0, uiScale, 0, 0);
  ctx.clearRect(0, 0, UW, UH);
  if (G.flash > 0) { ctx.fillStyle = `rgba(255,240,250,${Math.min(0.45, G.flash * 0.35)})`; ctx.fillRect(0, 0, UW, UH); }
  if (G.state === 'play' || G.state === 'paused') { drawPops(); drawCallouts(); }
  if (G.state === 'play' && !G.intro && G.balls.some(b => b.state === 'lane' && !b.auto) && waitingToPlunge()) {
    const k = G.plunger; ctx.save(); ctx.globalAlpha = 0.85;
    rr(UW - 30, UH - 190, 14, 150, 7); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,170,220,.5)'; ctx.stroke();
    rr(UW - 28, UH - 42 - 146 * k, 10, 146 * k, 5); ctx.fillStyle = lin(0, UH - 190, 0, UH - 40, [[0, '#ff4a6a'], [1, '#ffd84a']]); ctx.fill();
    ctx.restore();
  }
  if (G.state === 'title') drawTitle();
  if (G.state === 'tips') drawTips();
  drawIntro();
  drawOverlays();
  drawDisplay();
  drawHUD();
}

/* ====================== initials entry ====================== */
const iniBox = document.getElementById('ini'), iniForm = iniBox.querySelector('form');
const iniIn = document.getElementById('iniIn'), iniMsg = document.getElementById('iniMsg');
const iniSave = document.getElementById('iniSave'), iniSkip = document.getElementById('iniSkip');
function openEntry() {
  entryOpen = true; iniBox.hidden = false; iniMsg.textContent = ''; iniSave.disabled = false;
  document.getElementById('iniScore').textContent = G.score.toLocaleString() + ' POINTS';
  iniIn.value = lsGet(GAME_ID + '.initials', '');
  setTimeout(() => { try { iniIn.focus(); iniIn.select(); } catch (e) {} }, 60);
}
function closeEntry() { entryOpen = false; iniBox.hidden = true; G.stateT = Math.max(G.stateT, 1.3); try { iniIn.blur(); } catch (e) {} }
iniIn.addEventListener('input', () => { iniIn.value = iniIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3); });
iniForm.addEventListener('submit', async e => {
  e.preventDefault();
  const name = iniIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (!name) { iniMsg.textContent = 'Enter 1 to 3 letters or numbers.'; return; }
  lsSet(GAME_ID + '.initials', name);
  iniSave.disabled = true; iniMsg.textContent = '';
  const res = await submitScore(name, G.score, 1);
  if (res === true) closeEntry(); else { iniMsg.textContent = res; iniSave.disabled = false; }
});
iniSkip.addEventListener('click', closeEntry);

/* ====================== start up + main loop ====================== */
fit();
try { buildScene(); sizeCamera(); loadingEl.remove(); }
catch (e) { loadingEl.textContent = 'This device could not start 3D graphics (WebGL). Try another browser.'; console.error(e); }
let last = performance.now(), frameAvg = 16, frames = 0;
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000); last = now;
  update(dt);
  if (R3) {
    updateScene(dt);
    if (R3 && R3.cubeCam) updateBallReflection(R3, dt);
    if (quality > 0) composer.render(); else renderer.render(scene, camera);
    // drop to a lighter quality level on slow devices
    frameAvg = frameAvg * 0.95 + (dt * 1000) * 0.05; frames++;
    if (frames > 180 && frameAvg > 26 && quality > 0) { quality--; frames = 0; if (quality === 0) renderer.shadowMap.enabled = false; sizeCamera(); }
  }
  drawUI();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

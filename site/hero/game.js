(() => {
'use strict';
/* =====================================================================
   SHORT ORDER HERO — an original 1950s-diner platformer for the Jones Ridge Arcade.
   Frankie the short-order cook chases Big Greasy across town to rescue Dottie,
   the Flipside Diner's jukebox singer. Every sprite is drawn in code and every
   sound is synthesized.
   ===================================================================== */
const GAME_ID = 'hero';
const T = 32, ROWS = 12, FIELD = ROWS * T, HUD = 44;
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const DEBUG = location.hash === '#debug';

const cv = document.getElementById('c');
let ctx = cv.getContext('2d');
const wrap = document.getElementById('wrap');
let W = 640, H = HUD + FIELD, PAD = 0, PORTRAIT = false, dpr = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Desktop and phones held sideways: a wide 640 x 384 playfield.
// Phones held upright: a narrower view with the control pad underneath.
function fit() {
  // Measure the space inside the safe-area padding (notches, rounded corners, home bar),
  // not the whole screen, or the game spills off the top and bottom on phones.
  const cs = getComputedStyle(wrap), px = v => parseFloat(v) || 0;
  const aw = Math.max(1, (wrap.clientWidth || innerWidth) - px(cs.paddingLeft) - px(cs.paddingRight));
  const ah = Math.max(1, (wrap.clientHeight || innerHeight) - px(cs.paddingTop) - px(cs.paddingBottom));
  PORTRAIT = IS_TOUCH && ah > aw * 1.05;
  if (PORTRAIT) { W = 416; H = Math.round(clamp(W * ah / aw, HUD + FIELD + 180, HUD + FIELD + 520)); PAD = H - HUD - FIELD; }
  else { H = HUD + FIELD; PAD = 0; W = Math.round(clamp(H * aw / ah, 640, 768)); }
  const k = Math.min(aw / W, ah / H);
  const nd = Math.max(1, Math.min(3, Math.ceil(k * (window.devicePixelRatio || 1) * 4) / 4));
  if (nd !== dpr) { dpr = nd; spriteCache.clear(); }
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = Math.floor(W * k) + 'px'; cv.style.height = Math.floor(H * k) + 'px';
}
addEventListener('resize', fit);
if (window.visualViewport) visualViewport.addEventListener('resize', fit);

/* ---------------- storage + leaderboards (all-time + this week) ---------------- */
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

/* ---------------- audio: synthesized effects + a little doo-wop band ---------------- */
let ac = null, master = null, muted = lsGet(GAME_ID + '.muted', '0') === '1', noiseBuf = null;
function audio() {
  if (!ac) {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination); }
    catch (e) { ac = null; }
  }
  if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
function tone(f, dur, type = 'square', vol = 0.1, f2 = null, delay = 0, at = null) {
  if (muted || !ac) return;
  const t = at !== null ? at : ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.2, lp = 1200, delay = 0) {
  if (muted || !ac) return;
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = lp;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.02);
}
const sfx = {
  jump() { tone(330, 0.16, 'square', 0.05, 760); },
  coin() { tone(1319, 0.06, 'square', 0.045); tone(1976, 0.18, 'square', 0.045, null, 0.06); },
  stomp() { tone(220, 0.1, 'square', 0.08, 90); noise(0.08, 0.12, 900); },
  bonk() { tone(160, 0.08, 'triangle', 0.12, 110); },
  smash() { noise(0.25, 0.22, 1600); tone(140, 0.15, 'square', 0.05, 60); },
  sprout() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.08, 'triangle', 0.07, null, i * 0.05)); },
  power() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.1, 'square', 0.045, null, i * 0.05)); },
  hurt() { tone(600, 0.3, 'sawtooth', 0.06, 150); },
  throw() { tone(900, 0.07, 'square', 0.035, 300); noise(0.06, 0.06, 3000); },
  sizzle() { noise(0.35, 0.12, 4000); },
  boing() { tone(180, 0.3, 'sine', 0.12, 620); },
  life() { [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.12, 'triangle', 0.08, null, i * 0.08)); },
  check() { [659, 880, 1319].forEach((f, i) => tone(f, 0.14, 'triangle', 0.08, null, i * 0.09)); },
  die() { [523, 494, 466, 440, 415, 392, 370, 349].forEach((f, i) => tone(f, 0.12, 'square', 0.05, null, i * 0.09)); },
  bossHit() { tone(120, 0.3, 'sawtooth', 0.1, 50); noise(0.3, 0.2, 700); },
  thud() { noise(0.4, 0.3, 300); tone(70, 0.4, 'sine', 0.2, 35); },
  clear() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, i % 2 ? 'triangle' : 'square', 0.05, null, i * 0.11)); },
  tally() { tone(1760, 0.03, 'square', 0.02); },
  over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.32, 'triangle', 0.09, null, i * 0.24)); },
  select() { tone(700, 0.06, 'square', 0.05); },
  kiss() { tone(1200, 0.08, 'sine', 0.08, 2200); tone(1500, 0.12, 'sine', 0.06, 2600, 0.12); },
};
// Background music: a I–vi–IV–V shuffle in C, scheduled a little ahead of time.
const mid = m => 440 * Math.pow(2, (m - 69) / 12);
const CHORDS = [[48, 52, 55, 57], [45, 48, 52, 53], [41, 45, 48, 50], [43, 47, 50, 52]];
const MELODY = [
  76, null, 79, null, 81, 79, 76, null,   72, null, 76, null, 81, null, 79, null,
  77, null, 81, null, 84, 81, 77, null,   79, null, 83, null, 86, null, 83, 79,
  76, 76, 79, null, 84, null, 81, 79,     81, null, 76, null, 72, null, 69, null,
  77, null, 76, null, 74, null, 72, null, 74, null, 79, null, 77, 76, 74, null,
];
const BOSS_MELODY = [
  64, null, 63, null, 64, null, 67, null, 69, null, 67, null, 64, null, 63, null,
  65, null, 64, null, 65, null, 69, null, 71, null, 69, null, 65, null, 64, null,
];
let music = { on: false, step: 0, next: 0, boss: false };
function musicStart(boss = false) { if (!ac) return; music.on = true; music.boss = boss; music.step = 0; music.next = ac.currentTime + 0.08; }
function musicStop() { music.on = false; }
function musicTick() {
  if (!ac || !music.on || muted) { if (ac) music.next = ac.currentTime + 0.05; return; }
  const rush = P && P.rushT > 0;
  const stepDur = 60 / (music.boss ? 168 : rush ? 190 : 148) / 2;
  while (music.next < ac.currentTime + 0.2) {
    const s = music.step, t = music.next, bar = Math.floor(s / 8) % 4, beat = s % 8;
    const ch = music.boss ? [[40, 43, 47, 48], [41, 45, 48, 50], [40, 43, 47, 48], [38, 42, 45, 47]][bar] : CHORDS[bar];
    if (beat % 2 === 0) tone(mid(ch[beat / 2]) , stepDur * 1.7, 'triangle', 0.11, null, 0, t);
    else tone(mid(ch[(beat - 1) / 2 % 3] + 24), stepDur * 0.6, 'square', 0.018, null, 0, t);
    if (beat === 2 || beat === 6) noise(0.05, 0.05, 6000, Math.max(0, t - ac.currentTime));
    const mel = music.boss ? BOSS_MELODY[s % BOSS_MELODY.length] : MELODY[s % MELODY.length];
    if (mel) tone(mid(mel), stepDur * 1.4, 'square', 0.032, null, 0, t);
    music.step++; music.next += stepDur;
  }
}

/* ---------------- levels ----------------
   Each level is a run of 12-row segments laid end to end. Legend:
   # floor   = solid block   - shelf (jump up through it)   B crate (breaks)   J tip jar
   P hot-sauce jar   S milkshake jar   H pie jar   F fryer oil   G griddle   ^ fork tray
   | invisible wall   o tip coin   m meatball   f fly   t toaster   j jello mold
   M moving tray   V dumbwaiter   K checkpoint sign   E jukebox (goal)   @ start
   A boss arena gate   X Big Greasy   D Dottie's freezer                                  */
const SEGS = {
  start: [
    '                ',
    '                ',
    '                ',
    '                ',
    '                ',
    '                ',
    '      J P J     ',
    '                ',
    '                ',
    '  @             ',
    '################',
    '################'],
  walkers: [
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '         ooo      ',
    '                  ',
    '        =BJB=     ',
    '                  ',
    '                  ',
    '     m        m   ',
    '##################',
    '##################'],
  pit: [
    '                ',
    '                ',
    '                ',
    '                ',
    '                ',
    '      o o o     ',
    '                ',
    '                ',
    '                ',
    '                ',
    '#####   ########',
    '#####   ########'],
  stairs: [
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '           o      ',
    '          ===     ',
    '        o         ',
    '       ===   f    ',
    '     o            ',
    '    ===          m',
    '##################',
    '##################'],
  fryer: [
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '       o    o     ',
    '                  ',
    '                  ',
    '      ---  ---    ',
    '                  ',
    '####FFFFFFFFFF####',
    '####FFFFFFFFFF####'],
  tray: [
    '                    ',
    '                    ',
    '                    ',
    '                    ',
    '          o o o     ',
    '                    ',
    '                    ',
    '                    ',
    '     M              ',
    '                    ',
    '###FFFFFFFFFFFFFF###',
    '###FFFFFFFFFFFFFF###'],
  jars: [
    '                    ',
    '                    ',
    '                    ',
    '         ooo        ',
    '                    ',
    '                    ',
    '    BJB    =H=      ',
    '                    ',
    '                    ',
    '              m     ',
    '####################',
    '####################'],
  jarsToaster: [
    '                    ',
    '                    ',
    '                    ',
    '         ooo        ',
    '                    ',
    '                    ',
    '    BSB    =J=      ',
    '                    ',
    '                    ',
    '              t     ',
    '####################',
    '####################'],
  highroad: [
    '                      ',
    '                      ',
    '                      ',
    '      o  o  o  o      ',
    '                      ',
    '    ====      ====    ',
    '                      ',
    '  ==              ==  ',
    '                      ',
    '         m  m         ',
    '######################',
    '######################'],
  jello: [
    '                  ',
    '   oooooo         ',
    '                  ',
    '   ======         ',
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '          j   f   ',
    '##################',
    '##################'],
  lift: [
    '                ',
    '                ',
    '        ooo     ',
    '       =====    ',
    '                ',
    '                ',
    '             H  ',
    '                ',
    '    V           ',
    '                ',
    '################',
    '################'],
  check: [
    '            ',
    '            ',
    '            ',
    '            ',
    '            ',
    '            ',
    '            ',
    '            ',
    '            ',
    '     K      ',
    '############',
    '############'],
  griddle: [
    '                    ',
    '                    ',
    '                    ',
    '                    ',
    '                    ',
    '         o o        ',
    '                    ',
    '        ---         ',
    '                    ',
    '                    ',
    '####GGGGGGGGGGG#####',
    '####################'],
  forks: [
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '       o   o      ',
    '                  ',
    '                  ',
    '     ==    ==     ',
    '                  ',
    '####^^^^^^^^^#####',
    '##################'],
  flypits: [
    '                    ',
    '                    ',
    '                    ',
    '                    ',
    '                    ',
    '     f       f      ',
    '                    ',
    '                    ',
    '        ==          ',
    '                    ',
    '####   ####   ######',
    '####   ####   ######'],
  toasters: [
    '                      ',
    '                      ',
    '                      ',
    '                      ',
    '          P           ',
    '                      ',
    '                      ',
    '       ---------      ',
    '                      ',
    '    t           t     ',
    '######################',
    '######################'],
  jellostack: [
    '                    ',
    '                    ',
    '      ooo           ',
    '     ==S==          ',
    '                    ',
    '                    ',
    '                    ',
    '             ===    ',
    '                    ',
    '       j   j        ',
    '####################',
    '####################'],
  crates: [
    '                    ',
    '                    ',
    '                    ',
    '                    ',
    '      o       o     ',
    '     BBB     BJB    ',
    '                    ',
    '                    ',
    '         m          ',
    '        ===    f    ',
    '####################',
    '####################'],
  ledges: [
    '                      ',
    '                      ',
    '                      ',
    '              ooo     ',
    '             ====     ',
    '                      ',
    '        ===           ',
    '                      ',
    '   ===           m    ',
    '                ===   ',
    '####     ####      ###',
    '####     ####      ###'],
  end: [
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '                  ',
    '          E       ',
    '##################',
    '##################'],
  arena: [
    '                                ',
    '                                ',
    '                                ',
    '                                ',
    '                                ',
    '                            ||||',
    '     ---              ---   ||||',
    '                            ||||',
    '                            ||||',
    ' A             X          D ||||',
    '################################',
    '################################'],
};
const LEVELS = [
  { name: 'THE KITCHEN', theme: 'kitchen', time: 300,
    segs: ['start', 'walkers', 'pit', 'stairs', 'jars', 'fryer', 'check', 'highroad', 'tray', 'crates', 'pit', 'lift', 'end'],
    clue: ['A napkin with a red lipstick kiss:', '“Follow the neon, Frankie!”'] },
  { name: 'THE DINER FLOOR', theme: 'diner', time: 300,
    segs: ['start', 'jarsToaster', 'jello', 'pit', 'highroad', 'toasters', 'check', 'fryer', 'stairs', 'jellostack', 'tray', 'walkers', 'end'],
    clue: ['Dottie’s charm bracelet!', 'Big Greasy dragged her out the back.'] },
  { name: 'THE BACK ALLEY', theme: 'alley', time: 300,
    segs: ['start', 'flypits', 'crates', 'ledges', 'jarsToaster', 'forks', 'check', 'tray', 'jello', 'flypits', 'stairs', 'toasters', 'end'],
    clue: ['One red high heel!', 'Big Greasy’s grill is just ahead.'] },
  { name: 'BIG GREASY’S GRILL', theme: 'grill', time: 300,
    segs: ['start', 'griddle', 'forks', 'fryer', 'jarsToaster', 'griddle', 'check', 'ledges', 'tray', 'arena'],
    clue: null },
];
const TILE = { ' ': 0, '#': 1, '=': 2, '-': 3, B: 4, J: 5, P: 6, S: 7, H: 8, F: 10, G: 11, '^': 12, '|': 13 };
const USED = 9, GATE = 14;
const isSolid = t => t === 1 || t === 2 || (t >= 4 && t <= 9) || t >= 11;

/* ---------------- game state ---------------- */
const G = {
  state: 'title', t: 0, stateT: 0, titleT: 0, score: 0, tips: 0, lives: 3, levelNum: 1,
  time: 300, checkX: null, shake: 0, freezeT: 0, parts: [], pops: [], entryHandled: true, msg: '', sub: '', msgT: 0, tallyT: 0, winBonus: false,
};
let L = null, P = null;
const cam = { x: 0, minX: 0 };
function best() { return Math.max(+lsGet(GAME_ID + '.best', '0') || 0, BOARD[0] ? BOARD[0].score : 0, G.score); }
function pop(x, y, txt, color = '#ffd84a') { G.pops.push({ x, y, txt, color, t: 1.1 }); }
function burst(x, y, colors, n = 14, speed = 180, grav = 600, size = 3) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.4, g: grav, life: 0.5 + Math.random() * 0.5, c: colors[i % colors.length], r: size * (0.6 + Math.random() * 0.6) });
  }
}
function addScore(n) { G.score += n; }
function puff(x, y, n = 4, spread = 1, color = 'rgba(235,228,220,1)') {
  for (let i = 0; i < n; i++) G.parts.push({ x: x + (Math.random() - 0.5) * 10 * spread, y: y - 2, vx: (Math.random() - 0.5) * 70 * spread, vy: -10 - Math.random() * 30, g: -20, life: 0.4, max: 0.4, c: color, r: 2.5 + Math.random() * 2, grow: 6, puff: true });
}
function impact(x, y, color = '#fff6c0') {
  G.parts.push({ x, y, vx: 0, vy: 0, g: 0, life: 0.3, max: 0.3, c: color, r: 4, grow: 22, ring: true });
  for (let i = 0; i < 5; i++) { const a = -Math.PI * (0.1 + 0.8 * i / 4); G.parts.push({ x, y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, g: 500, life: 0.45, max: 0.45, c: '#ffe066', r: 4, star: true }); }
}
function addTip(x, y) {
  G.tips++; addScore(50); sfx.coin();
  if (G.tips >= 100) { G.tips -= 100; G.lives++; sfx.life(); pop(x, y - 20, '1UP', '#7dff9a'); }
}
const tileAt = (c, r) => (c < 0 || c >= L.w) ? 13 : (r < 0 || r >= ROWS) ? 0 : L.tiles[r * L.w + c];
const setTile = (c, r, v) => { if (c >= 0 && c < L.w && r >= 0 && r < ROWS) L.tiles[r * L.w + c] = v; };
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* ---------------- building a level ---------------- */
const ENEMY = {
  meat:  { w: 26, h: 24, pts: 100, speed: 52 },
  fly:   { w: 24, h: 18, pts: 200 },
  toast: { w: 28, h: 26, pts: 300 },
  jello: { w: 30, h: 24, pts: 400, speed: 26 },
};
function makeEnemy(type, cx, bottom, extra = {}) {
  const d = ENEMY[type];
  return Object.assign({ type, x: cx - d.w / 2, y: bottom - d.h, w: d.w, h: d.h, vx: -(d.speed || 0), vy: 0, active: false, dead: false, deadT: 0, style: '', t: Math.random() * 6, ground: false, hopT: 1 + Math.random(), hops: 0 }, extra);
}
function buildLevel(n) {
  const def = LEVELS[(n - 1) % LEVELS.length], loop = Math.floor((n - 1) / LEVELS.length);
  const rows = Array.from({ length: ROWS }, () => '');
  for (const name of def.segs) {
    const seg = SEGS[name], w = Math.max(...seg.map(r => r.length));
    for (let r = 0; r < ROWS; r++) rows[r] += seg[r].padEnd(w, ' ');
  }
  const w = rows[0].length;
  const lv = { def, loop, theme: def.theme, w, pw: w * T, tiles: new Uint8Array(w * ROWS), coins: [], enemies: [], items: [], plats: [], shots: [], eshots: [], checks: [], coinPops: [], bumps: [],
    goal: null, boss: null, dottie: null, arena: null, start: { x: 2 * T, y: 9 * T }, spd: 1 + 0.14 * loop };
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < w; c++) {
    const ch = rows[r][c], cx = c * T + T / 2, bottom = (r + 1) * T;
    if (ch in TILE) { lv.tiles[r * w + c] = TILE[ch]; continue; }
    switch (ch) {
      case 'o': lv.coins.push({ x: cx, y: r * T + T / 2, got: false }); break;
      case 'm': lv.enemies.push(makeEnemy('meat', cx, bottom)); break;
      case 't': lv.enemies.push(makeEnemy('toast', cx, bottom)); break;
      case 'j': lv.enemies.push(makeEnemy('jello', cx, bottom)); break;
      case 'f': lv.enemies.push(makeEnemy('fly', cx, bottom - 4, { x0: cx, y0: r * T + T / 2 })); break;
      case 'M': lv.plats.push({ x: c * T, y: r * T, w: 3 * T, h: 14, x0: c * T, y0: r * T, axis: 'x', range: 8 * T, period: 5.2, dx: 0, dy: 0 }); break;
      case 'V': lv.plats.push({ x: c * T, y: r * T, w: 3 * T, h: 14, x0: c * T, y0: r * T, axis: 'y', range: r * T - 4 * T, period: 4.6, dx: 0, dy: 0 }); break;
      case 'K': lv.checks.push({ x: c * T, y: bottom, on: false }); break;
      case 'E': lv.goal = { x: c * T, y: bottom - 3 * T + 8, w: 2 * T, h: 3 * T - 8 }; break;
      case '@': lv.start = { x: c * T + 7, y: bottom - 28 }; break;
      case 'A': lv.arena = { col: c, x: c * T, on: false }; break;
      case 'X': lv.boss = { x: cx - 28, y: bottom - 76, w: 56, h: 76, vx: 0, vy: 0, hp: 12 + 4 * loop, maxHp: 12 + 4 * loop, state: 'wait', t: 0, act: 1.5, inv: 0, face: -1, ground: true, pose: '', poseT: 0, spin: 0 }; break;
      case 'D': lv.dottie = { x: c * T + T, y: bottom, open: 0, out: 0 }; break;
    }
  }
  return lv;
}

/* ---------------- physics ---------------- */
const GRAV_UP = 1250, GRAV_DOWN = 2300, MAX_FALL = 720;
// Moves a box through the tile map. Sets b.ground, b.wall (-1/1) and b.bonk (tile column/row hit from below).
function moveBody(b, dt, oneWay = true) {
  b.wall = 0; b.bonk = null;
  b.x += b.vx * dt;
  const r0 = Math.floor(b.y / T), r1 = Math.floor((b.y + b.h - 0.01) / T);
  if (b.vx > 0) {
    const c = Math.floor((b.x + b.w - 0.01) / T);
    for (let r = r0; r <= r1; r++) if (isSolid(tileAt(c, r))) { b.x = c * T - b.w; b.wall = 1; break; }
  } else if (b.vx < 0) {
    const c = Math.floor(b.x / T);
    for (let r = r0; r <= r1; r++) if (isSolid(tileAt(c, r))) { b.x = (c + 1) * T; b.wall = -1; break; }
  }
  const prevBottom = b.y + b.h;
  b.y += b.vy * dt; b.ground = false;
  const c0 = Math.floor((b.x + 1) / T), c1 = Math.floor((b.x + b.w - 1) / T);
  if (b.vy >= 0) {
    const r = Math.floor((b.y + b.h) / T);
    for (let c = c0; c <= c1; c++) {
      const t = tileAt(c, r);
      if (isSolid(t) || (oneWay && t === 3 && prevBottom <= r * T + 1)) { b.y = r * T - b.h; b.vy = 0; b.ground = true; break; }
    }
  } else {
    const r = Math.floor(b.y / T), mid = Math.floor((b.x + b.w / 2) / T);
    const order = [mid, c0, c1].filter((c, i, a) => a.indexOf(c) === i);
    for (const c of order) if (isSolid(tileAt(c, r))) { b.y = (r + 1) * T; b.vy = 0; b.bonk = { c, r }; break; }
  }
}
function onPlatforms(b, prevBottom) {
  if (b.vy < 0) return null;
  for (const p of L.plats) {
    if (b.x + b.w > p.x + 2 && b.x < p.x + p.w - 2 && prevBottom <= p.y + 2 + Math.max(0, p.dy) && b.y + b.h >= p.y) {
      b.y = p.y - b.h; b.vy = 0; b.ground = true; return p;
    }
  }
  return null;
}
const griddleHot = (c) => ((G.t + Math.floor(c / 3) * 1.1) % 3.3) < 1.2;

/* ---------------- the hero ---------------- */
function newHero(x, y) {
  return { x, y, w: 18, h: 28, vx: 0, vy: 0, face: 1, ground: false, coyote: 0, jumpBuf: 0, jumping: false, hearts: 3, power: 0, rushT: 0, inv: 0,
    anim: 0, throwT: 0, plat: null, dead: false, chain: 0, land: 0, wall: 0, bonk: null, hitFlash: 0, squashX: 1, squashY: 1 };
}
function startLevel() {
  L = buildLevel(G.levelNum);
  const sx = G.checkX !== null ? G.checkX : L.start.x;
  P = newHero(sx, G.checkX !== null ? 9 * T + T - 28 : L.start.y);
  if (G.checkX !== null) for (const k of L.checks) if (k.x <= G.checkX) k.on = true;
  G.time = L.def.time; G.parts = []; G.pops = [];
  cam.minX = 0; cam.x = clamp(P.x - W * 0.4, 0, L.pw - W);
  G.state = 'intro'; G.stateT = 0; musicStop();
}
function startGame() {
  G.score = 0; G.tips = 0; G.lives = 3; G.levelNum = 1; G.checkX = null; MINE = null;
  if (lsGet(GAME_ID + '.tipsSeen', '0') !== '1') { L = buildLevel(1); P = newHero(L.start.x, L.start.y); cam.x = 0; G.state = 'tips'; G.stateT = 0; return; }
  startLevel();
}
function toTitle() { G.state = 'title'; G.stateT = 0; G.titleT = 0; musicStop(); refreshBoard(); }
function hurtHero() {
  if (P.inv > 0 || P.rushT > 0 || P.dead || G.state !== 'play') return;
  if (P.power) { P.power = 0; pop(P.x + 9, P.y - 10, 'OUCH!', '#ff8a7a'); }
  else P.hearts--;
  P.inv = 1.6; P.hitFlash = 0.05; sfx.hurt(); buzz(60); G.shake = 0.3;
  if (P.hearts <= 0) killHero();
}
function killHero() {
  if (P.dead) return;
  P.dead = true; P.hearts = 0; G.state = 'dying'; G.stateT = 0; P.vy = -640; P.vx = 0; P.rushT = 0;
  musicStop(); sfx.die(); buzz([80, 60, 120]);
}
function gameOver() {
  G.state = 'over'; G.stateT = 0; G.entryHandled = false; musicStop();
  if (G.score > (+lsGet(GAME_ID + '.best', '0') || 0)) lsSet(GAME_ID + '.best', String(G.score));
  sfx.over();
}

/* ---------------- input ---------------- */
const keys = { left: false, right: false, jump: false, run: false };
const touchBtn = { left: false, right: false, jump: false, run: false };
let entryOpen = false, lastTouch = 0, prevJump = false, prevRun = false;
const input = () => ({ left: keys.left || touchBtn.left, right: keys.right || touchBtn.right, jump: keys.jump || touchBtn.jump, run: keys.run || touchBtn.run });

function updateHero(dt) {
  const inp = input();
  const jumpPressed = inp.jump && !prevJump, runPressed = inp.run && !prevRun;
  prevJump = inp.jump; prevRun = inp.run;
  const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const top = (inp.run ? 270 : IS_TOUCH ? 200 : 165) * (P.rushT > 0 ? 1.15 : 1);
  if (dir) {
    P.face = dir;
    const acc = P.ground ? (Math.sign(P.vx) === -dir && Math.abs(P.vx) > 40 ? 2600 : 1300) : 900;
    const before = Math.abs(P.vx);
    P.vx += dir * acc * dt;
    // never accelerate past top speed; if already faster (e.g. run released), ease back down
    if (Math.abs(P.vx) > top && Math.sign(P.vx) === dir) P.vx = dir * Math.max(top, before - 700 * dt);
  } else {
    const dec = (P.ground ? 1500 : 300) * dt;
    P.vx = Math.abs(P.vx) <= dec ? 0 : P.vx - Math.sign(P.vx) * dec;
  }
  // jumping: coyote time + jump buffer, holding jump goes higher
  P.coyote = P.ground ? 0.09 : P.coyote - dt;
  P.jumpBuf = jumpPressed ? 0.13 : P.jumpBuf - dt;
  if (P.jumpBuf > 0 && P.coyote > 0) {
    P.vy = -(566 + Math.abs(P.vx) * 0.12); P.jumping = true; P.coyote = 0; P.jumpBuf = 0; P.plat = null; sfx.jump(); puff(P.x + P.w / 2, P.y + P.h, 3, 0.8);
    P.squashX = 0.85; P.squashY = 1.15; P.squashT = 0.05;
  }
  const g = P.vy < 0 && inp.jump ? GRAV_UP : GRAV_DOWN;
  P.vy = Math.min(MAX_FALL, P.vy + g * dt);
  // throw hot sauce
  if (runPressed && P.power === 1 && L.shots.length < 2) {
    L.shots.push({ x: P.x + (P.face > 0 ? P.w : -12), y: P.y + 8, w: 12, h: 12, vx: P.face * 400 + P.vx * 0.3, vy: 80, t: 1.4 });
    P.throwT = 0.18; sfx.throw();
  }
  // ride moving platforms
  if (P.plat) { P.x += P.plat.dx; P.y += P.plat.dy; }
  const prevBottom = P.y + P.h, wasGround = P.ground;
  moveBody(P, dt);
  const plat = onPlatforms(P, prevBottom);
  P.plat = plat;
  if (plat) P.ground = true;
  if (P.ground) {
    if (!wasGround) {
      P.land = 0.12; P.chain = 0; puff(P.x + P.w / 2, P.y + P.h, 5, 1.3);
      // dust particles on landing — spread horizontally
      for (let i = 0; i < 4; i++) {
        const dx = (i < 2 ? -1 : 1) * (30 + Math.random() * 50);
        G.parts.push({ x: P.x + P.w / 2 + (Math.random() - 0.5) * 6, y: P.y + P.h - 1, vx: dx, vy: -5 - Math.random() * 15, g: 40, life: 0.35 + Math.random() * 0.2, max: 0.55, c: 'rgba(180,160,130,0.8)', r: 2 + Math.random() * 1.5, grow: 3, puff: true });
      }
      // landing squash
      P.squashX = 1.2; P.squashY = 0.8; P.squashT = 0.066;
    }
    P.jumping = false;
    const skid = dir && Math.sign(P.vx) === -dir && Math.abs(P.vx) > 110;
    P.dustT = (P.dustT || 0) - dt;
    if ((skid || Math.abs(P.vx) > 230) && P.dustT <= 0) { P.dustT = skid ? 0.04 : 0.11; puff(P.x + P.w / 2 - Math.sign(P.vx) * 6, P.y + P.h, 1, 0.5); }
    P.skid = skid;
  } else P.skid = false;
  if (P.x < cam.minX) { P.x = cam.minX; P.vx = Math.max(0, P.vx); }
  if (P.bonk) bonkTile(P.bonk.c, P.bonk.r);
  P.anim += Math.abs(P.vx) * dt * 0.06;
  P.inv = Math.max(0, P.inv - dt); P.throwT = Math.max(0, P.throwT - dt); P.land = Math.max(0, P.land - dt);
  P.hitFlash = Math.max(0, P.hitFlash - dt);
  // squash-stretch update
  if (P.squashT > 0) { P.squashT -= dt; if (P.squashT <= 0) { P.squashX = 1; P.squashY = 1; } }
  else if (!P.ground && Math.abs(P.vy) < 60) { P.squashX = 1.05; P.squashY = 0.95; } // apex stretch
  else if (P.squashX !== 1 || P.squashY !== 1) { P.squashX = lerp(P.squashX, 1, Math.min(1, dt * 12)); P.squashY = lerp(P.squashY, 1, Math.min(1, dt * 12)); }
  if (P.rushT > 0) { P.rushT -= dt; if (Math.random() < 0.5) burst(P.x + P.w / 2, P.y + P.h / 2, ['#ff7ad9', '#7af0ff', '#fff27a'], 1, 40, -50, 2.5); }
  // hazards
  const fc = Math.floor((P.x + P.w / 2) / T), fr = Math.floor((P.y + P.h - 6) / T);
  if (tileAt(fc, fr) === 10 && P.y + P.h > fr * T + 12) { sfx.sizzle(); burst(P.x + 9, P.y + P.h, ['#ffd27a', '#ffb347'], 16, 200); killHero(); return; }
  if (P.y > FIELD + 40) { killHero(); return; }
  if (P.ground) {
    const under = Math.floor((P.y + P.h + 2) / T);
    for (const c of [Math.floor((P.x + 3) / T), Math.floor((P.x + P.w - 3) / T)]) {
      const t = tileAt(c, under);
      if (t === 12 || (t === 11 && griddleHot(c))) { if (P.inv <= 0 && P.rushT <= 0) { hurtHero(); P.vy = -520; P.ground = false; } break; }
    }
  }
}
function bonkTile(c, r) {
  const t = tileAt(c, r);
  if (t === 0) return;
  sfx.bonk();
  if (t >= 4 && t <= 8) L.bumps.push({ c, r, t: 0 });
  // knock out anything standing on the tile
  for (const e of L.enemies) if (!e.dead && e.x + e.w > c * T && e.x < (c + 1) * T && Math.abs(e.y + e.h - r * T) < 6) killEnemy(e, 'flip');
  for (const k of L.coins) if (!k.got && Math.abs(k.x - (c * T + T / 2)) < 20 && Math.abs(k.y - (r * T - T / 2)) < 20) { k.got = true; addTip(k.x, k.y); }
  if (t === 4) {
    setTile(c, r, 0); sfx.smash(); addScore(50);
    for (let i = 0; i < 4; i++) G.parts.push({ x: c * T + 8 + (i % 2) * 16, y: r * T + 8 + (i >> 1) * 16, vx: (i % 2 ? 1 : -1) * (80 + Math.random() * 60), vy: -380 + (i >> 1) * 120, g: 1600, life: 1.2, c: '#b9824a', r: 6, chunk: true, spin: Math.random() * 6 });
  } else if (t === 5) {
    setTile(c, r, USED); L.coinPops.push({ x: c * T + T / 2, y: r * T, vy: -460, t: 0 }); addTip(c * T + T / 2, r * T);
  } else if (t >= 6 && t <= 8) {
    setTile(c, r, USED); sfx.sprout();
    const kind = t === 6 ? 'sauce' : t === 7 ? 'shake' : 'pie';
    L.items.push({ kind, x: c * T + 6, y: r * T, w: 20, h: 24, vx: 0, vy: 0, rise: 0, baseY: r * T, dir: P.face || 1, t: 0 });
  }
}

/* ---------------- enemies ---------------- */
function killEnemy(e, style) {
  if (e.dead) return;
  e.dead = true; e.style = style; e.deadT = 0;
  if (style === 'flip') { e.vy = -320; e.vx = (Math.random() < 0.5 ? -1 : 1) * 60; }
  addScore(ENEMY[e.type].pts); pop(e.x + e.w / 2, e.y - 6, String(ENEMY[e.type].pts));
}
function stompValue() { const v = [100, 200, 400, 800, 1000, 2000, 4000, 8000][Math.min(P.chain, 7)]; P.chain++; return v; }
function updateEnemies(dt) {
  const spd = L.spd;
  for (const e of L.enemies) {
    if (!e.active) { if (e.x < cam.x + W + 48 && e.x + e.w > cam.x - 200) e.active = true; else continue; }
    e.t += dt;
    if (e.dead) {
      e.deadT += dt;
      if (e.style === 'flip') { e.vy += 1600 * dt; e.x += e.vx * dt; e.y += e.vy * dt; }
      continue;
    }
    if (e.type === 'fly') {
      e.x = e.x0 - e.w / 2 + Math.sin(e.t * 1.3 * spd) * 70;
      e.y = e.y0 - e.h / 2 + Math.sin(e.t * 2.6 * spd) * 14;
    } else if (e.type === 'meat' || e.type === 'jello') {
      const sp = ENEMY[e.type].speed * spd;
      e.vx = Math.sign(e.vx || -1) * sp;
      e.vy = Math.min(MAX_FALL, e.vy + GRAV_DOWN * dt);
      moveBody(e, dt);
      if (e.wall) e.vx = -e.wall * sp;
      if (e.type === 'jello' && e.ground) {
        // jello molds stay on their platform
        const ahead = Math.floor((e.vx > 0 ? e.x + e.w + 2 : e.x - 2) / T), below = Math.floor((e.y + e.h + 2) / T);
        const t = tileAt(ahead, below);
        if (!isSolid(t) && t !== 3) e.vx = -e.vx;
      }
    } else if (e.type === 'toast') {
      e.vy = Math.min(MAX_FALL, e.vy + GRAV_DOWN * dt);
      if (e.ground) {
        e.vx = 0; e.hopT -= dt * spd;
        const dx = (P.x + P.w / 2) - (e.x + e.w / 2);
        if (e.hopT <= 0 && Math.abs(dx) < 380) {
          e.hops++; e.hopT = 1.5 + Math.random() * 0.6;
          if (e.hops % 3 === 0) {
            const vx = clamp(dx * 0.9, -240, 240);
            L.eshots.push({ x: e.x + e.w / 2 - 8, y: e.y - 6, w: 16, h: 14, vx, vy: -560, t: 0 });
            e.vy = -220; sfx.boing();
          } else { e.vy = -430; e.vx = Math.sign(dx) * 90; }
        }
      }
      moveBody(e, dt);
    }
    if (e.y > FIELD + 60) e.dead = true;
    // touching the hero
    if (P.dead || G.state !== 'play') continue;
    if (!overlap(P, e)) continue;
    if (P.rushT > 0) { killEnemy(e, 'flip'); sfx.stomp(); continue; }
    const fromAbove = P.vy > 40 && P.y + P.h - e.y < Math.max(14, P.vy * dt * 2 + 8);
    if (fromAbove) {
      if (e.type === 'jello') {
        P.vy = -1000; P.y = e.y - P.h; P.coyote = 0; P.jumping = true; e.squish = 0.35; sfx.boing(); burst(P.x + 9, e.y, ['#8dff9a', '#d8ffe0'], 8, 120);
      } else {
        const v = stompValue();
        if (e.type === 'meat') killEnemy(e, 'squash'); else killEnemy(e, 'flip');
        G.pops[G.pops.length - 1].txt = String(v); addScore(v - ENEMY[e.type].pts);
        P.vy = input().jump ? -620 : -400; sfx.stomp(); buzz(20); impact(e.x + e.w / 2, e.y + 4);
        // stomp effects: freeze frame, colored particles, combo text
        G.freezeT = 0.033;
        const ec = { meat: ['#8a4a2a', '#c87a4a', '#5a2a10'], fly: ['#3a8a3a', '#6ac86a', '#205020'], toast: ['#d4a840', '#f0d080', '#8a7030'], jello: ['#4ae050', '#80ffa0', '#208a30'] }[e.type] || ['#ffffff'];
        burst(e.x + e.w / 2, e.y + e.h / 2, ec, 10, 160, 500, 2.5);
        if (P.chain > 1) pop(e.x + e.w / 2, e.y - 20, 'COMBO ×' + P.chain, '#7af0ff');
        else pop(e.x + e.w / 2, e.y - 20, 'STOMP!', '#ff7ad9');
        G.shake = 0.15;
      }
    } else hurtHero();
  }
  L.enemies = L.enemies.filter(e => !(e.dead && (e.deadT > (e.style === 'squash' ? 0.6 : 2) || e.y > FIELD + 80)));
  // toast shots
  for (const s of L.eshots) { s.t += dt; s.vy += 1100 * dt; s.x += s.vx * dt; s.y += s.vy * dt; if (!P.dead && G.state === 'play' && overlap(P, s)) { s.dead = true; hurtHero(); } }
  L.eshots = L.eshots.filter(s => !s.dead && s.y < FIELD + 40);
}

/* ---------------- Big Greasy ---------------- */
function updateBoss(dt) {
  const b = L.boss; if (!b) return;
  const A = L.arena;
  if (b.state === 'wait') {
    if (A && !A.on && P.x > A.x + 3 * T) {
      A.on = true; cam.minX = A.x;
      for (let r = 0; r < 10; r++) setTile(A.col, r, GATE);
      b.state = 'intro'; b.t = 0; musicStart(true); G.msg = 'BIG GREASY!'; G.sub = 'STOMP HIS HEAD — OR SAUCE HIM'; G.msgT = 2.4; G.shake = 0.3; sfx.thud();
    }
    return;
  }
  b.t += dt; b.inv = Math.max(0, b.inv - dt); b.poseT = Math.max(0, b.poseT - dt);
  if (b.state === 'dead') {
    b.vy += 1400 * dt; b.y += b.vy * dt; b.x += b.vx * dt; b.spin += dt * 6;
    if (b.y > FIELD + 120 && G.state === 'play') { G.state = 'win'; G.stateT = 0; musicStop(); sfx.clear(); }
    return;
  }
  if (b.state === 'intro') { if (b.t > 1.6) { b.state = 'fight'; b.act = 1.2; } return; }
  const angry = b.hp <= b.maxHp / 2, spd = L.spd * (angry ? 1.3 : 1);
  const minX = A.x + T + 4, maxX = L.pw - 4 * T - b.w - 6;
  const dx = (P.x + P.w / 2) - (b.x + b.w / 2);
  if (b.ground) {
    b.face = dx < 0 ? -1 : 1;
    b.vx = b.pose === 'throw' ? 0 : b.face * 60 * spd;
    b.act -= dt;
    if (b.act <= 0) {
      const babies = L.enemies.filter(e => e.boss && !e.dead).length;
      if (Math.abs(dx) > 200 || Math.random() < 0.45 || babies >= 3) {
        b.vy = -780; b.vx = clamp(dx * 1.1, -280, 280) * spd; b.ground = false; b.pose = 'jump';
      } else {
        b.pose = 'throw'; b.poseT = 0.45;
        const e = makeEnemy('meat', b.x + b.w / 2 + b.face * 30, b.y + 30, { boss: true, active: true });
        e.vx = b.face * 52; e.vy = -380; L.enemies.push(e); sfx.throw();
      }
      b.act = (angry ? 1.3 : 1.9) + Math.random() * 0.6;
    }
    if (b.pose === 'throw' && b.poseT <= 0) b.pose = '';
  }
  b.vy = Math.min(MAX_FALL, b.vy + GRAV_DOWN * 0.8 * dt);
  const wasAir = !b.ground;
  moveBody(b, dt);
  b.x = clamp(b.x, minX, maxX);
  if (b.ground && wasAir) {
    b.pose = ''; G.shake = 0.35; sfx.thud(); buzz(40);
    burst(b.x + b.w / 2, b.y + b.h, ['#9a8a7a', '#5a4a3a'], 16, 220);
    if (P.ground && Math.abs(dx) < 150 && !P.dead) hurtHero();
  }
  // contact
  if (P.dead || G.state !== 'play' || !overlap(P, b)) return;
  const fromAbove = P.vy > 40 && P.y + P.h - b.y < 22;
  if (fromAbove && b.inv <= 0) { damageBoss(4); P.vy = -680; P.y = b.y - P.h; impact(P.x + P.w / 2, b.y + 4); }
  else if (fromAbove) P.vy = -500;
  else if (P.rushT > 0 && b.inv <= 0) { damageBoss(2); P.vx = Math.sign(dx || 1) * 300; }
  else if (b.inv <= 0.3) { hurtHero(); P.vx = Math.sign(dx || 1) * 260; }
}
function damageBoss(n) {
  const b = L.boss; if (b.inv > 0 || b.state !== 'fight') return;
  b.hp -= n; b.inv = n > 1 ? 1.0 : 0.25; sfx.bossHit(); G.shake = 0.25; buzz(40);
  burst(b.x + b.w / 2, b.y + 10, ['#fff', '#ffd27a', '#c9b48a'], 10, 200);
  if (b.hp <= 0) {
    b.state = 'dead'; b.vy = -620; b.vx = 120; addScore(5000 * (1 + L.loop)); pop(b.x + b.w / 2, b.y - 10, String(5000 * (1 + L.loop)), '#ffd84a');
    for (const e of L.enemies) if (e.boss && !e.dead) killEnemy(e, 'flip');
  }
}

/* ---------------- main update ---------------- */
function updatePlatforms(dt) {
  for (const p of L.plats) {
    const ph = (G.t % p.period) / p.period, k = (1 - Math.cos(ph * Math.PI * 2)) / 2;
    const nx = p.axis === 'x' ? p.x0 + k * p.range : p.x0, ny = p.axis === 'y' ? p.y0 - k * p.range : p.y0;
    p.dx = nx - p.x; p.dy = ny - p.y; p.x = nx; p.y = ny;
  }
}
function updateItems(dt) {
  for (const it of L.items) {
    it.t += dt;
    if (it.rise < 1) { it.rise = Math.min(1, it.rise + dt * 2.2); it.y = it.baseY - it.rise * 24; if (it.rise >= 1) { it.vx = it.kind === 'sauce' ? 0 : it.dir * 75; it.vy = it.kind === 'shake' ? -380 : -120; } continue; }
    it.vy = Math.min(MAX_FALL, it.vy + 1500 * dt);
    moveBody(it, dt);
    if (it.wall) it.vx = -it.vx;
    if (it.ground && it.kind === 'shake') it.vy = -380;
    if (it.y > FIELD + 40) it.gone = true;
    if (!P.dead && G.state === 'play' && overlap(P, it)) {
      it.gone = true; addScore(1000); pop(it.x + 10, it.y - 6, '1000');
      G.parts.push({ x: it.x + 10, y: it.y + 12, vx: 0, vy: 0, g: 0, life: 0.45, max: 0.45, c: '#ffffff', r: 6, grow: 34, ring: true });
      if (it.kind === 'sauce') { P.power = 1; sfx.power(); G.msg = 'HOT SAUCE!'; G.sub = IS_TOUCH ? 'TAP B TO THROW' : 'PRESS X OR SHIFT TO THROW'; G.msgT = 1.8; }
      else if (it.kind === 'shake') { P.rushT = 9; sfx.power(); G.msg = 'SUGAR RUSH!'; G.sub = 'YOU’RE UNSTOPPABLE'; G.msgT = 1.6; }
      else { if (P.hearts < 3) P.hearts++; sfx.life(); G.msg = 'PIECE OF PIE'; G.sub = P.hearts >= 3 ? 'FULL HEALTH' : '+1 HEART'; G.msgT = 1.4; }
      buzz(30);
    }
  }
  L.items = L.items.filter(i => !i.gone);
}
function updateShots(dt) {
  for (const s of L.shots) {
    s.t -= dt; s.vy = Math.min(MAX_FALL, s.vy + 1500 * dt);
    moveBody(s, dt, true);
    if (s.ground) s.vy = -320;
    if (s.wall || s.t <= 0 || s.y > FIELD) { s.dead = true; burst(s.x + 6, s.y + 6, ['#ff4a2a', '#ffb347'], 6, 120); continue; }
    for (const e of L.enemies) if (!e.dead && e.active && overlap(s, e)) { s.dead = true; killEnemy(e, 'flip'); sfx.stomp(); break; }
    for (const t of L.eshots) if (!s.dead && overlap(s, t)) { s.dead = t.dead = true; addScore(100); pop(t.x, t.y, '100'); }
    const b = L.boss;
    if (!s.dead && b && b.state === 'fight' && overlap(s, b)) { s.dead = true; damageBoss(1); }
  }
  L.shots = L.shots.filter(s => !s.dead);
}
function updateCamera(dt) {
  const target = P.x + P.w / 2 - W * 0.42 + P.face * 36;
  cam.x += (target - cam.x) * Math.min(1, dt * 5);
  cam.x = clamp(cam.x, cam.minX, Math.max(cam.minX, L.pw - W));
}
function update(dt) {
  G.t += dt; G.stateT += dt; G.irisT = (G.irisT || 0) + dt;
  if (G.state === 'title') G.titleT += dt;
  musicTick();
  if (G.state === 'over' && G.stateT > 1.2 && !G.entryHandled) { G.entryHandled = true; if (qualifies(G.score)) openEntry(); }
  if (G.state === 'paused' || G.state === 'tips' || G.state === 'title' || G.state === 'over') return;
  for (const p of G.parts) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; if (p.spin !== undefined) p.spin += dt * 8; }
  G.parts = G.parts.filter(p => p.life > 0);
  for (const p of G.pops) { p.t -= dt; p.y -= 30 * dt; } G.pops = G.pops.filter(p => p.t > 0);
  if (G.shake > 0) G.shake -= dt;
  if (G.freezeT > 0) { G.freezeT -= dt; return; } // stomp freeze frame
  if (G.msgT > 0) G.msgT -= dt;
  for (const b of L.bumps) b.t += dt; L.bumps = L.bumps.filter(b => b.t < 0.2);
  for (const c of L.coinPops) { c.t += dt; c.vy += 1500 * dt; c.y += c.vy * dt; } L.coinPops = L.coinPops.filter(c => c.t < 0.55);
  if (G.state === 'intro') {
    if (G.stateT > 2.2) { G.state = 'play'; G.stateT = 0; G.irisT = 0; musicStart(L.arena && L.arena.on); }
    return;
  }
  if (G.state === 'dying') {
    P.vy += 1500 * dt; P.y += P.vy * dt;
    if (G.stateT > 2.6) { G.lives--; if (G.lives <= 0) gameOver(); else startLevel(); }
    return;
  }
  if (G.state === 'clear') { updateClear(dt); return; }
  if (G.state === 'win') { updateWin(dt); return; }
  // play
  // run physics in small fixed steps so fast falls never tunnel through floors
  let steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
  for (let i = 0; i < steps && G.state === 'play'; i++) {
    updatePlatforms(h);
    updateHero(h);
    if (G.state !== 'play') break;
    updateEnemies(h);
    updateBoss(h);
    updateItems(h);
    updateShots(h);
  }
  if (G.state !== 'play') return;
  updateCamera(dt);
  G.time -= dt;
  if (G.time <= 0) { G.time = 0; G.msg = 'TIME’S UP!'; G.msgT = 2; killHero(); return; }
  // tip coins
  for (const k of L.coins) if (!k.got && Math.abs(k.x - (P.x + P.w / 2)) < 18 && Math.abs(k.y - (P.y + P.h / 2)) < 22) { k.got = true; addTip(k.x, k.y); }
  // checkpoints
  for (const k of L.checks) if (!k.on && P.x > k.x) { k.on = true; G.checkX = k.x; sfx.check(); pop(k.x + 16, k.y - 80, 'CHECKPOINT', '#7af0ff'); }
  // the jukebox ends the level
  if (L.goal && overlap(P, L.goal)) {
    G.state = 'clear'; G.stateT = 0; G.tallyT = 0; musicStop(); sfx.clear(); P.vx = 0; P.rushT = 0; buzz([30, 40, 30]);
    addScore(2000); pop(L.goal.x + T, L.goal.y - 10, '2000');
  }
}
function tallyTime(dt) {
  G.tallyT += dt;
  while (G.tallyT > 0.012 && G.time >= 1) { G.tallyT -= 0.012; G.time -= 1; addScore(10); if (Math.floor(G.time) % 4 === 0) sfx.tally(); }
  if (G.time < 1) G.time = 0;
}
function nextLevel() { G.levelNum++; G.checkX = null; startLevel(); }
function updateClear(dt) {
  // Frankie settles to the floor and dances while the time bonus counts up.
  P.vy = Math.min(MAX_FALL, P.vy + GRAV_DOWN * dt); P.vx = 0; moveBody(P, dt); onPlatforms(P, P.y + P.h);
  if (G.stateT > 0.8) tallyTime(dt);
  if (G.stateT > 6.5 && G.time <= 0) nextLevel();
}
function updateWin(dt) {
  P.vy = Math.min(MAX_FALL, P.vy + GRAV_DOWN * dt); moveBody(P, dt);
  cam.x += (clamp(L.pw - W, cam.minX, L.pw) - cam.x) * Math.min(1, dt * 2.5);
  const d = L.dottie;
  if (G.stateT > 0.8) d.open = Math.min(1, d.open + dt * 1.5);
  if (G.stateT > 1.8) d.out = Math.min(1, d.out + dt * 0.45);
  // Frankie walks to meet her
  const meetX = d.x - 3 * T - lerp(0, 2 * T, d.out);
  if (G.stateT > 1.8 && P.x < meetX - 30) { P.x += 90 * dt; P.face = 1; P.anim += 90 * dt * 0.06; }
  if (G.stateT > 4.4 && !G.winBonus) {
    G.winBonus = true; sfx.kiss(); addScore(10000 * (1 + L.loop)); pop(P.x + 9, P.y - 40, String(10000 * (1 + L.loop)), '#ff7ad9');
    for (let i = 0; i < 18; i++) G.parts.push({ x: P.x + 20 + Math.random() * 30, y: P.y - 10, vx: (Math.random() - 0.5) * 80, vy: -60 - Math.random() * 90, g: -20, life: 1.6 + Math.random(), c: '#ff4f8a', r: 5, heart: true });
  }
  if (G.stateT > 5) tallyTime(dt);
  if (G.stateT > 10.5 && G.time <= 0) { G.winBonus = false; nextLevel(); }
}

/* ---------------- drawing helpers ---------------- */
function rr(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function circle(x, y, r, c) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); }
function ellipse(x, y, rx, ry, c, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); }
function lin(x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of stops) g.addColorStop(o, c); return g; }
function rad(x, y, r0, r1, stops) { const g = ctx.createRadialGradient(x, y, r0, x, y, r1); for (const [o, c] of stops) g.addColorStop(o, c); return g; }
function glow(x, y, r, rgb, a) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rad(x, y, 0, r, [[0, `rgba(${rgb},${a})`], [1, `rgba(${rgb},0)`]]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function text(s, x, y, size, color, align = 'center', weight = '800', spacing = 0) {
  ctx.font = `${weight} ${size}px ${UI_FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = spacing + 'px';
  ctx.fillStyle = color; ctx.fillText(s, x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
function bigText(s, x, y, size, top = '#fff6e0', bottom = '#ff5f9e', stroke = '#3a0a26') {
  ctx.save();
  ctx.font = `900 ${size}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size / 7); ctx.strokeStyle = stroke; ctx.strokeText(s, x, y + size * 0.06);
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = size * 0.3; ctx.shadowOffsetY = size * 0.08;
  ctx.fillStyle = lin(0, y - size / 2, 0, y + size / 2, [[0, top], [1, bottom]]); ctx.fillText(s, x, y);
  ctx.shadowColor = 'transparent'; ctx.lineWidth = Math.max(1, size / 30); ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.strokeText(s, x, y);
  ctx.restore();
}
function glassButton(x, y, w, h, active = false) {
  rr(x, y, w, h, h / 2);
  ctx.fillStyle = lin(0, y, 0, y + h, active ? [[0, 'rgba(255,120,180,.6)'], [1, 'rgba(200,40,100,.5)']] : [[0, 'rgba(255,255,255,.16)'], [1, 'rgba(255,255,255,.05)']]);
  ctx.fill(); ctx.strokeStyle = active ? 'rgba(255,190,220,.8)' : 'rgba(255,220,235,.45)'; ctx.lineWidth = 1.5; ctx.stroke();
}
function panel(x, y, w, h) {
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 8;
  rr(x, y, w, h, 18); ctx.fillStyle = lin(0, y, 0, y + h, [[0, 'rgba(46,14,40,.94)'], [1, 'rgba(18,6,20,.96)']]); ctx.fill();
  ctx.restore();
  ctx.save(); rr(x, y, w, h, 18); ctx.clip(); ctx.fillStyle = lin(0, y, 0, y + 60, [[0, 'rgba(255,255,255,.09)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(x, y, w, 60); ctx.restore();
  rr(x, y, w, h, 18); ctx.strokeStyle = 'rgba(255,150,200,.45)'; ctx.lineWidth = 1.5; ctx.stroke();
  rr(x + 5, y + 5, w - 10, h - 10, 14); ctx.strokeStyle = 'rgba(122,240,255,.18)'; ctx.lineWidth = 1; ctx.stroke();
}
function iconSpeaker(cx, cy, off) {
  ctx.fillStyle = off ? '#9a8a96' : '#ffffff';
  ctx.beginPath(); ctx.moveTo(cx - 8, cy - 3.5); ctx.lineTo(cx - 4, cy - 3.5); ctx.lineTo(cx + 1, cy - 8); ctx.lineTo(cx + 1, cy + 8); ctx.lineTo(cx - 4, cy + 3.5); ctx.lineTo(cx - 8, cy + 3.5); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = off ? '#ff6a5a' : '#ffffff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  if (off) { ctx.beginPath(); ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx + 10, cy + 4); ctx.moveTo(cx + 10, cy - 4); ctx.lineTo(cx + 4, cy + 4); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(cx + 2, cy, 5, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + 2, cy, 9, -0.8, 0.8); ctx.stroke(); }
}
function starShape(x, y, r, c) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); }
  ctx.closePath(); ctx.fillStyle = c; ctx.fill();
}
function heartShape(x, y, s, c) {
  ctx.beginPath(); ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x, y - s * 0.15, x - s * 0.6, y - s * 0.15, x - s * 0.6, y + s * 0.2);
  ctx.bezierCurveTo(x - s * 0.6, y + s * 0.55, x - s * 0.1, y + s * 0.75, x, y + s);
  ctx.bezierCurveTo(x + s * 0.1, y + s * 0.75, x + s * 0.6, y + s * 0.55, x + s * 0.6, y + s * 0.2);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 0.15, x, y - s * 0.15, x, y + s * 0.35);
  ctx.fillStyle = c; ctx.fill();
}
// Cached sprites are drawn once at screen resolution and then blitted.
const spriteCache = new Map();
function sprite(key, w, h, drawFn) {
  let c = spriteCache.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
    const saved = ctx; ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawFn(w, h); ctx = saved;
    spriteCache.set(key, c);
  }
  return c;
}

/* ---------------- tiles ---------------- */
const THEME = {
  kitchen: { name: 'kitchen', topA: '#f4f1e8', topB: '#24242c', fill: '#4b5160', fill2: '#3c414e', shelf: '#b07a45', shelf2: '#7a4f28' },
  diner:   { name: 'diner', topA: '#f6f0e2', topB: '#c8203a', fill: '#3b2430', fill2: '#2e1a24', shelf: '#dfe4ec', shelf2: '#8c93a0' },
  alley:   { name: 'alley', topA: '#5a5a66', topB: '#4a4a55', fill: '#2c2c36', fill2: '#24242c', shelf: '#6a6f7c', shelf2: '#3a3e48' },
  grill:   { name: 'grill', topA: '#3c3232', topB: '#2a2222', fill: '#1f1717', fill2: '#171111', shelf: '#57504c', shelf2: '#2a2422' },
};
function drawGroundTile(th, top) {
  // body: two rows of square tiles with grout, bevels and a little wear
  const bevel = (x, y, w, h, base, hi, lo) => {
    ctx.fillStyle = base; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = hi; ctx.fillRect(x, y, w, 1.5); ctx.fillRect(x, y, 1.5, h);
    ctx.fillStyle = lo; ctx.fillRect(x, y + h - 1.5, w, 1.5); ctx.fillRect(x + w - 1.5, y, 1.5, h);
  };
  ctx.fillStyle = '#0e0a10'; ctx.fillRect(0, 0, T, T);
  if (th.name === 'alley') {
    ctx.fillStyle = lin(0, 0, 0, T, [[0, '#34343e'], [1, '#26262e']]); ctx.fillRect(0, 0, T, T);
    const r = seeded(top ? 3 : 9);
    for (let i = 0; i < 14; i++) { ctx.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.06})`; ctx.fillRect(r() * T, r() * T, 1.5, 1.5); }
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(4, 30); ctx.lineTo(10, 22); ctx.lineTo(9, 16); ctx.stroke();
  } else if (th.name === 'grill') {
    bevel(0.5, 0.5, T - 1, T - 1, '#2a2020', 'rgba(255,200,170,.12)', 'rgba(0,0,0,.5)');
    for (const [x, y] of [[4, 4], [T - 4, 4], [4, T - 4], [T - 4, T - 4]]) { circle(x, y, 1.6, '#120c0a'); circle(x - 0.4, y - 0.4, 0.8, '#6a5a52'); }
    ctx.fillStyle = 'rgba(255,110,40,.08)'; ctx.fillRect(0, T - 8, T, 8);
  } else {
    const base = th.name === 'kitchen' ? ['#556071', '#4b5565'] : ['#4a2a36', '#40242f'];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) bevel(i * 16 + 0.5, j * 16 + 0.5, 15, 15, base[(i + j) % 2], 'rgba(255,255,255,.12)', 'rgba(0,0,0,.28)');
  }
  if (!top) return;
  // top lip with a shadow under it
  ctx.fillStyle = lin(0, 12, 0, 22, [[0, 'rgba(0,0,0,.45)'], [1, 'rgba(0,0,0,0)']]); ctx.fillRect(0, 12, T, 10);
  if (th.name === 'kitchen' || th.name === 'diner') {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? th.topB : th.topA; ctx.fillRect(i * 8, j * 5, 8, 5); }
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, 0, T, 1);
    ctx.fillStyle = lin(0, 10, 0, 14, [[0, '#f4f6fa'], [1, '#8a92a0']]); ctx.fillRect(0, 10, T, 4);
  } else if (th.name === 'alley') {
    ctx.fillStyle = lin(0, 0, 0, 10, [[0, '#a2a2aa'], [1, '#5c5c66']]); ctx.fillRect(0, 0, T, 10);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(15, 0, 1, 10); ctx.fillRect(31, 0, 1, 10);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(0, 0, T, 1);
  } else {
    ctx.fillStyle = '#1a1414'; ctx.fillRect(0, 0, T, 11);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = lin(0, 0, 0, 11, [[0, '#8a7a70'], [0.5, '#4a3c36'], [1, '#2a201c']]); rr(i * 8 + 1, 0, 6, 11, 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,120,40,.55)'; ctx.fillRect(0, 11, T, 1.5);
  }
}
function drawBlockTile(th) {
  if (th.name === 'kitchen') {
    ctx.fillStyle = lin(0, 0, T, T, [[0, '#f2f5f9'], [0.5, '#b8c0cc'], [1, '#8b94a2']]); rr(0.5, 0.5, T - 1, T - 1, 3); ctx.fill();
    ctx.strokeStyle = '#6a7280'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(3, 2, T - 6, 2);
    for (const [x, y] of [[5, 6], [T - 5, 6], [5, T - 5], [T - 5, T - 5]]) { circle(x, y, 1.6, '#5a626e'); circle(x - 0.4, y - 0.4, 0.7, '#fff'); }
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.moveTo(8, 26); ctx.lineTo(24, 10); ctx.stroke();
  } else if (th.name === 'diner') {
    // cream Formica with the classic boomerang pattern, wrapped in chrome
    ctx.fillStyle = lin(0, 0, 0, T, [[0, '#fff3cf'], [1, '#e8d39a']]); ctx.fillRect(0, 0, T, T);
    const boom = (x, y, rot, c) => { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.strokeStyle = c; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-5, 2); ctx.quadraticCurveTo(0, -4, 5, 2); ctx.stroke(); ctx.restore(); };
    boom(9, 13, 0.4, '#e8455a'); boom(22, 21, -0.6, '#2aa8a0'); boom(12, 25, 2.2, '#2a2a30'); boom(24, 11, 1.4, '#e8455a');
    circle(18, 16, 1, '#2a2a30'); circle(6, 20, 1, '#2aa8a0'); circle(27, 27, 1, '#2a2a30');
    ctx.fillStyle = lin(0, 0, 0, 6, [[0, '#ffffff'], [1, '#8a92a0']]); ctx.fillRect(0, 0, T, 5);
    ctx.fillStyle = lin(0, T - 5, 0, T, [[0, '#d8dde6'], [1, '#7a828e']]); ctx.fillRect(0, T - 5, T, 5);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 5, T, 1); ctx.fillRect(T - 1, 0, 1, T);
  } else if (th.name === 'alley') {
    ctx.fillStyle = '#5a2620'; ctx.fillRect(0, 0, T, T);
    for (let r = 0; r < 4; r++) for (let c = -1; c < 3; c++) {
      const x = c * 16 + (r % 2) * 8, y = r * 8;
      ctx.fillStyle = ['#a8483a', '#94402f', '#b45442', '#8a3a2c'][(r + c + 4) % 4]; ctx.fillRect(x + 1, y + 1, 14, 6);
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x + 1, y + 1, 14, 1);
    }
  } else {
    ctx.fillStyle = lin(0, 0, 0, T, [[0, '#4a403c'], [1, '#221a18']]); rr(0.5, 0.5, T - 1, T - 1, 3); ctx.fill();
    ctx.strokeStyle = '#120c0a'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,120,40,.5)'; ctx.fillRect(1, T - 3, T - 2, 2);
    for (const [x, y] of [[6, 6], [T - 6, 6], [6, T - 8], [T - 6, T - 8]]) { circle(x, y, 2.2, '#2a201c'); circle(x - 0.5, y - 0.5, 1, '#7a6a62'); }
  }
}
function drawShelfTile(th) {
  if (th.name === 'alley' || th.name === 'grill') {
    ctx.fillStyle = th.shelf2; ctx.fillRect(0, 0, T, 9);
    ctx.strokeStyle = th.shelf; ctx.lineWidth = 1.5;
    for (let i = 0; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(i * 4, 0); ctx.lineTo(i * 4 + 4, 9); ctx.stroke(); }
    ctx.fillStyle = th.shelf; ctx.fillRect(0, 0, T, 2); ctx.fillRect(0, 8, T, 2);
    if (th.name === 'grill') { ctx.strokeStyle = '#3a3330'; ctx.lineWidth = 2; ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(16, -T); ctx.stroke(); ctx.setLineDash([]); }
  } else {
    ctx.fillStyle = lin(0, 0, 0, 10, [[0, th.shelf], [1, th.shelf2]]); rr(0, 0, T, 9, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(1, 1, T - 2, 1.5);
    ctx.fillStyle = th.shelf2; ctx.beginPath(); ctx.moveTo(10, 9); ctx.lineTo(16, 9); ctx.lineTo(10, 18); ctx.closePath(); ctx.fill();
  }
}
function drawCrate() {
  ctx.fillStyle = lin(0, 0, 0, T, [[0, '#d9a868'], [1, '#a8743c']]); rr(1, 1, T - 2, T - 2, 2); ctx.fill();
  ctx.strokeStyle = '#6e4620'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, T - 4, T - 4);
  ctx.beginPath(); ctx.moveTo(3, 3); ctx.lineTo(T - 3, T - 3); ctx.stroke();
  ctx.fillStyle = 'rgba(110,70,32,.9)'; ctx.font = `900 7px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('FLOUR', 16, 10);
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(3, 3, T - 6, 1);
}
function drawJar(used) {
  ctx.fillStyle = used ? '#6a5e58' : lin(0, 0, 0, 6, [[0, '#ffe07a'], [1, '#c99a1a']]); rr(6, 1, 20, 6, 2); ctx.fill();
  ctx.fillStyle = used ? 'rgba(150,170,180,.35)' : 'rgba(190,235,255,.45)'; rr(4, 6, 24, 25, 6); ctx.fill();
  ctx.strokeStyle = used ? 'rgba(200,210,220,.4)' : 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5; ctx.stroke();
  if (!used) {
    for (const [x, y] of [[11, 26], [17, 27], [22, 25], [14, 22], [20, 21]]) { ellipse(x, y, 4, 2.2, '#f6c22e'); ellipse(x, y - 0.6, 3, 1.2, '#ffe680'); }
    ctx.fillStyle = '#fff4dc'; rr(7, 11, 18, 8, 2); ctx.fill();
    ctx.fillStyle = '#c8203a'; ctx.font = `900 7px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('TIPS', 16, 15.5);
  }
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(7, 9, 2, 18);
}
function drawForks() {
  ctx.fillStyle = lin(0, 0, 0, T, [[0, '#9aa2ae'], [1, '#5a616c']]); ctx.fillRect(0, 18, T, 14);
  ctx.fillStyle = '#c9d0da'; ctx.fillRect(0, 18, T, 2);
  for (let i = 0; i < 4; i++) {
    const x = 4 + i * 8;
    ctx.fillStyle = lin(x - 2, 0, x + 2, 0, [[0, '#f4f6fa'], [1, '#8a92a0']]);
    ctx.beginPath(); ctx.moveTo(x - 2, 18); ctx.lineTo(x - 1, 6); ctx.lineTo(x, 2); ctx.lineTo(x + 1, 6); ctx.lineTo(x + 2, 18); ctx.closePath(); ctx.fill();
  }
}
function drawGriddle() {
  ctx.fillStyle = lin(0, 0, 0, T, [[0, '#2a2a30'], [1, '#121216']]); ctx.fillRect(0, 0, T, T);
  ctx.fillStyle = '#4a4a52'; ctx.fillRect(0, 0, T, 3);
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(T, 8); ctx.stroke();
  circle(16, 20, 4, '#3a3a42'); circle(16, 20, 2, '#888');
}
function drawGate() {
  ctx.fillStyle = 'rgba(20,10,10,.5)'; ctx.fillRect(4, 0, 24, T);
  for (let i = 0; i < 3; i++) { ctx.fillStyle = lin(0, 0, 4, 0, [[0, '#8a8a92'], [1, '#3a3a42']]); ctx.fillRect(6 + i * 8, 0, 4, T); }
  ctx.fillStyle = '#5a5a62'; ctx.fillRect(4, 12, 24, 4);
}
function tileSprite(t, top) {
  const th = THEME[L.theme];
  return sprite(th.name + ':' + t + ':' + (top ? 1 : 0), T, T, () => {
    if (t === 1) drawGroundTile(th, top);
    else if (t === 2) drawBlockTile(th);
    else if (t === 3) drawShelfTile(th);
    else if (t === 4) drawCrate();
    else if (t >= 5 && t <= 8) drawJar(false);
    else if (t === USED) drawJar(true);
    else if (t === 11) drawGriddle();
    else if (t === 12) drawForks();
    else if (t === GATE) drawGate();
  });
}
function drawFryer(c, r, top) {
  const x = c * T, y = r * T;
  if (top) {
    ctx.fillStyle = '#3a3e48'; ctx.fillRect(x, y, T, 10);
    const sy = y + 12 + Math.sin(G.t * 3 + c) * 1.2;
    ctx.fillStyle = lin(0, sy, 0, y + T, [[0, '#ffd56a'], [1, '#d88a1a']]); ctx.fillRect(x, sy, T, y + T - sy);
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(x, sy, T, 1.5);
    for (let i = 0; i < 2; i++) {
      const ph = (G.t * 1.3 + c * 0.37 + i * 0.5) % 1;
      circle(x + 8 + ((c * 13 + i * 11) % 18), sy + 12 - ph * 10, 1.5 + ph * 2.5, `rgba(255,240,190,${0.8 - ph * 0.6})`);
    }
  } else { ctx.fillStyle = lin(0, y, 0, y + T, [[0, '#d88a1a'], [1, '#a85a10']]); ctx.fillRect(x, y, T, T); }
}
function drawGriddleFlames(c, r) {
  const x = c * T, y = r * T, ph = (G.t + Math.floor(c / 3) * 1.1) % 3.3;
  if (ph > 3.0) { ctx.fillStyle = `rgba(255,120,40,${(ph - 3) * 2})`; ctx.fillRect(x, y - 2, T, 3); }
  if (ph >= 1.2) return;
  const k = Math.min(1, ph * 6, (1.2 - ph) * 6);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const fx = x + 6 + i * 10, h = (18 + Math.sin(G.t * 20 + i + c) * 5) * k;
    ctx.fillStyle = lin(0, y - h, 0, y, [[0, 'rgba(255,240,140,0)'], [0.4, 'rgba(255,170,40,.8)'], [1, 'rgba(255,80,20,.9)']]);
    ctx.beginPath(); ctx.moveTo(fx - 5, y); ctx.quadraticCurveTo(fx - 4, y - h * 0.5, fx, y - h); ctx.quadraticCurveTo(fx + 4, y - h * 0.5, fx + 5, y); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/* ---------------- backgrounds (two parallax layers per theme, drawn once) ---------------- */
const BGW = 1024;
function seeded(n) { let s = n; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function drawNeonText(s, x, y, size, color, rgb) {
  ctx.save(); ctx.font = `900 ${size}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = `rgba(${rgb},.9)`; ctx.shadowBlur = size * 0.6; ctx.fillStyle = color; ctx.fillText(s, x, y);
  ctx.shadowBlur = size * 0.2; ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.6; ctx.fillText(s, x, y); ctx.restore();
}
function bgFar(theme) {
  return sprite('far:' + theme, BGW, FIELD, (w, h) => {
    const rnd = seeded(7);
    if (theme === 'kitchen') {
      ctx.fillStyle = '#dcefe9'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#bfdcd5'; ctx.lineWidth = 1;
      for (let y = 0; y < h; y += 12) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); for (let x = (y / 12) % 2 * 12; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + 12); ctx.stroke(); } }
      ctx.fillStyle = '#2a8a86'; ctx.fillRect(0, 150, w, 8); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 150, w, 2);
      for (let i = 0; i < Math.ceil(w / 320); i++) {
        const x = 70 + i * 320; ctx.fillStyle = '#f8f6ee'; rr(x, 30, 150, 100, 6); ctx.fill();
        ctx.fillStyle = lin(0, 36, 0, 124, [[0, '#8fd0ff'], [1, '#d9f1ff']]); ctx.fillRect(x + 8, 38, 134, 84);
        ctx.fillStyle = 'rgba(255,255,255,.8)'; ellipse(x + 40, 70, 18, 7, '#fff'); ellipse(x + 100, 56, 22, 8, '#fff');
        ctx.fillStyle = '#f8f6ee'; ctx.fillRect(x + 73, 38, 4, 84); ctx.fillRect(x + 8, 78, 134, 4);
        ctx.fillStyle = '#e8455a'; for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(x - 6 + k * 27, 26); ctx.lineTo(x + 21 + k * 27, 26); ctx.lineTo(x + 7.5 + k * 27, 40); ctx.closePath(); ctx.fill(); }
      }
    } else if (theme === 'diner') {
      ctx.fillStyle = lin(0, 0, 0, h, [[0, '#6fd0c4'], [0.6, '#56b8ad']]); ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < Math.floor(w / 214); i++) {
        const x = 30 + i * 214; ctx.fillStyle = '#e8ecf2'; rr(x, 40, 170, 120, 10); ctx.fill();
        ctx.fillStyle = lin(0, 48, 0, 152, [[0, '#0c1238'], [1, '#2a1a4a']]); rr(x + 8, 48, 154, 104, 6); ctx.fill();
        for (let s = 0; s < 14; s++) circle(x + 12 + rnd() * 146, 52 + rnd() * 50, rnd() * 1.2 + 0.3, '#fff');
        ctx.fillStyle = '#1a1030'; ctx.fillRect(x + 8, 118, 154, 34);
        for (let b = 0; b < 6; b++) { ctx.fillStyle = '#20163a'; ctx.fillRect(x + 10 + b * 26, 100 - rnd() * 30, 22, 60); }
        drawNeonText(['EAT', 'MOTEL', 'GAS', 'BOWL'][i % 4], x + 85, 94, 18, ['#ff5fa0', '#7af0ff', '#fff27a', '#ff9a4a'][i % 4], ['255,95,160', '122,240,255', '255,242,122', '255,154,74'][i % 4]);
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.moveTo(x + 20, 48); ctx.lineTo(x + 60, 48); ctx.lineTo(x + 20, 120); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = lin(0, 0, 0, 14, [[0, '#ffffff'], [1, '#8a92a0']]); ctx.fillRect(0, 186, w, 10);
      ctx.fillStyle = lin(0, 196, 0, h, [[0, '#d0283f'], [1, '#8a1426']]); ctx.fillRect(0, 196, w, h - 196);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; for (let x = 0; x < w; x += 20) ctx.fillRect(x, 196, 2, h - 196);
    } else if (theme === 'alley') {
      ctx.fillStyle = lin(0, 0, 0, h, [[0, '#120a2a'], [0.6, '#3a1a4a'], [1, '#5a2a4a']]); ctx.fillRect(0, 0, w, h);
      for (let s = 0; s < 110; s++) circle(rnd() * w, rnd() * 180, rnd() * 1.1 + 0.3, `rgba(255,255,255,${0.4 + rnd() * 0.6})`);
      circle(760, 60, 26, '#fff6d8'); glow(760, 60, 70, '255,240,200', 0.25); circle(770, 54, 22, 'rgba(18,10,42,.15)');
      let x = 0;
      while (x < w) {
        const bw = 50 + rnd() * 70, bh = 120 + rnd() * 140; ctx.fillStyle = '#1a1230'; ctx.fillRect(x, h - bh, bw, bh);
        for (let wy = h - bh + 10; wy < h - 20; wy += 16) for (let wx = x + 6; wx < x + bw - 8; wx += 12) if (rnd() < 0.35) { ctx.fillStyle = rnd() < 0.5 ? '#ffd27a' : '#ffefb0'; ctx.fillRect(wx, wy, 6, 8); }
        x += bw + 4;
      }
      drawNeonText('DRIVE-IN', 140, 120, 20, '#7af0ff', '122,240,255'); drawNeonText('BOWL', 430, 150, 18, '#ff5fa0', '255,95,160');
    } else {
      ctx.fillStyle = lin(0, 0, 0, h, [[0, '#1a0806'], [0.7, '#4a1408'], [1, '#7a2a0a']]); ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 14; i++) { const x = rnd() * w, y = 40 + rnd() * 160, r = 30 + rnd() * 50; ellipse(x, y, r, r * 0.6, 'rgba(60,40,36,.35)'); }
      for (let i = 0; i < Math.ceil(w / 130); i++) {
        const x = 20 + i * 130; ctx.fillStyle = '#2a1e1a'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 100, 0); ctx.lineTo(x + 80, 60); ctx.lineTo(x + 20, 60); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#3a2a24'; ctx.fillRect(x + 20, 58, 60, 6);
      }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = lin(0, h - 120, 0, h, [[0, 'rgba(255,90,20,0)'], [1, 'rgba(255,120,30,.45)']]); ctx.fillRect(0, h - 120, w, 120); ctx.restore();
    }
  });
}
function bgMid(theme) {
  return sprite('mid:' + theme, BGW, FIELD, (w, h) => {
    const rnd = seeded(11), floorY = 10 * T;
    if (theme === 'kitchen') {
      ctx.fillStyle = '#8a929e'; ctx.fillRect(0, 24, w, 4);
      for (let i = 0; i < Math.floor(w / 80); i++) {
        const x = 30 + i * 80 + rnd() * 20, r = 10 + rnd() * 8, y = 34 + rnd() * 18;
        ctx.strokeStyle = '#6a727e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, 26); ctx.lineTo(x, y - r); ctx.stroke();
        if (i % 2) { ellipse(x, y, r, r, '#3a3e48'); ellipse(x - 3, y - 3, r * 0.5, r * 0.4, 'rgba(255,255,255,.15)'); ctx.fillStyle = '#3a3e48'; ctx.fillRect(x + r - 2, y - 2, 16, 4); }
        else { ctx.fillStyle = lin(x - r, 0, x + r, 0, [[0, '#d07a3a'], [0.5, '#f0a060'], [1, '#a0582a']]); rr(x - r, y - r * 0.7, r * 2, r * 1.5, 4); ctx.fill(); ctx.fillStyle = '#7a3a1a'; ctx.fillRect(x - r - 5, y - r * 0.5, 5, 3); ctx.fillRect(x + r, y - r * 0.5, 5, 3); }
      }
      // order ticket rail
      ctx.fillStyle = '#b8c0cc'; ctx.fillRect(0, 118, w, 4);
      for (let i = 0; i < Math.floor(w / 64); i++) { const x = 20 + i * 64 + rnd() * 20, h2 = 22 + rnd() * 8; ctx.save(); ctx.translate(x, 120); ctx.rotate((rnd() - 0.5) * 0.12); ctx.fillStyle = '#fffbe8'; ctx.fillRect(-9, 0, 18, h2); ctx.fillStyle = 'rgba(60,60,80,.35)'; for (let l = 0; l < 4; l++) ctx.fillRect(-6, 5 + l * 4, 8 + rnd() * 4, 1.2); ctx.restore(); }
      // wall clock
      circle(560, 70, 20, '#2a2a30'); circle(560, 70, 17, '#fffbe8'); ctx.strokeStyle = '#2a2a30'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(560, 70); ctx.lineTo(560, 58); ctx.moveTo(560, 70); ctx.lineTo(569, 74); ctx.stroke(); circle(560, 70, 2, '#c8203a');
      // ranges
      for (let i = 0; i < Math.floor(w / 160); i++) {
        const x = 14 + i * 160, w2 = 132, y = floorY - 92;
        ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x + 4, y + 4, w2, 92);
        ctx.fillStyle = lin(0, y, 0, floorY, [[0, '#e8ecf2'], [0.5, '#c4cad4'], [1, '#9aa2ae']]); rr(x, y + 8, w2, 84, 3); ctx.fill();
        ctx.fillStyle = '#26262c'; rr(x - 2, y, w2 + 4, 10, 2); ctx.fill();
        ctx.strokeStyle = '#4a4a52'; ctx.lineWidth = 1.5; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(x + 20 + k * 31, y + 2, 9, Math.PI, 0); ctx.stroke(); }
        ctx.fillStyle = '#2a2a30'; ctx.fillRect(x, y + 10, w2, 12);
        for (let k = 0; k < 5; k++) { circle(x + 16 + k * 25, y + 16, 4, '#d8dde6'); circle(x + 16 + k * 25, y + 16, 1.6, '#3a3e48'); }
        ctx.fillStyle = lin(0, y + 28, 0, y + 32, [[0, '#ffffff'], [1, '#8a92a0']]); rr(x + 14, y + 28, w2 - 28, 4, 2); ctx.fill();
        ctx.fillStyle = '#16161c'; rr(x + 14, y + 36, w2 - 28, 40, 4); ctx.fill();
        ctx.fillStyle = rad(x + w2 / 2, y + 66, 4, 50, [[0, 'rgba(255,170,70,.75)'], [1, 'rgba(255,120,40,.12)']]); rr(x + 18, y + 40, w2 - 36, 32, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(255,200,120,.5)'; ctx.lineWidth = 1; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x + 22, y + 50 + k * 8); ctx.lineTo(x + w2 - 22, y + 50 + k * 8); ctx.stroke(); }
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.moveTo(x + 20, y + 40); ctx.lineTo(x + 46, y + 40); ctx.lineTo(x + 30, y + 72); ctx.lineTo(x + 20, y + 72); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2a2a30'; ctx.fillRect(x + 6, floorY - 6, 8, 6); ctx.fillRect(x + w2 - 14, floorY - 6, 8, 6);
      }
    } else if (theme === 'diner') {
      for (let i = 0; i < Math.floor(w / 160); i++) {
        const x = 20 + i * 160;
        ctx.strokeStyle = '#2a2a30'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 70, 0); ctx.lineTo(x + 70, 30); ctx.stroke();
        ctx.fillStyle = '#e8455a'; ctx.beginPath(); ctx.moveTo(x + 56, 42); ctx.lineTo(x + 84, 42); ctx.lineTo(x + 76, 30); ctx.lineTo(x + 64, 30); ctx.closePath(); ctx.fill();
        glow(x + 70, 46, 40, '255,230,160', 0.35);
        const by = floorY - 70;
        ctx.fillStyle = lin(0, by, 0, by + 60, [[0, '#ff5f6e'], [1, '#a8142c']]); rr(x, by, 26, 70, 8); ctx.fill(); rr(x + 114, by, 26, 70, 8); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.25)'; for (let k = 0; k < 3; k++) { ctx.fillRect(x + 6 + k * 6, by + 6, 2, 56); ctx.fillRect(x + 120 + k * 6, by + 6, 2, 56); }
        ctx.fillStyle = '#e6e9ef'; ctx.fillRect(x + 30, floorY - 40, 80, 6); ctx.fillStyle = '#9aa2ae'; ctx.fillRect(x + 66, floorY - 34, 8, 34);
        ctx.fillStyle = '#fff'; ctx.fillRect(x + 40, floorY - 50, 10, 10); ctx.fillStyle = '#c8203a'; ctx.fillRect(x + 88, floorY - 56, 6, 16);
      }
      circle(320, 20, 0, '#000');
    } else if (theme === 'alley') {
      for (let i = 0; i < Math.floor(w / 220); i++) {
        const x = i * 220, top = 60 + rnd() * 50;
        ctx.fillStyle = '#3a1c1a'; ctx.fillRect(x, top, 190, floorY - top);
        for (let y = top; y < floorY; y += 8) for (let bx = ((y - top) / 8) % 2 * 10; bx < 190; bx += 20) { ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x + bx, y, 1, 8); }
        for (let y = top; y < floorY; y += 8) { ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x, y, 190, 1); }
        ctx.strokeStyle = '#1a1a20'; ctx.lineWidth = 2;
        for (let k = 0; k < 2; k++) { const fy = top + 60 + k * 90; ctx.strokeRect(x + 30, fy, 90, 4); for (let r = 0; r < 6; r++) { ctx.beginPath(); ctx.moveTo(x + 34 + r * 16, fy); ctx.lineTo(x + 34 + r * 16, fy - 26); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(x + 30, fy - 26); ctx.lineTo(x + 120, fy - 26); ctx.stroke(); }
        ctx.fillStyle = '#ffd27a'; ctx.fillRect(x + 140, top + 40, 22, 30); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x + 150, top + 40, 2, 30);
      }
      ctx.fillStyle = '#2a4a3a'; rr(470, floorY - 48, 90, 48, 4); ctx.fill(); ctx.fillStyle = '#1e3a2c'; ctx.fillRect(466, floorY - 52, 98, 8);
      // vertical neon signs on the buildings
      [['EATS', 150, '#ff5fa0', '255,95,160'], ['CAFE', 590, '#7af0ff', '122,240,255'], ['DINER', 820, '#fff27a', '255,242,122']].forEach(([word, x, col, rgb]) => {
        const top = 70; ctx.fillStyle = '#1a1018'; rr(x - 13, top, 26, word.length * 20 + 12, 5); ctx.fill(); ctx.strokeStyle = '#3a2a38'; ctx.lineWidth = 2; ctx.stroke();
        glow(x, top + word.length * 10, 60, rgb, 0.22);
        [...word].forEach((ch, i) => drawNeonText(ch, x, top + 16 + i * 20, 16, col, rgb));
      });
      // street lamps with a pool of light
      for (const x of [300, 760]) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = lin(0, floorY - 150, 0, floorY, [[0, 'rgba(255,220,150,.28)'], [1, 'rgba(255,220,150,.04)']]);
        ctx.beginPath(); ctx.moveTo(x + 14, floorY - 150); ctx.lineTo(x + 60, floorY); ctx.lineTo(x - 32, floorY); ctx.closePath(); ctx.fill(); ctx.restore();
        ctx.fillStyle = '#1a1a22'; ctx.fillRect(x - 3, floorY - 160, 6, 160); ctx.fillRect(x - 3, floorY - 160, 22, 4);
        ctx.fillStyle = '#2a2a32'; rr(x + 6, floorY - 158, 18, 8, 3); ctx.fill(); circle(x + 15, floorY - 149, 4, '#fff2c8'); glow(x + 15, floorY - 149, 26, '255,230,170', 0.5);
      }
      for (const x of [120, 360, 700, 930]) { ctx.fillStyle = lin(x - 14, 0, x + 14, 0, [[0, '#8a929e'], [1, '#4a525e']]); rr(x - 14, floorY - 36, 28, 36, 3); ctx.fill(); ellipse(x, floorY - 37, 16, 4, '#9aa2ae'); }
    } else {
      for (let i = 0; i < Math.floor(w / 110); i++) {
        const x = 10 + i * 110; ctx.strokeStyle = '#2a201c'; ctx.lineWidth = 3; ctx.setLineDash([5, 3]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 60 + (i % 3) * 30); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#3a2a24'; ctx.beginPath(); ctx.arc(x, 66 + (i % 3) * 30, 7, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#2a1e1a'; rr(150, 120, 340, 60, 10); ctx.fill(); ctx.strokeStyle = '#5a1a10'; ctx.lineWidth = 3; ctx.stroke();
      drawNeonText('BIG GREASY’S', 320, 150, 30, '#ff4a2a', '255,74,42');
    }
  });
}
function drawBackground() {
  const th = L ? L.theme : 'diner', cx = L ? cam.x : G.t * 20;
  for (const [img, k] of [[bgFar(th), 0.25], [bgMid(th), 0.55]]) {
    let ox = -((cx * k) % BGW); if (ox > 0) ox -= BGW;
    for (let x = ox; x < W; x += BGW) ctx.drawImage(img, x, 0, BGW, FIELD);
  }
  // push the scenery back so the platforms and characters pop
  ctx.fillStyle = { kitchen: 'rgba(40,30,60,.2)', diner: 'rgba(24,8,30,.38)', alley: 'rgba(8,4,20,.38)', grill: 'rgba(0,0,0,.22)' }[th];
  ctx.fillRect(0, 0, W, FIELD);
  if (th === 'grill') {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) { const x = ((i * 137 - cx * 0.7) % (W + 100) + W + 100) % (W + 100) - 50; glow(x, FIELD - 70 + Math.sin(G.t * 3 + i) * 6, 50, '255,100,30', 0.18); }
    ctx.restore();
  }
}

/* ---------------- animated background elements ---------------- */
function drawBgAnimations(cx) {
  if (!L) return;
  const th = L.theme, t = G.t;
  ctx.save();
  if (th === 'kitchen') {
    // steam rising from pots in the background
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 5; i++) {
      const bx = ((i * 180 + 40 - cx * 0.55) % (W + 200) + W + 200) % (W + 200) - 100;
      for (let j = 0; j < 3; j++) {
        const ph = (t * 0.6 + j * 0.33 + i * 0.17) % 1;
        const sx = bx + Math.sin(t * 1.5 + j * 2 + i) * 6;
        const sy = FIELD - 60 - ph * 90;
        const r = 3 + ph * 5;
        ctx.globalAlpha = (1 - ph) * 0.2;
        ctx.fillStyle = '#e8e0d0';
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    // flickering overhead lights
    ctx.globalAlpha = 0.06 + 0.03 * Math.sin(t * 17) + 0.02 * Math.sin(t * 31);
    ctx.fillStyle = '#fffae0';
    for (let i = 0; i < 4; i++) {
      const lx = ((i * 220 + 80 - cx * 0.55) % (W + 300) + W + 300) % (W + 300) - 150;
      ctx.fillRect(lx - 40, 0, 80, FIELD * 0.6);
    }
  } else if (th === 'diner') {
    // jukebox pulsing lights in background
    for (let i = 0; i < 3; i++) {
      const bx = ((i * 280 + 120 - cx * 0.55) % (W + 300) + W + 300) % (W + 300) - 150;
      for (let j = 0; j < 4; j++) {
        const hue = (t * 80 + j * 90 + i * 60) % 360;
        ctx.globalAlpha = 0.12 + 0.08 * Math.sin(t * 4 + j + i);
        ctx.fillStyle = `hsl(${hue},90%,60%)`;
        ctx.beginPath(); ctx.arc(bx + j * 12 - 18, FIELD - 100 + Math.sin(t * 2 + j) * 3, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    // ceiling fan rotation
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 2; i++) {
      const fx = ((i * 350 + 200 - cx * 0.55) % (W + 400) + W + 400) % (W + 400) - 200;
      const fy = 22;
      ctx.save(); ctx.translate(fx, fy); ctx.rotate(t * 3 + i);
      ctx.fillStyle = '#5a4a3a';
      for (let b = 0; b < 4; b++) {
        ctx.rotate(Math.PI / 2);
        ctx.fillRect(-2, 0, 4, 28);
      }
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ---------------- ink outlines ----------------
   Characters are painted into a scratch canvas, then stamped around themselves in a dark
   colour to give them a cartoon outline before the real paint goes on top. */
const inkA = document.createElement('canvas'), inkB = document.createElement('canvas');
function withInk(bx, by, w, h, drawFn, color = '#1c0a14', thick = 1.15) {
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || dpr;
  const pw = Math.ceil(w * k) + 4, ph = Math.ceil(h * k) + 4;
  if (inkA.width < pw || inkA.height < ph) { inkA.width = inkB.width = Math.max(pw, inkA.width); inkA.height = inkB.height = Math.max(ph, inkA.height); }
  const a = inkA.getContext('2d'), b = inkB.getContext('2d');
  a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, pw, ph);
  a.setTransform(k, 0, 0, k, -bx * k + 2, -by * k + 2);
  const saved = ctx; ctx = a; drawFn(); ctx = saved;
  b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, pw, ph);
  const o = Math.max(1, thick * k);
  for (const [dx, dy] of [[o, 0], [-o, 0], [0, o], [0, -o], [o * 0.7, o * 0.7], [-o * 0.7, o * 0.7], [o * 0.7, -o * 0.7], [-o * 0.7, -o * 0.7]]) b.drawImage(inkA, 0, 0, pw, ph, dx, dy, pw, ph);
  b.globalCompositeOperation = 'source-in'; b.fillStyle = color; b.fillRect(0, 0, pw, ph); b.globalCompositeOperation = 'source-over';
  const sx = 2 / k;
  ctx.drawImage(inkB, 0, 0, pw, ph, bx - sx, by - sx, pw / k, ph / k);
  ctx.drawImage(inkA, 0, 0, pw, ph, bx - sx, by - sx, pw / k, ph / k);
}
function drawFrankie(x, y, o = {}) {
  const s = o.scale || 1;
  withInk(x - 28 * s, y - 50 * s, 56 * s, 56 * s, () => {
    drawFrankieRaw(x, y, o);
    if (o.hitFlash > 0) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(255,255,255,${clamp(o.hitFlash * 18, 0, 0.92)})`;
      ctx.fillRect(x - 28 * s, y - 50 * s, 56 * s, 56 * s);
      ctx.globalCompositeOperation = 'source-over';
    }
  });
}
function drawDottie(x, y, s = 1, t = 0, o = {}) { withInk(x - 18 * s, y - 54 * s, 36 * s, 58 * s, () => drawDottieRaw(x, y, s, t, o)); }
function drawGreasy(x, y, o = {}) { const r = o.spin ? 70 : 0; withInk(x - 52 - r, y - 106 - r, 104 + r * 2, 112 + r * 2, () => drawGreasyRaw(x, y, o), '#140608', 1.4); }
function drawEnemy(e) { withInk(e.x - 12, e.y - 14, e.w + 24, e.h + 22, () => drawEnemyRaw(e)); }
// soft contact shadow on whatever surface is below a point
function surfaceBelow(x, y) {
  if (!L || !L.tiles) return null;
  const c = Math.floor(x / T);
  for (let r = Math.max(0, Math.floor(y / T)); r < ROWS; r++) { const t = tileAt(c, r); if (isSolid(t) || t === 3) return r * T; }
  return null;
}
function contactShadow(x, footY, w) {
  const sy = surfaceBelow(x, footY - 2); if (sy === null) return;
  const d = Math.max(0, sy - footY), k = Math.max(0, 1 - d / 160);
  if (k <= 0) return;
  ctx.fillStyle = `rgba(0,0,0,${0.32 * k})`; ctx.beginPath(); ctx.ellipse(x, sy + 1, w * (0.5 + 0.5 * k), 3.2 * (0.6 + 0.4 * k), 0, 0, Math.PI * 2); ctx.fill();
}

/* ---------------- characters ---------------- */
const SKIN = '#f2c49e', SKIN_D = '#d99f78';
// Frankie the short-order cook. (x, y) is the middle of his feet.
function drawFrankieRaw(x, y, o = {}) {
  const face = o.face || 1, run = o.run || 0, air = !!o.air, t = o.t || 0;
  ctx.save(); ctx.translate(x, y); ctx.scale(face * (o.scale || 1), o.scale || 1);
  if (o.squash) ctx.scale(1 + o.squash, 1 - o.squash);
  if (o.skid) ctx.rotate(-0.18);
  const swing = air ? 0.6 : Math.sin(run) * 0.75 * Math.min(1, o.speed || 0);
  const bob = air ? 0 : Math.abs(Math.sin(run)) * -1.5 * Math.min(1, o.speed || 0) + (o.dance ? Math.abs(Math.sin(t * 8)) * -3 : 0);
  ctx.translate(0, bob);
  // legs (blue jeans, saddle shoes)
  const leg = (ang, back) => {
    ctx.save(); ctx.translate(back ? -2 : 2, -12); ctx.rotate(ang);
    ctx.fillStyle = back ? '#23407a' : '#2d52a0'; rr(-3, 0, 6, 11, 2); ctx.fill();
    ctx.fillStyle = '#1a1414'; rr(-3, 9, 9, 4, 2); ctx.fill(); ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 9.5, 3, 3);
    ctx.restore();
  };
  leg(air ? -0.5 : -swing, true); leg(air ? 0.35 : swing, false);
  // back arm
  ctx.save(); ctx.translate(-3, -22); ctx.rotate(air ? -2.4 : swing * 0.8 + 0.1); ctx.fillStyle = SKIN_D; rr(-2, 0, 4, 10, 2); ctx.fill(); ctx.restore();
  // body: white tee + apron + red neckerchief
  const rush = o.rush;
  ctx.fillStyle = rush ? `hsl(${(t * 600) % 360},90%,85%)` : lin(-7, 0, 7, 0, [[0, '#dfe4ee'], [0.45, '#ffffff'], [1, '#e6eaf2']]); rr(-7, -24, 14, 13, 4); ctx.fill();
  ctx.fillStyle = 'rgba(120,130,160,.25)'; ctx.fillRect(-7, -14, 14, 2);
  ctx.fillStyle = lin(0, -17, 0, -8, [[0, '#f4f0e4'], [1, '#d8d0bc']]); rr(-6, -17, 12, 9, 2); ctx.fill();
  ctx.strokeStyle = 'rgba(160,140,110,.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-6, -16.5); ctx.lineTo(6, -16.5); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(-6, -17, 12, 1);
  ctx.fillStyle = '#d42a3c'; ctx.beginPath(); ctx.moveTo(-4, -24); ctx.lineTo(4, -24); ctx.lineTo(0, -19); ctx.closePath(); ctx.fill();
  // head
  ctx.fillStyle = rad(-1, -32, 1, 8, [[0, '#fbd7b6'], [1, SKIN]]); ctx.beginPath(); ctx.arc(1, -29.5, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = SKIN_D; ctx.beginPath(); ctx.arc(-4.5, -29, 2, 0, Math.PI * 2); ctx.fill();
  // pompadour + side hair
  ctx.fillStyle = '#1e1410'; ctx.beginPath(); ctx.moveTo(-5.5, -30); ctx.quadraticCurveTo(-7, -38, 1, -38.5); ctx.quadraticCurveTo(9, -39, 9, -34); ctx.quadraticCurveTo(4, -36, 2, -33.5); ctx.quadraticCurveTo(-1, -34, -5.5, -30); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(1, -38, 4, 1);
  // paper cook's cap (red when he's packing hot sauce)
  ctx.fillStyle = o.power ? '#e8233c' : '#ffffff'; ctx.beginPath(); ctx.moveTo(-6, -35); ctx.lineTo(-3, -41); ctx.lineTo(4, -41); ctx.lineTo(6, -36); ctx.closePath(); ctx.fill();
  ctx.fillStyle = o.power ? '#ffb347' : '#d42a3c'; ctx.fillRect(-5.5, -36.5, 11, 1.5);
  // face
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(4.6, -30.2, 1.7, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1010'; ctx.beginPath(); ctx.arc(5.2, -30, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1e1410'; ctx.fillRect(3, -33.2, 3.6, 0.9);
  ctx.strokeStyle = '#8a3a2a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(4, -27.5, 2, 0.2, 1.4); ctx.stroke();
  ctx.fillStyle = SKIN_D; ctx.fillRect(6.5, -29.5, 1.5, 1.5);
  // front arm + spatula
  ctx.save(); ctx.translate(2, -22); ctx.rotate(o.throwT ? -1.4 : air ? -2.2 : -swing * 0.8 - 0.2);
  ctx.fillStyle = '#ffffff'; rr(-2.5, -1, 5, 5, 2); ctx.fill();
  ctx.fillStyle = SKIN; rr(-2, 2, 4, 9, 2); ctx.fill();
  ctx.fillStyle = '#5a3a1a'; ctx.fillRect(-1, 10, 2, 6); ctx.fillStyle = '#c9d0da'; rr(-3, 15, 6, 6, 1); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-1.5, 16, 0.8, 4); ctx.fillRect(0.7, 16, 0.8, 4);
  ctx.restore();
  ctx.restore();
}
// Dottie, the diner's jukebox singer. (x, y) is the middle of her feet.
function drawDottieRaw(x, y, s = 1, t = 0, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale((o.face || 1) * s, s);
  const sway = Math.sin(t * 3) * 0.06;
  // legs + red heels
  ctx.fillStyle = SKIN; ctx.fillRect(-4, -10, 2.6, 9); ctx.fillRect(1.4, -10, 2.6, 9);
  ctx.fillStyle = '#d4142c'; ctx.beginPath(); ctx.moveTo(-5, -1); ctx.lineTo(-1, -1); ctx.lineTo(-1, 0.5); ctx.lineTo(-5, 0.5); ctx.fill(); ctx.fillRect(-5, -2, 1, 2.5);
  ctx.beginPath(); ctx.moveTo(1, -1); ctx.lineTo(5, -1); ctx.lineTo(5, 0.5); ctx.lineTo(1, 0.5); ctx.fill(); ctx.fillRect(1, -2, 1, 2.5);
  ctx.rotate(sway);
  // swing skirt with petticoat and polka dots
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(-6, -22); ctx.lineTo(6, -22); ctx.lineTo(12, -9); ctx.quadraticCurveTo(0, -6, -12, -9); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e0182e'; ctx.beginPath(); ctx.moveTo(-5.5, -23); ctx.lineTo(5.5, -23); ctx.lineTo(11, -10.5); ctx.quadraticCurveTo(0, -8, -11, -10.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff'; for (const [dx, dy] of [[-6, -13], [-1, -12], [4, -13], [8, -12], [-3, -17], [2, -18], [-8, -11]]) { ctx.beginPath(); ctx.arc(dx, dy, 1, 0, Math.PI * 2); ctx.fill(); }
  // bodice + belt
  ctx.fillStyle = '#e0182e'; ctx.beginPath(); ctx.moveTo(-4.5, -33); ctx.lineTo(4.5, -33); ctx.lineTo(3.5, -23); ctx.lineTo(-3.5, -23); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a1414'; ctx.fillRect(-4, -24.5, 8, 2);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(-4.5, -33); ctx.lineTo(0, -30); ctx.lineTo(4.5, -33); ctx.lineTo(3, -34); ctx.lineTo(-3, -34); ctx.closePath(); ctx.fill();
  // arms (one waving when happy)
  ctx.fillStyle = SKIN; ctx.save(); ctx.translate(-4.5, -32); ctx.rotate(0.3); rr(-1.3, 0, 2.6, 10, 1.3); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(4.5, -32); ctx.rotate(o.wave ? -2.6 + Math.sin(t * 10) * 0.4 : -0.3); rr(-1.3, 0, 2.6, 10, 1.3); ctx.fill(); ctx.restore();
  // head, platinum victory rolls
  ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(0, -38.5, 5.2, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-1.2, -35, 2.4, 2.5);
  ctx.fillStyle = '#fbeec4';
  ctx.beginPath(); ctx.arc(-3.6, -43, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(3.6, -43, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -44.5, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-5.6, -41); ctx.quadraticCurveTo(-8, -36, -5.5, -33.5); ctx.lineTo(-4.4, -38); ctx.fill();
  ctx.beginPath(); ctx.moveTo(5.6, -41); ctx.quadraticCurveTo(8, -36, 5.5, -33.5); ctx.lineTo(4.4, -38); ctx.fill();
  ctx.fillStyle = '#e8d49a'; ctx.beginPath(); ctx.arc(-3.6, -43, 1.2, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(3.6, -43, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e0182e'; ctx.beginPath(); ctx.moveTo(-2, -47.5); ctx.lineTo(0, -46); ctx.lineTo(2, -47.5); ctx.lineTo(0, -45); ctx.closePath(); ctx.fill();
  // face: lashes, red lips, beauty mark
  ctx.fillStyle = '#1a1010'; ctx.fillRect(-2.8, -39.5, 1.5, 1.6); ctx.fillRect(1.3, -39.5, 1.5, 1.6);
  ctx.fillRect(-3.2, -40.4, 2.2, 0.6); ctx.fillRect(1, -40.4, 2.2, 0.6);
  ctx.fillStyle = '#d4142c'; ctx.beginPath(); ctx.ellipse(0, -35.8, 1.8, 0.95, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,120,140,.45)'; ctx.beginPath(); ctx.arc(-3, -37, 1.2, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(3, -37, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a1a10'; ctx.fillRect(2.6, -36.4, 0.8, 0.8);
  ctx.restore();
}
// Big Greasy. (x, y) is the middle of his feet; about 76px tall.
function drawGreasyRaw(x, y, o = {}) {
  ctx.save(); ctx.translate(x, y);
  if (o.spin) { ctx.translate(0, -38); ctx.rotate(o.spin); ctx.translate(0, 38); }
  ctx.scale(o.face || -1, 1);
  const t = o.t || 0, step = o.walk ? Math.sin(t * 8) * 3 : 0;
  ctx.fillStyle = '#3a3036'; rr(-14, -18 + Math.max(0, step), 11, 18, 3); ctx.fill(); rr(3, -18 + Math.max(0, -step), 11, 18, 3); ctx.fill();
  ctx.fillStyle = '#141010'; rr(-16, -4, 15, 5, 2); ctx.fill(); rr(2, -4, 15, 5, 2); ctx.fill();
  // belly in a stained undershirt
  ctx.fillStyle = lin(-24, 0, 24, 0, [[0, '#cfc6b0'], [0.5, '#f0e8d4'], [1, '#bdb39c']]);
  ctx.beginPath(); ctx.ellipse(0, -36, 25, 24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(140,110,40,.35)'; ellipse(-8, -30, 6, 4, 'rgba(140,110,40,.35)'); ellipse(9, -42, 4, 3, 'rgba(140,110,40,.3)'); ellipse(4, -24, 5, 3, 'rgba(120,90,30,.3)');
  ctx.fillStyle = '#7a1a1a'; ctx.fillRect(-14, -58, 4, 30); ctx.fillRect(10, -58, 4, 30);
  // arms + giant spatula
  const throwing = o.pose === 'throw', jumping = o.pose === 'jump';
  ctx.fillStyle = '#e0a87e';
  ctx.save(); ctx.translate(-22, -50); ctx.rotate(jumping ? 2.4 : 0.35); rr(-5, 0, 10, 24, 5); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(20, -50); ctx.rotate(throwing ? -1.9 : jumping ? -2.4 : -0.3);
  rr(-5, 0, 10, 24, 5); ctx.fill();
  ctx.fillStyle = '#4a2a14'; ctx.fillRect(-2, 20, 4, 18); ctx.fillStyle = lin(-9, 0, 9, 0, [[0, '#9aa2ae'], [0.5, '#eef1f5'], [1, '#8a92a0']]); rr(-9, 36, 18, 16, 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.3)'; for (let i = 0; i < 3; i++) ctx.fillRect(-5 + i * 4.5, 39, 1.5, 10);
  ctx.restore();
  // head
  ctx.fillStyle = '#e0a87e'; ctx.beginPath(); ctx.arc(2, -64, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(60,40,40,.45)'; ctx.beginPath(); ctx.arc(3, -58, 8, 0.2, Math.PI - 0.2); ctx.fill();
  ctx.fillStyle = '#1a1010'; ctx.beginPath(); ctx.moveTo(-2, -60); ctx.quadraticCurveTo(6, -64, 15, -60); ctx.quadraticCurveTo(6, -58, -2, -60); ctx.fill();
  ctx.fillStyle = '#fff'; ellipse(8, -67, 3.2, 2.6, '#fff'); ctx.fillStyle = o.hit ? '#ff2a2a' : '#1a1010'; ctx.fillRect(8.5, -68, 2, 2.4);
  ctx.strokeStyle = '#1a1010'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(3, -73); ctx.lineTo(13, -70); ctx.stroke();
  ctx.fillStyle = '#c87a5e'; ctx.beginPath(); ctx.arc(13, -63, 3.2, 0, Math.PI * 2); ctx.fill();
  // grimy tall toque, tilted
  ctx.save(); ctx.translate(0, -74); ctx.rotate(-0.15);
  ctx.fillStyle = '#e4dccb'; rr(-10, -6, 22, 8, 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-6, -12, 7, 0, Math.PI * 2); ctx.arc(2, -16, 8, 0, Math.PI * 2); ctx.arc(9, -11, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(120,100,60,.35)'; ellipse(3, -14, 4, 3, 'rgba(120,100,60,.35)');
  ctx.restore();
  ctx.restore();
}

/* ---------------- enemies, items, props ---------------- */
function drawEnemyRaw(e) {
  const cx = e.x + e.w / 2, by = e.y + e.h;
  ctx.save();
  if (e.dead && e.style === 'flip') { ctx.translate(cx, e.y + e.h / 2); ctx.scale(1, -1); ctx.translate(-cx, -(e.y + e.h / 2)); }
  const look = e.vx > 0 ? 1 : e.vx < 0 ? -1 : (P && P.x > e.x ? 1 : -1);
  if (e.type === 'meat') {
    if (e.dead && e.style === 'squash') { ellipse(cx, by - 4, 15, 5, '#7a3a1e'); ellipse(cx, by - 6, 11, 2.5, '#c8202a'); ctx.restore(); return; }
    const wob = Math.sin(e.t * 12) * 1.2;
    ctx.fillStyle = '#2a1a10'; ctx.fillRect(cx - 8 + wob, by - 4, 5, 4); ctx.fillRect(cx + 3 - wob, by - 4, 5, 4);
    ctx.fillStyle = rad(cx - 4, by - 18, 2, 16, [[0, '#b0603a'], [1, '#6a2e16']]); ctx.beginPath(); ctx.arc(cx, by - 12, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(40,16,8,.45)'; for (const [dx, dy] of [[-5, -8], [4, -15], [6, -6], [-7, -16], [0, -4]]) { ctx.beginPath(); ctx.arc(cx + dx, by + dy, 1.4, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#d4202a'; ctx.beginPath(); ctx.ellipse(cx, by - 21, 9, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(cx - 4, by - 23, 4, 1.4);
    ctx.fillStyle = '#4caf50'; ctx.beginPath(); ctx.ellipse(cx + 2, by - 25, 3, 1.6, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx - 4 + look * 2, by - 13, 3, 0, Math.PI * 2); ctx.arc(cx + 4 + look * 2, by - 13, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a0a0a'; ctx.fillRect(cx - 4 + look * 3, by - 13.5, 1.8, 2.4); ctx.fillRect(cx + 4 + look * 3, by - 13.5, 1.8, 2.4);
    ctx.strokeStyle = '#1a0a0a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(cx - 7 + look * 2, by - 18); ctx.lineTo(cx - 2 + look * 2, by - 16); ctx.moveTo(cx + 7 + look * 2, by - 18); ctx.lineTo(cx + 2 + look * 2, by - 16); ctx.stroke();
  } else if (e.type === 'fly') {
    const cy = e.y + e.h / 2, flap = Math.sin(e.t * 50) * 0.5;
    ctx.fillStyle = 'rgba(210,235,255,.55)'; ctx.beginPath(); ctx.ellipse(cx - 5, cy - 6, 7, 3.5, -0.6 + flap, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(cx + 5, cy - 6, 7, 3.5, 0.6 - flap, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rad(cx - 2, cy - 2, 1, 10, [[0, '#3a5a3a'], [1, '#101410']]); ctx.beginPath(); ctx.ellipse(cx, cy, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c8202a'; ctx.beginPath(); ctx.arc(cx + look * 5, cy - 1, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(cx + look * 5 - 1, cy - 3, 1.2, 1.2);
    ctx.strokeStyle = '#101410'; ctx.lineWidth = 1; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(cx + i * 3, cy + 5); ctx.lineTo(cx + i * 4, cy + 9); ctx.stroke(); }
  } else if (e.type === 'toast') {
    const sq = e.ground ? 0 : -2;
    ctx.fillStyle = '#2a2a30'; ctx.fillRect(cx - 10, by - 3, 4, 3); ctx.fillRect(cx + 6, by - 3, 4, 3);
    ctx.fillStyle = '#c98a3a'; rr(cx - 8, by - 30 + sq, 7, 8, 2); ctx.fill(); rr(cx + 1, by - 31 + sq, 7, 9, 2); ctx.fill();
    ctx.fillStyle = lin(cx - 14, 0, cx + 14, 0, [[0, '#9aa2ae'], [0.35, '#f4f6fa'], [1, '#7a828e']]); rr(cx - 14, by - 25, 28, 22, 7); ctx.fill();
    ctx.fillStyle = '#2a2a30'; ctx.fillRect(cx - 9, by - 25, 6, 2.5); ctx.fillRect(cx + 3, by - 25, 6, 2.5); ctx.fillRect(cx + look * 15 - 1.5, by - 18, 3, 7);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx - 5 + look * 2, by - 15, 3.4, 0, Math.PI * 2); ctx.arc(cx + 5 + look * 2, by - 15, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a0a0a'; ctx.fillRect(cx - 5 + look * 3, by - 16, 2, 2.6); ctx.fillRect(cx + 5 + look * 3, by - 16, 2, 2.6);
    ctx.fillStyle = '#c8203a'; rr(cx - 5, by - 9, 10, 2.5, 1.2); ctx.fill();
  } else if (e.type === 'jello') {
    const sq = (e.squish || 0) > 0 ? Math.sin(e.squish * 30) * 0.25 : Math.sin(e.t * 5) * 0.06;
    if (e.squish > 0) e.squish -= 1 / 60;
    ctx.translate(cx, by); ctx.scale(1 + sq, 1 - sq);
    ctx.fillStyle = 'rgba(70,220,110,.82)'; ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(-12, -16); ctx.quadraticCurveTo(0, -27, 12, -16); ctx.lineTo(15, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(20,120,50,.5)'; ctx.lineWidth = 1.2; for (const dx of [-6, 0, 6]) { ctx.beginPath(); ctx.moveTo(dx * 1.4, 0); ctx.quadraticCurveTo(dx * 1.2, -12, dx, -21); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(-6, -15, 2.5, 5, 0.3, 0, Math.PI * 2); ctx.fill();
    circle(0, -24, 3, '#e8233c');
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-4 + look * 2, -9, 2.6, 0, Math.PI * 2); ctx.arc(4 + look * 2, -9, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0a2a10'; ctx.fillRect(-4 + look * 3, -10, 1.6, 2); ctx.fillRect(4 + look * 3, -10, 1.6, 2);
  }
  ctx.restore();
}
function drawToastShot(s) {
  ctx.save(); ctx.translate(s.x + 8, s.y + 7); ctx.rotate(s.t * 9);
  ctx.fillStyle = '#c98a3a'; rr(-8, -7, 16, 14, 4); ctx.fill(); ctx.fillStyle = '#f2d39a'; rr(-6, -5, 12, 10, 3); ctx.fill();
  ctx.restore();
}
function drawCoin(x, y, t, s = 1) {
  const k = Math.cos(t * 4), w = Math.max(0.15, Math.abs(k)) * 8 * s;
  ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.ellipse(x, y, w + 1, 9 * s + 1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = lin(x - w, y - 9, x + w, y + 9, [[0, '#fff1a0'], [0.5, '#ffc928'], [1, '#d4960e']]); ctx.beginPath(); ctx.ellipse(x, y, w, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
  if (Math.abs(k) > 0.45) text('¢', x, y + 0.5, 11 * s, k > 0 ? '#9a6a00' : '#b8860b', 'center', '900');
  const gl = (t * 0.9 + x * 0.013) % 2.4;
  if (gl < 0.3) { ctx.save(); ctx.globalAlpha = Math.sin(gl / 0.3 * Math.PI); ctx.globalCompositeOperation = 'lighter'; starShape(x - 3 * s, y - 5 * s, 5 * s, '#ffffff'); ctx.restore(); }
}
function drawItem(kind, x, y, t = 0) {
  // (x, y) is the top-left of a 20 x 24 box
  const cx = x + 10, by = y + 24;
  if (kind === 'sauce') {
    glow(cx, by - 12, 20, '255,80,40', 0.25 + 0.1 * Math.sin(t * 8));
    ctx.fillStyle = lin(cx - 7, 0, cx + 7, 0, [[0, '#a8101e'], [0.4, '#ff3a3a'], [1, '#8a0a16']]); rr(cx - 7, by - 18, 14, 18, 4); ctx.fill();
    ctx.fillStyle = '#c8101e'; ctx.fillRect(cx - 3, by - 23, 6, 6); ctx.fillStyle = '#2a8a3a'; rr(cx - 3.5, by - 26, 7, 4, 1); ctx.fill();
    ctx.fillStyle = '#fff4dc'; rr(cx - 6, by - 13, 12, 7, 1.5); ctx.fill(); text('HOT', cx, by - 9.3, 6, '#c8101e', 'center', '900');
  } else if (kind === 'shake') {
    glow(cx, by - 12, 22, '255,120,220', 0.25 + 0.1 * Math.sin(t * 8));
    ctx.fillStyle = 'rgba(240,250,255,.7)'; ctx.beginPath(); ctx.moveTo(cx - 7, by - 18); ctx.lineTo(cx + 7, by - 18); ctx.lineTo(cx + 4, by - 2); ctx.lineTo(cx - 4, by - 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff8cc8'; ctx.beginPath(); ctx.moveTo(cx - 6, by - 16); ctx.lineTo(cx + 6, by - 16); ctx.lineTo(cx + 3.6, by - 3); ctx.lineTo(cx - 3.6, by - 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d8dde6'; rr(cx - 5, by - 2, 10, 2, 1); ctx.fill();
    ellipse(cx, by - 19, 7, 3.5, '#fffaf0'); circle(cx + 1, by - 23, 2.4, '#e8233c');
    ctx.strokeStyle = '#ff4f8a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(cx - 2, by - 18); ctx.lineTo(cx - 5, by - 27); ctx.stroke();
  } else if (kind === 'pie') {
    glow(cx, by - 8, 20, '255,210,120', 0.2);
    ctx.fillStyle = '#f2f2f2'; ellipse(cx, by - 2, 10, 3, '#f2f2f2');
    ctx.fillStyle = '#d9a050'; ctx.beginPath(); ctx.moveTo(cx - 9, by - 4); ctx.lineTo(cx + 9, by - 4); ctx.lineTo(cx + 9, by - 10); ctx.lineTo(cx - 6, by - 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b8203a'; ctx.beginPath(); ctx.moveTo(cx - 8, by - 6); ctx.lineTo(cx + 8, by - 6); ctx.lineTo(cx + 8, by - 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f0c070'; ctx.beginPath(); ctx.moveTo(cx - 7, by - 15); ctx.lineTo(cx + 10, by - 11); ctx.lineTo(cx + 9, by - 9); ctx.lineTo(cx - 8, by - 13); ctx.closePath(); ctx.fill();
    ellipse(cx + 1, by - 15, 4, 2.4, '#fffaf0');
  }
}
function drawPlatform(p) {
  const th = L.theme;
  ctx.fillStyle = 'rgba(0,0,0,.2)'; rr(p.x + 2, p.y + 4, p.w - 4, p.h, 4); ctx.fill();
  if (p.axis === 'y') {
    ctx.strokeStyle = 'rgba(40,40,48,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x + 8, p.y); ctx.lineTo(p.x + 8, 0); ctx.moveTo(p.x + p.w - 8, p.y); ctx.lineTo(p.x + p.w - 8, 0); ctx.stroke();
    ctx.fillStyle = lin(0, p.y, 0, p.y + p.h, [[0, '#b07a45'], [1, '#6e4620']]); rr(p.x, p.y, p.w, p.h, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(p.x + 2, p.y + 1, p.w - 4, 1.5);
  } else {
    ctx.fillStyle = lin(0, p.y, 0, p.y + p.h, [[0, '#f4f6fa'], [0.5, '#c9d0da'], [1, '#7a828e']]); rr(p.x, p.y, p.w, p.h, p.h / 2); ctx.fill();
    ctx.fillStyle = th === 'grill' ? '#c8203a' : '#e8455a'; ctx.fillRect(p.x + 8, p.y + p.h / 2 - 1, p.w - 16, 2);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(p.x + 8, p.y + 2, p.w - 16, 1.5);
  }
}
function drawCheckpoint(k) {
  const x = k.x + 16, y = k.y;
  ctx.fillStyle = '#5a5a62'; ctx.fillRect(x - 2, y - 64, 4, 64);
  // diner bell on the counter
  ctx.fillStyle = '#c0b8a0'; ctx.beginPath(); ctx.arc(x, y - 8, 8, Math.PI, 0); ctx.fill(); // dome
  ctx.fillStyle = '#a09880'; ctx.fillRect(x - 9, y - 8, 18, 3); // base rim
  ctx.fillStyle = '#706858'; ctx.beginPath(); ctx.arc(x, y - 14, 2.5, 0, Math.PI * 2); ctx.fill(); // knob
  ctx.fillStyle = '#1a1018'; rr(x - 26, y - 92, 52, 30, 6); ctx.fill(); ctx.strokeStyle = '#4a3a48'; ctx.lineWidth = 2; ctx.stroke();
  if (k.on) {
    glow(x, y - 77, 46, '255,80,160', 0.35); drawNeonText('OPEN', x, y - 77, 15, '#ff7ab8', '255,80,160');
    // sparkle around the bell
    for (let i = 0; i < 3; i++) {
      const a = G.t * 2.5 + i * 2.09, r = 14 + Math.sin(G.t * 3 + i) * 4;
      const sx = x + Math.cos(a) * r, sy = y - 10 + Math.sin(a) * r * 0.6;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(G.t * 4 + i);
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(G.t * 5 + i);
      starShape(0, 0, 3.5, '#ffe080'); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  else text('OPEN', x, y - 77, 15, '#4a3048', 'center', '900');
}
function drawJukebox(g, lit) {
  const x = g.x, y = g.y, w = g.w, h = g.h, cx = x + w / 2;
  glow(cx, y + h / 2, 80, lit ? '255,120,200' : '255,200,120', lit ? 0.35 + 0.1 * Math.sin(G.t * 10) : 0.18);
  ctx.fillStyle = lin(x, 0, x + w, 0, [[0, '#6a2a14'], [0.5, '#b8642a'], [1, '#5a2010']]);
  ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + 26); ctx.arc(cx, y + 26, w / 2, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
  ctx.lineWidth = 4;
  for (let i = 0; i < 2; i++) {
    const hue = (G.t * 120 + i * 120) % 360;
    ctx.strokeStyle = lit ? `hsl(${hue},100%,65%)` : ['#ff9a3a', '#ffd84a'][i];
    ctx.beginPath(); ctx.moveTo(x + 5 + i * 5, y + h - 6); ctx.lineTo(x + 5 + i * 5, y + 26); ctx.arc(cx, y + 26, w / 2 - 5 - i * 5, Math.PI, 0); ctx.lineTo(x + w - 5 - i * 5, y + h - 6); ctx.stroke();
  }
  ctx.fillStyle = '#1a1020'; rr(x + 16, y + 20, w - 32, 22, 4); ctx.fill();
  for (let i = 0; i < 5; i++) { ctx.fillStyle = lit && Math.floor(G.t * 8 + i) % 2 ? '#7af0ff' : '#c9d0da'; ctx.fillRect(x + 19 + i * 5.4, y + 24, 3.4, 14); }
  ctx.fillStyle = lin(0, y + 48, 0, y + h, [[0, '#d8dde6'], [1, '#8a92a0']]); rr(x + 12, y + 48, w - 24, h - 56, 4); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.35)'; for (let i = 0; i < 5; i++) ctx.fillRect(x + 16, y + 52 + i * 6, w - 32, 2);
  if (lit) for (let i = 0; i < 3; i++) { const ph = (G.t * 0.8 + i / 3) % 1; text('♪', cx + Math.sin(ph * 6 + i) * 20, y - ph * 40, 14, `rgba(255,255,255,${1 - ph})`, 'center', '900'); }
}
function drawFreezer(d) {
  const x = d.x + T * 1, y = 5 * T, w = 4 * T, h = 5 * T;
  ctx.fillStyle = lin(x, 0, x + w, 0, [[0, '#c9d0da'], [0.5, '#eef1f5'], [1, '#9aa2ae']]); ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#6a727e'; ctx.fillRect(x, y, w, 6);
  text('WALK-IN', x + w / 2, y + 16, 10, '#3a4250', 'center', '900', 2);
  // door
  const dw = 2.2 * T, dx = x + 14, dy = y + 26, dh = h - 26;
  ctx.fillStyle = '#20242c'; ctx.fillRect(dx, dy, dw, dh);
  if (d.out < 0.3) {
    ctx.fillStyle = 'rgba(160,220,255,.25)'; ctx.fillRect(dx + 2, dy + 2, dw - 4, dh - 4);
    if (d.out <= 0) drawDottie(dx + dw / 2, dy + dh - 4, 1.05, G.t, { face: -1 });
  }
  ctx.save(); ctx.translate(dx, dy);
  ctx.scale(1 - d.open * 0.85, 1);
  ctx.fillStyle = lin(0, 0, dw, 0, [[0, '#dfe4ec'], [1, '#aab2be']]); ctx.fillRect(0, 0, dw, dh);
  ctx.strokeStyle = '#7a828e'; ctx.lineWidth = 2; ctx.strokeRect(3, 3, dw - 6, dh - 6);
  ctx.fillStyle = '#1a2a3a'; ctx.beginPath(); ctx.arc(dw / 2, 30, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(180,230,255,.35)'; ctx.beginPath(); ctx.arc(dw / 2, 30, 11, 0, Math.PI * 2); ctx.fill();
  if (d.open < 0.1) { ctx.save(); ctx.beginPath(); ctx.arc(dw / 2, 30, 11, 0, Math.PI * 2); ctx.clip(); drawDottie(dw / 2, 30 + 52, 1.25, G.t, { face: -1 }); ctx.restore(); }
  ctx.fillStyle = '#5a626e'; rr(dw - 14, dh / 2 - 4, 10, 18, 3); ctx.fill();
  ctx.restore();
  for (let i = 0; i < 6; i++) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(x + 4 + i * 22, y + 6, 10, 3); }
}

/* ---------------- world ---------------- */
function heroOpts(h) {
  return { face: h.face, run: h.anim, speed: Math.abs(h.vx) / 165, air: !h.ground && !h.plat, power: h.power, rush: h.rushT > 0, throwT: h.throwT, t: G.t,
    squash: h.squashX !== 1 ? (h.squashX - 1) : (h.land > 0 ? h.land * 1.2 : 0), dance: G.state === 'clear' && G.stateT > 0.6, skid: h.skid, hitFlash: h.hitFlash };
}
function dottieWalkX() {
  const d = L.dottie, doorX = d.x + T + 14 + 1.1 * T, meet = P.x + P.w + 22, k = 1 - Math.pow(1 - d.out, 2);
  return lerp(doorX, meet, k);
}
function drawWorld() {
  ctx.save(); ctx.translate(0, HUD);
  ctx.beginPath(); ctx.rect(0, 0, W, FIELD); ctx.clip();
  drawBackground();
  drawBgAnimations(cam.x);
  const cx = Math.round(cam.x * dpr) / dpr;
  ctx.save(); ctx.translate(-cx, 0);
  const c0 = Math.max(0, Math.floor(cam.x / T) - 1), c1 = Math.min(L.w - 1, Math.ceil((cam.x + W) / T) + 1);
  // props behind the tiles
  for (const k of L.checks) if (k.x > c0 * T - 64 && k.x < c1 * T + 64) drawCheckpoint(k);
  if (L.goal) drawJukebox(L.goal, G.state === 'clear');
  // dark drop-offs where the floor is missing, and soft shadows under floating blocks
  for (let c = c0; c <= c1; c++) {
    if (tileAt(c, 10) === 0) { ctx.fillStyle = lin(0, 9 * T, 0, FIELD, [[0, 'rgba(0,0,0,0)'], [0.3, 'rgba(0,0,0,.92)'], [0.45, '#000'], [1, '#000']]); ctx.fillRect(c * T, 9 * T, T, 3 * T); }
    for (let r = 0; r < 10; r++) { const t = L.tiles[r * L.w + c]; if (t && t !== 10 && t !== 13 && t !== 1) { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(c * T + 4, r * T + (t === 3 ? 10 : T), T, 5); } }
  }
  for (let r = 0; r < ROWS; r++) for (let c = c0; c <= c1; c++) {
    const t = L.tiles[r * L.w + c];
    if (!t || t === 13) continue;
    if (t === 10) { drawFryer(c, r, tileAt(c, r - 1) !== 10); continue; }
    let oy = 0;
    for (const b of L.bumps) if (b.c === c && b.r === r) oy = -Math.sin(b.t / 0.2 * Math.PI) * 8;
    ctx.drawImage(tileSprite(t, t === 1 && tileAt(c, r - 1) !== 1), c * T, r * T + oy, T, T);
    if (t >= 5 && t <= 8) { const ph = (G.t * 0.7 + c * 0.13) % 2; if (ph < 0.25) { ctx.fillStyle = `rgba(255,255,255,${0.7 - ph * 2.8})`; ctx.fillRect(c * T + 9 + ph * 50, r * T + 8 + oy, 2, 18); } }
    if (t === 11) drawGriddleFlames(c, r);
  }
  if (L.dottie) drawFreezer(L.dottie);
  for (const p of L.plats) drawPlatform(p);
  for (const k of L.coins) if (!k.got && k.x > cam.x - 20 && k.x < cam.x + W + 20) drawCoin(k.x, k.y + Math.sin(G.t * 3 + k.x) * 1.5, G.t + k.x * 0.01);
  for (const c of L.coinPops) drawCoin(c.x, c.y, c.t * 6);
  for (const it of L.items) {
    if (it.rise < 1) { ctx.save(); ctx.beginPath(); ctx.rect(it.x - 10, it.y - 30, 40, it.baseY - it.y + 30); ctx.clip(); drawItem(it.kind, it.x, it.y, it.t); ctx.restore(); }
    else drawItem(it.kind, it.x, it.y, it.t);
  }
  for (const e of L.enemies) if (!e.dead && e.x < cam.x + W + 40 && e.x > cam.x - 60) contactShadow(e.x + e.w / 2, e.y + e.h, e.w * 0.5);
  if (L.boss && L.boss.state !== 'dead') contactShadow(L.boss.x + L.boss.w / 2, L.boss.y + L.boss.h, 30);
  if (P && !P.dead) contactShadow(P.x + P.w / 2, P.y + P.h, 11);
  for (const e of L.enemies) if (e.active || e.x < cam.x + W + 40) drawEnemy(e);
  const b = L.boss;
  if (b && b.y < FIELD + 100) {
    if (!(b.inv > 0 && b.state === 'fight' && Math.floor(G.t * 16) % 2)) drawGreasy(b.x + b.w / 2, b.y + b.h, { face: b.face, pose: b.pose, t: G.t, walk: b.ground && Math.abs(b.vx) > 1, hit: b.inv > 0, spin: b.state === 'dead' ? b.spin : 0 });
  }
  for (const s of L.eshots) drawToastShot(s);
  for (const s of L.shots) { glow(s.x + 6, s.y + 6, 16, '255,80,30', 0.5); circle(s.x + 6, s.y + 6, 5.5, '#e8231c'); circle(s.x + 4.5, s.y + 4.5, 2, '#ffb0a0'); }
  if (L.dottie && L.dottie.out > 0) drawDottie(dottieWalkX(), FIELD - 2 * T, 1.05, G.t, { face: -1, wave: G.stateT > 4.4 });
  if (P && !(P.inv > 0 && Math.floor(G.t * 14) % 2 && G.state === 'play')) {
    if (P.rushT > 0) glow(P.x + P.w / 2, P.y + P.h / 2, 30, `${(G.t * 500 % 255) | 0},180,255`, 0.4);
    drawFrankie(P.x + P.w / 2, P.y + P.h, heroOpts(P));
  }
  for (const p of G.parts) {
    ctx.globalAlpha = clamp(p.life * 2, 0, 1);
    if (p.heart) heartShape(p.x, p.y, p.r * 2, p.c);
    else if (p.puff) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * 0.55; circle(p.x, p.y, p.r + (1 - p.life / p.max) * p.grow, p.c); }
    else if (p.ring) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.strokeStyle = p.c; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + (1 - p.life / p.max) * p.grow, 0, Math.PI * 2); ctx.stroke(); }
    else if (p.star) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 8); starShape(0, 0, p.r, p.c); ctx.restore(); }
    else if (p.chunk) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.spin); ctx.fillStyle = p.c; ctx.fillRect(-6, -6, 12, 12); ctx.strokeStyle = '#6e4620'; ctx.lineWidth = 1.5; ctx.strokeRect(-6, -6, 12, 12); ctx.restore(); }
    else circle(p.x, p.y, p.r, p.c);
  }
  ctx.globalAlpha = 1;
  for (const p of G.pops) { ctx.save(); ctx.globalAlpha = clamp(p.t * 2, 0, 1); ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 5; text(p.txt, p.x, p.y, 13, p.color, 'center', '900', 1); ctx.restore(); }
  ctx.restore();
  // hearts, lives and power-ups in the top-left corner of the playfield
  if (G.state !== 'title' && G.state !== 'tips') {
    for (let i = 0; i < 3; i++) {
      const x = 18 + i * 22, full = i < (P ? P.hearts : 0), beat = full && P.hearts === 1 ? 1 + Math.abs(Math.sin(G.t * 6)) * 0.12 : 1;
      ctx.save(); ctx.translate(x, 18); ctx.scale(beat, beat); ctx.translate(-x, -18);
      heartShape(x, 7.5, 19, '#1c0a14');
      heartShape(x, 9, 16, full ? '#ff3a5a' : 'rgba(255,255,255,.16)');
      if (full) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.ellipse(x - 4, 14, 2.2, 1.4, -0.6, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    let x = 84;
    if (P && P.power) { drawItem('sauce', x - 4, 4, G.t); x += 24; }
    if (P && P.rushT > 0) { ctx.globalAlpha = P.rushT < 2 && Math.floor(G.t * 8) % 2 ? 0.4 : 1; drawItem('shake', x - 4, 4, G.t); ctx.globalAlpha = 1; x += 24; }
    if (L.boss && L.boss.state !== 'wait' && L.boss.state !== 'dead') {
      const bw = Math.min(220, W * 0.4), bx = W - bw - 14;
      text('BIG GREASY', bx + bw / 2, 12, 10, '#ffd0c0', 'center', '900', 2);
      rr(bx, 20, bw, 8, 4); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill();
      rr(bx, 20, bw * Math.max(0, L.boss.hp) / L.boss.maxHp, 8, 4); ctx.fillStyle = lin(bx, 0, bx + bw, 0, [[0, '#ff4a2a'], [1, '#ffb347']]); ctx.fill();
    }
  }
  ctx.restore();
}

/* ---------------- interface ---------------- */
function drawHUD() {
  ctx.fillStyle = lin(0, 0, 0, HUD, [[0, '#2a0e22'], [1, '#14060f']]); ctx.fillRect(0, 0, W, HUD);
  ctx.fillStyle = lin(0, 0, W, 0, [[0, 'rgba(255,95,160,0)'], [0.5, 'rgba(255,140,190,.9)'], [1, 'rgba(255,95,160,0)']]); ctx.fillRect(0, HUD - 1.5, W, 1.5);
  if (G.state === 'title') {
    glassButton(8, 7, 118, 30);
    ctx.strokeStyle = '#ffe0ee'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(27, 16); ctx.lineTo(21, 22); ctx.lineTo(27, 28); ctx.stroke();
    text('ARCADE', 72, 22.5, 14, '#fff0f6', 'center', '800', 1.5);
    text('HIGH', W * 0.5, 13, 10, '#ff9cc8', 'center', '800', 1.5); text(String(best()).padStart(7, '0'), W * 0.5, 30, 19, '#ffd84a', 'center', '800');
  } else {
    text('SCORE', 12, 13, 10, '#ff9cc8', 'left', '800', 1.5); text(String(G.score).padStart(7, '0'), 12, 30, 18, '#ffffff', 'left', '800');
    const tx = W * 0.34; drawCoin(tx - 12, 26, 0, 0.75); text('×' + String(G.tips).padStart(2, '0'), tx - 2, 27, 16, '#ffffff', 'left', '800');
    text('LEVEL', W * 0.5, 13, 10, '#ff9cc8', 'center', '800', 1.5); text(String(G.levelNum), W * 0.5, 30, 18, '#ffffff', 'center', '800');
    text('TIME', W * 0.63, 13, 10, '#ff9cc8', 'center', '800', 1.5);
    const tm = Math.ceil(G.time); text(String(tm), W * 0.63, 30, 18, tm <= 60 && G.state === 'play' && Math.floor(G.t * 4) % 2 ? '#ff5a5a' : '#ffffff', 'center', '800');
  }
  glassButton(W - 98, 7, 42, 30); iconSpeaker(W - 77, 22, muted);
  glassButton(W - 50, 7, 42, 30, G.state === 'paused');
  ctx.fillStyle = '#ffffff';
  if (G.state === 'paused') { ctx.beginPath(); ctx.moveTo(W - 34, 15); ctx.lineTo(W - 22, 22); ctx.lineTo(W - 34, 29); ctx.closePath(); ctx.fill(); }
  else { rr(W - 36, 15, 4, 14, 2); ctx.fill(); rr(W - 28, 15, 4, 14, 2); ctx.fill(); }
}
function boardPages() { return WEEK !== null ? ['story', 'all', 'week'] : ['story', 'all']; }
function drawBoard(page, cx, y, rowH, width) {
  const list = page === 'week' ? WEEK : BOARD;
  text(page === 'week' ? 'TOP 10 THIS WEEK' : BOARD_SHARED ? 'TOP 10 ALL-TIME' : 'TOP 10 ON THIS DEVICE', cx, y, 12, '#7af0ff', 'center', '800', 2.5);
  y += rowH + 4;
  if (!list.length) { text(page === 'week' ? 'No scores this week yet' : 'No scores yet', cx, y + 30, 16, '#ffffff', 'center', '700'); text('Be the first!', cx, y + 54, 16, '#ffd84a', 'center', '800'); return; }
  const half = width / 2;
  list.slice(0, 10).forEach((e, i) => {
    const yy = y + i * rowH, me = MINE && e.name === MINE.name && e.score === MINE.score;
    if (me) { rr(cx - half, yy - rowH / 2 + 1, width, rowH - 2, 8); ctx.fillStyle = 'rgba(255,216,74,.22)'; ctx.fill(); ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 1.2; ctx.stroke(); }
    else if (i % 2 === 0) { rr(cx - half, yy - rowH / 2 + 1, width, rowH - 2, 8); ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fill(); }
    const c = i === 0 ? '#ffe27a' : '#fff4fa';
    text(String(i + 1), cx - half + 16, yy, 13, i === 0 ? '#ffd84a' : '#ff9cc8', 'center', '800');
    text(String(e.name || '???'), cx - half + 36, yy, 14, c, 'left', '800', 2);
    text(Number(e.score).toLocaleString(), cx + half * 0.55, yy, 14, c, 'right', '800');
    text('LV ' + (e.level || 1), cx + half - 8, yy, 11, '#ff9cc8', 'right', '700');
  });
}
function drawStory(cx, y, lh) {
  const lines = [['Big Greasy, the meanest fry cook', '#ffffff'], ['across town, snatched Dottie —', '#ffffff'], ['the Flipside Diner’s jukebox singer!', '#ffd0e4'], ['', ''],
    ['Fight through the kitchen, the diner', '#ffffff'], ['and the back alley to his grill,', '#ffffff'], ['and bring her home, Frankie.', '#ffd84a']];
  text('THE STORY', cx, y, 12, '#7af0ff', 'center', '800', 2.5);
  lines.forEach(([s, c], i) => { if (s) text(s, cx, y + 28 + i * lh, 14, c, 'center', '700'); });
}
function drawTitle() {
  // a little diner scene behind the title card
  const saved = L; if (!L) L = { theme: 'diner' };
  ctx.save(); ctx.translate(0, HUD); drawBackground(); ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0, HUD, W, H - HUD);
  L = saved;
  const top = HUD + 10, bottom = H - 10, ph = bottom - top, cx = W / 2;
  panel(14, top, W - 28, ph);
  const bob = Math.sin(G.titleT * 3) * 2;
  bigText('SHORT ORDER', cx, top + 38 + bob, PORTRAIT ? 40 : 40, '#fff6e0', '#ff5f9e');
  bigText('HERO', cx, top + 82 - bob, 48, '#e8fdff', '#22c8e0', '#06303a');
  const pages = boardPages(), page = pages[Math.floor(G.titleT / 7) % pages.length];
  if (PORTRAIT) {
    const cy = top + 196;
    for (const sx of [cx - 90, cx + 90]) { ctx.fillStyle = rad(sx, cy, 4, 60, [[0, 'rgba(255,200,230,.28)'], [1, 'rgba(255,200,230,0)']]); ctx.beginPath(); ctx.ellipse(sx, cy, 60, 12, 0, 0, Math.PI * 2); ctx.fill(); }
    drawFrankie(cx - 90, cy, { face: 1, t: G.t, scale: 2.4, dance: true });
    heartShape(cx, cy - 70 + Math.sin(G.titleT * 4) * 4, 22, '#ff3a5a');
    drawDottie(cx + 90, cy, 2.1, G.titleT, { face: -1, wave: true });
    const by = cy + 34;
    if (page === 'story') drawStory(cx, by, 22); else drawBoard(page, cx, by, 22, W - 80);
    pages.forEach((p, i) => circle(cx - (pages.length - 1) * 7 + i * 14, bottom - 72, 3, p === page ? '#ff9cc8' : 'rgba(255,156,200,.3)'));
  } else {
    for (const sx of [92, W - 92]) { ctx.fillStyle = rad(sx, bottom - 26, 4, 70, [[0, 'rgba(255,200,230,.28)'], [1, 'rgba(255,200,230,0)']]); ctx.beginPath(); ctx.ellipse(sx, bottom - 26, 70, 14, 0, 0, Math.PI * 2); ctx.fill(); }
    drawFrankie(92, bottom - 26, { face: 1, t: G.t, scale: 2.7, dance: true });
    drawDottie(W - 92, bottom - 26, 2.4, G.titleT, { face: -1, wave: true });
    heartShape(W - 92, bottom - 168 + Math.sin(G.titleT * 4) * 4, 16, '#ff3a5a');
    const by = top + 122;
    if (page === 'story') drawStory(cx, by, 20); else drawBoard(page, cx, by, 19, 300);
    pages.forEach((p, i) => circle(cx - (pages.length - 1) * 7 + i * 14, bottom - 52, 3, p === page ? '#ff9cc8' : 'rgba(255,156,200,.3)'));
  }
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(G.titleT * 4);
  text(PORTRAIT ? 'TAP TO START' : IS_TOUCH ? 'TAP OR PRESS ENTER TO START' : 'PRESS ENTER OR CLICK TO START', cx, bottom - 34, 15, '#ffffff', 'center', '800', 2); ctx.globalAlpha = 1;
  if (!PORTRAIT) text('← → MOVE  ·  SPACE JUMP  ·  SHIFT RUN / THROW  ·  P PAUSE', cx, bottom - 14, 10, '#ff9cc8', 'center', '700', 1);
}
function drawTips() {
  ctx.fillStyle = 'rgba(10,2,8,.6)'; ctx.fillRect(0, HUD, W, H - HUD);
  const x = 14, y = HUD + 10, w = W - 28, h = Math.min(H - HUD - 20, 420);
  panel(x, y, w, h);
  bigText('HOW TO PLAY', W / 2, y + 30, 26);
  const rows = [
    ['hero', IS_TOUCH ? '◀ ▶ to move, A to jump.' : '← → to move, SPACE or Z to jump.', IS_TOUCH ? 'Hold B to run. Hold A to jump higher.' : 'Hold SHIFT or X to run. Hold jump to go higher.'],
    ['meat', 'Jump on kitchen pests to squash them.', 'Jell-O molds bounce you sky-high!'],
    ['jar', 'Bump tip jars from below.', 'Some hide treats. 100 tips = an extra life.'],
    ['sauce', IS_TOUCH ? 'Hot sauce: tap B to throw it.' : 'Hot sauce: SHIFT or X to throw it.', 'Milkshake = Sugar Rush. Pie = +1 heart.'],
    ['fryer', 'Keep out of fryer oil and off', 'hot griddles and fork trays.'],
    ['dottie', 'Reach the jukebox to clear a level,', 'then save Dottie from Big Greasy!'],
  ];
  const rowH = (h - 96) / rows.length;
  rows.forEach(([icon, l1, l2], i) => {
    const ry = y + 66 + i * rowH + rowH / 2 - 4, ix = x + 38;
    circle(ix, ry, 21, 'rgba(255,255,255,.07)');
    if (icon === 'hero') drawFrankie(ix, ry + 17, { face: 1, t: G.t });
    else if (icon === 'meat') drawEnemy({ type: 'meat', x: ix - 13, y: ry - 12, w: 26, h: 24, vx: 1, t: G.t, dead: false });
    else if (icon === 'jar') ctx.drawImage(sprite('jarIcon', T, T, () => drawJar(false)), ix - 15, ry - 16, 30, 30);
    else if (icon === 'sauce') drawItem('sauce', ix - 10, ry - 13, G.t);
    else if (icon === 'fryer') { ctx.save(); ctx.beginPath(); ctx.arc(ix, ry, 20, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = lin(0, ry - 4, 0, ry + 20, [[0, '#ffd56a'], [1, '#d88a1a']]); ctx.fillRect(ix - 20, ry - 2, 40, 22); circle(ix - 6, ry + 6, 3, 'rgba(255,240,190,.8)'); ctx.restore(); }
    else drawDottie(ix, ry + 19, 0.85, G.t, { face: 1 });
    text(l1, x + 72, ry - 9, 14, '#ffffff', 'left', '700');
    text(l2, x + 72, ry + 10, 13, '#ffbcd8', 'left', '600');
  });
  if (G.stateT > 0.4) { ctx.globalAlpha = 0.55 + 0.45 * Math.sin(G.stateT * 4); text(IS_TOUCH ? 'TAP TO START' : 'PRESS ENTER TO START', W / 2, y + h - 18, 14, '#ffffff', 'center', '800', 2); ctx.globalAlpha = 1; }
}
function drawIntro() {
  const a = G.stateT < 1.8 ? 1 : Math.max(0, 1 - (G.stateT - 1.8) / 0.4);
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = '#0c0408'; ctx.fillRect(0, HUD, W, FIELD);
  const cy = HUD + FIELD / 2;
  const newShift = L.loop > 0 && (G.levelNum - 1) % LEVELS.length === 0;
  bigText('LEVEL ' + G.levelNum, W / 2, cy - 60, 40);
  text(L.def.name, W / 2, cy - 18, 18, '#7af0ff', 'center', '900', 3);
  drawFrankie(W / 2 - 26, cy + 46, { face: 1, t: G.t, scale: 1.4 });
  text('× ' + G.lives, W / 2 + 4, cy + 26, 22, '#ffffff', 'left', '900');
  if (newShift) text('NEXT SHIFT — BIG GREASY’S BACK, AND HE’S MAD!', W / 2, cy + 82, 13, '#ffd84a', 'center', '800', 1);
  else if (L.boss) text('DOTTIE IS LOCKED IN HIS WALK-IN FREEZER!', W / 2, cy + 82, 13, '#ffd84a', 'center', '800', 1);
  else if (G.levelNum === 1) text('SAVE DOTTIE!', W / 2, cy + 82, 14, '#ffd84a', 'center', '800', 3);
  ctx.restore();
}
function drawClear() {
  const k = Math.min(1, G.stateT * 3), y0 = HUD + 18 - (1 - k) * 40, w = Math.min(W - 40, 440), x = (W - w) / 2;
  ctx.globalAlpha = k;
  panel(x, y0, w, 150);
  bigText('ORDER UP!', W / 2, y0 + 32, 32);
  const clue = L.def.clue;
  if (clue) { text(clue[0], W / 2, y0 + 70, 14, '#ffffff', 'center', '700'); text(clue[1], W / 2, y0 + 92, 15, '#ffd0e4', 'center', '800'); }
  text('TIME BONUS  ' + (Math.ceil(G.time) * 10).toLocaleString(), W / 2, y0 + 124, 14, '#ffd84a', 'center', '900', 2);
  ctx.globalAlpha = 1;
}
function drawWin() {
  if (G.stateT < 4.4) return;
  const k = Math.min(1, (G.stateT - 4.4) * 2), y0 = HUD + 18;
  ctx.globalAlpha = k;
  const w = Math.min(W - 40, 440), x = (W - w) / 2;
  panel(x, y0, w, 132);
  bigText('MY HERO!', W / 2, y0 + 36, 38, '#fff6e0', '#ff4f8a');
  text('Dottie is safe and the jukebox is playing again.', W / 2, y0 + 76, 13, '#ffffff', 'center', '700');
  text('RESCUE BONUS ' + (10000 * (1 + L.loop)).toLocaleString() + '   ·   TIME ' + (Math.ceil(G.time) * 10).toLocaleString(), W / 2, y0 + 104, 12, '#ffd84a', 'center', '900', 1);
  ctx.globalAlpha = 1;
}
function menuButtons() {
  const cy = HUD + FIELD / 2;
  const make = (labels, y) => {
    const bw = labels.length === 3 ? 124 : 150, gap = 12, tot = labels.length * bw + (labels.length - 1) * gap;
    return labels.map(([id, label, primary], i) => ({ id, label, primary, x: W / 2 - tot / 2 + i * (bw + gap), y, w: bw, h: 42 }));
  };
  if (G.state === 'paused') return make([['resume', 'RESUME', true], ['arcade', '◀ ARCADE', false]], cy + 10);
  if (G.state === 'over' && G.stateT > 1.3 && G.entryHandled && !entryOpen)
    return make([['again', 'PLAY AGAIN', true], ['top', 'TOP 10', false], ['arcade', '◀ ARCADE', false]], cy + 40);
  return [];
}
function drawOverlays() {
  const cy = HUD + FIELD / 2;
  if (G.state === 'paused') {
    ctx.fillStyle = 'rgba(10,2,8,.45)'; ctx.fillRect(0, HUD, W, FIELD);
    panel(W / 2 - 180, cy - 78, 360, 148); bigText('PAUSED', W / 2, cy - 34, 36);
  } else if (G.state === 'over') {
    ctx.fillStyle = 'rgba(10,2,8,.55)'; ctx.fillRect(0, HUD, W, FIELD);
    const ow = Math.min(420, W - 24); panel(W / 2 - ow / 2, cy - 100, ow, 206);
    bigText('GAME OVER', W / 2, cy - 60, 40, '#ffffff', '#ff6a5a');
    text('SCORE ' + G.score.toLocaleString() + '   ·   LEVEL ' + G.levelNum, W / 2, cy - 18, 16, '#ffffff', 'center', '800', 1);
    const rl = rankLine(); if (rl) text(rl, W / 2, cy + 10, 14, '#ffd84a', 'center', '900', 1);
  }
  for (const b of menuButtons()) { glassButton(b.x, b.y, b.w, b.h, b.primary); text(b.label, b.x + b.w / 2, b.y + b.h / 2 + 0.5, 14, '#ffffff', 'center', '800', 1.2); }
  if (G.msgT > 0 && G.state === 'play') {
    ctx.globalAlpha = Math.min(1, G.msgT * 2);
    bigText(G.msg, W / 2, cy - 40, 32);
    if (G.sub) text(G.sub, W / 2, cy - 8, 13, '#ffe7f0', 'center', '800', 1.5);
    ctx.globalAlpha = 1;
  }
}
function touchButtons() {
  if (!IS_TOUCH) return [];
  if (PORTRAIT) {
    const r = Math.min(44, PAD * 0.28), py = HUD + FIELD + PAD * 0.5;
    return [{ id: 'left', x: 14 + r, y: py, r }, { id: 'right', x: 14 + r * 3.2, y: py, r },
      { id: 'run', x: W - 14 - r * 3.1, y: py + r * 0.45, r: r * 0.8 }, { id: 'jump', x: W - 14 - r, y: py - r * 0.3, r }];
  }
  const r = 32, py = HUD + FIELD - 46;
  return [{ id: 'left', x: 46, y: py, r }, { id: 'right', x: 124, y: py, r }, { id: 'run', x: W - 124, y: py + 8, r: r * 0.85 }, { id: 'jump', x: W - 46, y: py - 6, r }];
}
function drawTouchPad() {
  // Upright phones always get the button panel. Wide screens (touch laptops, phones held sideways)
  // only show the overlay buttons once someone actually touches the screen.
  if (!IS_TOUCH || (!PORTRAIT && !lastTouch)) return;
  if (PORTRAIT) {
    ctx.fillStyle = lin(0, HUD + FIELD, 0, H, [[0, '#1e0a18'], [1, '#0c0408']]); ctx.fillRect(0, HUD + FIELD, W, PAD);
    ctx.fillStyle = 'rgba(255,140,190,.5)'; ctx.fillRect(0, HUD + FIELD, W, 1.5);
  }
  if (G.state === 'title' || G.state === 'tips' || G.state === 'over') { if (PORTRAIT && G.state !== 'title') text('JONES RIDGE ARCADE', W / 2, HUD + FIELD + PAD / 2, 12, 'rgba(255,156,200,.4)', 'center', '800', 3); return; }
  for (const b of touchButtons()) {
    const on = touchBtn[b.id];
    ctx.globalAlpha = PORTRAIT ? 1 : 0.55;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = on ? 'rgba(255,120,180,.55)' : b.id === 'jump' ? 'rgba(255,80,120,.25)' : 'rgba(255,255,255,.12)'; ctx.fill();
    ctx.strokeStyle = on ? '#ffd0e4' : 'rgba(255,200,225,.55)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffffff';
    if (b.id === 'left' || b.id === 'right') {
      const d = b.id === 'left' ? -1 : 1, s = b.r * 0.38;
      ctx.beginPath(); ctx.moveTo(b.x + d * s, b.y); ctx.lineTo(b.x - d * s * 0.6, b.y - s); ctx.lineTo(b.x - d * s * 0.6, b.y + s); ctx.closePath(); ctx.fill();
    } else text(b.id === 'jump' ? 'A' : 'B', b.x, b.y + 1, b.r * 0.7, '#ffffff', 'center', '900');
    if (PORTRAIT) text(b.id === 'jump' ? 'JUMP' : b.id === 'run' ? (P && P.power ? 'THROW' : 'RUN') : '', b.x, b.y + b.r + 12, 10, 'rgba(255,200,225,.7)', 'center', '800', 1.5);
  }
  ctx.globalAlpha = 1;
}
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (G.state === 'title') { drawTitle(); drawHUD(); return; }
  ctx.save();
  if (G.shake > 0 && (G.state === 'play' || G.state === 'win')) ctx.translate((Math.random() - 0.5) * 10 * G.shake, (Math.random() - 0.5) * 10 * G.shake);
  if (L) drawWorld();
  ctx.restore();
  if (L) {
    ctx.drawImage(sprite('vig:' + W, W, FIELD, (w, h) => { ctx.fillStyle = rad(w / 2, h * 0.45, h * 0.35, w * 0.75, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.42)']]); ctx.fillRect(0, 0, w, h); }), 0, HUD, W, FIELD);
    // iris wipe: opens on Frankie when a level starts, closes on him when he goes down
    let iris = -1;
    if (G.state === 'play' && G.irisT < 0.6) iris = G.irisT / 0.6;
    else if (G.state === 'dying' && G.stateT > 1.6) iris = Math.max(0, 1 - (G.stateT - 1.6) / 0.8);
    if (iris >= 0 && P) {
      const hx = P.x + P.w / 2 - cam.x, hy = HUD + clamp(P.y + P.h / 2, 0, FIELD), R = Math.hypot(W, FIELD) * Math.pow(iris, 1.6);
      ctx.save(); ctx.beginPath(); ctx.rect(0, HUD, W, FIELD); ctx.arc(hx, hy, Math.max(0.1, R), 0, Math.PI * 2, true); ctx.fillStyle = '#0c0408'; ctx.fill('evenodd'); ctx.restore();
    }
  }
  drawTouchPad();
  if (G.state === 'tips') drawTips();
  if (G.state === 'intro') drawIntro();
  if (G.state === 'clear') drawClear();
  if (G.state === 'win') drawWin();
  drawOverlays();
  drawHUD();
}

/* ---------------- input handling ---------------- */
function canvasPt(cx, cy) { const r = cv.getBoundingClientRect(); return { x: (cx - r.left) / r.width * W, y: (cy - r.top) / r.height * H }; }
function toggleMute() { muted = !muted; lsSet(GAME_ID + '.muted', muted ? '1' : '0'); if (!muted && G.state === 'play') musicStart(!!(L && L.arena && L.arena.on)); }
function releaseAll() { for (const k in keys) keys[k] = false; for (const k in touchBtn) touchBtn[k] = false; }
function togglePause() {
  if (G.state === 'play') { G.state = 'paused'; releaseAll(); musicStop(); }
  else if (G.state === 'paused') { G.state = 'play'; musicStart(!!(L && L.arena && L.arena.on)); }
}
function menuAction(id) {
  audio(); sfx.select();
  if (id === 'resume') togglePause();
  else if (id === 'again') startGame();
  else if (id === 'top') toTitle();
  else if (id === 'arcade') location.href = '/';
}
function endTips() { lsSet(GAME_ID + '.tipsSeen', '1'); startLevel(); }
function confirm() {
  if (entryOpen) return;
  audio();
  if (G.state === 'title') { sfx.select(); startGame(); }
  else if (G.state === 'tips') { if (G.stateT > 0.4) endTips(); }
  else if (G.state === 'paused') togglePause();
  else if (G.state === 'over') { if (G.stateT > 1.3 && G.entryHandled) startGame(); }
}
// Returns true if the tap landed on a button or menu.
function tapAt(x, y) {
  if (entryOpen) return true;
  audio();
  if (y < HUD) {
    if (x > W - 52) { if (G.state === 'play' || G.state === 'paused') togglePause(); return true; }
    if (x > W - 102) { toggleMute(); return true; }
    if (x < 130 && G.state === 'title') { location.href = '/'; return true; }
    return G.state !== 'play';
  }
  const mb = menuButtons().find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  if (mb) { menuAction(mb.id); return true; }
  if (G.state === 'over') return true;
  if (G.state === 'play' || G.state === 'intro' || G.state === 'dying' || G.state === 'clear' || G.state === 'win') return false;
  confirm(); return true;
}
const uiTouches = new Set();
function syncTouches(list) {
  for (const k in touchBtn) touchBtn[k] = false;
  const btns = touchButtons();
  for (const t of list) {
    if (uiTouches.has(t.identifier)) continue;
    const p = canvasPt(t.clientX, t.clientY);
    let bestB = null, bestD = 1e9;
    for (const b of btns) { const d = Math.hypot(p.x - b.x, p.y - b.y) / b.r; if (d < bestD) { bestD = d; bestB = b; } }
    if (bestB && bestD < 1.7) touchBtn[bestB.id] = true;
  }
}
cv.addEventListener('touchstart', e => {
  e.preventDefault(); lastTouch = performance.now(); audio();
  for (const t of e.changedTouches) { const p = canvasPt(t.clientX, t.clientY); if (tapAt(p.x, p.y)) uiTouches.add(t.identifier); }
  syncTouches(e.touches);
}, { passive: false });
cv.addEventListener('touchmove', e => { e.preventDefault(); syncTouches(e.touches); }, { passive: false });
const endTouch = e => { e.preventDefault(); lastTouch = performance.now(); for (const t of e.changedTouches) uiTouches.delete(t.identifier); syncTouches(e.touches); };
cv.addEventListener('touchend', endTouch, { passive: false });
cv.addEventListener('touchcancel', endTouch, { passive: false });
cv.addEventListener('mousedown', e => {
  e.preventDefault();
  if (performance.now() - lastTouch < 800) return;
  const p = canvasPt(e.clientX, e.clientY);
  tapAt(p.x, p.y);
});
const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ' ': 'jump', ArrowUp: 'jump', w: 'jump', W: 'jump', z: 'jump', Z: 'jump',
  Shift: 'run', x: 'run', X: 'run', k: 'run', K: 'run' };
addEventListener('keydown', e => {
  if (entryOpen) return;
  const k = KEYMAP[e.key];
  if (k) {
    e.preventDefault(); audio();
    if (G.state === 'play' || G.state === 'intro' || G.state === 'dying' || G.state === 'clear' || G.state === 'win') { keys[k] = true; return; }
    if (k === 'jump' && !e.repeat && e.key !== 'ArrowUp') confirm();
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) confirm(); }
  else if (e.key === 'p' || e.key === 'P') togglePause();
  else if (e.key === 'm' || e.key === 'M') toggleMute();
  else if (e.key === 'Escape') {
    if (G.state === 'play' || G.state === 'paused') togglePause();
    else if (G.state === 'title') location.href = '/';
    else if (G.state === 'over' && G.entryHandled && G.stateT > 1.3) location.href = '/';
  }
});
addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });
addEventListener('blur', () => { releaseAll(); if (G.state === 'play') togglePause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play') togglePause(); });

/* ---------------- initials entry ---------------- */
const iniBox = document.getElementById('ini'), iniForm = iniBox.querySelector('form');
const iniIn = document.getElementById('iniIn'), iniMsg = document.getElementById('iniMsg');
const iniSave = document.getElementById('iniSave'), iniSkip = document.getElementById('iniSkip');
function openEntry() {
  entryOpen = true; iniBox.hidden = false; iniMsg.textContent = ''; iniSave.disabled = false;
  document.getElementById('iniScore').textContent = G.score.toLocaleString() + ' POINTS · LEVEL ' + G.levelNum;
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
  const res = await submitScore(name, G.score, G.levelNum);
  if (res === true) closeEntry(); else { iniMsg.textContent = res; iniSave.disabled = false; }
});
iniSkip.addEventListener('click', closeEntry);

/* ---------------- loop ---------------- */
fit();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Debug-only: paints the home-screen icon with the game's own artwork.
function paintIcon(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const saved = ctx; ctx = c.getContext('2d'); const k = size / 192; ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = lin(0, 0, 0, 192, [[0, '#6fd0c4'], [1, '#3fa89c']]); ctx.fillRect(0, 0, 192, 192);
  ctx.fillStyle = 'rgba(255,255,255,.14)'; for (let x = 0; x < 192; x += 16) ctx.fillRect(x, 0, 1.5, 132);
  ctx.fillStyle = lin(0, 0, 0, 8, [[0, '#ffffff'], [1, '#9aa2b0']]); ctx.fillRect(0, 118, 192, 8);
  ctx.fillStyle = '#c8203a'; ctx.fillRect(0, 126, 192, 26);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 3; j++) { ctx.fillStyle = (i + j) % 2 ? '#1d1d22' : '#f4f1e8'; ctx.fillRect(i * 16, 152 + j * 14, 16, 14); }
  glow(96, 60, 90, '255,230,160', 0.35);
  heartShape(150, 22, 26, '#ff3a5a');
  drawDottie(150, 150, 2.1, 0.4, { face: -1, wave: true });
  drawEnemy({ type: 'meat', x: 70, y: 128, w: 26, h: 24, vx: 1, t: 0, dead: false });
  drawFrankie(62, 120, { face: 1, air: true, scale: 2.5 });
  ctx = saved; return c.toDataURL('image/png');
}
if (DEBUG) window.HERO = { paintIcon, G, get L() { return L; }, set L(v) { L = v; }, get P() { return P; }, set P(v) { P = v; }, cam, startLevel, buildLevel, moveBody, onPlatforms, newHero, isSolid, tileAt, SEGS, LEVELS, update, draw, keys, input };
})();

const AUDIO_SRC = "Overkill Beatz - 90's NINTENDO (Video Game Beat).mp3";

// canvas
const cv = document.getElementById('gc');
const ct = cv.getContext('2d');

// Fixed grid size (must be ODD for maze algorithm to work well)
const COLS = 51, ROWS = 41;

// Dynamic tile size + canvas CSS size (in CSS pixels)
let T = 18;
let CW = COLS * T, CH = ROWS * T;

function resizeToFit() {
  const HUD_H = 34; // must match #hud height in index.html
  const availW = window.innerWidth;
  const availH = window.innerHeight - HUD_H;

  const tileW = Math.floor(availW / COLS);
  const tileH = Math.floor(availH / ROWS);

  T = Math.max(8, Math.min(tileW, tileH));
  CW = COLS * T;
  CH = ROWS * T;

  const dpr = window.devicePixelRatio || 1;

  cv.style.width = `${CW}px`;
  cv.style.height = `${CH}px`;
  cv.width = Math.floor(CW * dpr);
  cv.height = Math.floor(CH * dpr);

  ct.setTransform(dpr, 0, 0, dpr, 0, 0);
  ct.imageSmoothingEnabled = false;
}

window.addEventListener('resize', resizeToFit);
resizeToFit();

// -------------------- HELPERS --------------------
function inBounds(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}
function keyXY(x, y) { return `${x},${y}`; }
function rndInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); } // inclusive
function neighbors4(x, y) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ].filter(n => inBounds(n.x, n.y));
}

// -------------------- RUN PERSISTENCE (Curious distribution) --------------------
// Requirement: total 20 across 10 levels, at least 1 per level, random distribution,
// and MUST stay the same for the entire run even if the page refreshes.
// After beating level 10 and pressing START, we create a new run distribution.
const RUN_STORAGE_KEY = "ashoka_run_v1";

function makeCuriousDistribution() {
  const base = Array(10).fill(1); // at least 1 per level => 10
  let remaining = 10;            // add 10 more => total 20
  while (remaining > 0) {
    base[rndInt(0, 9)]++;
    remaining--;
  }
  return base;
}

function loadOrCreateRunState() {
  try {
    const raw = localStorage.getItem(RUN_STORAGE_KEY);
    if (raw) {
      const st = JSON.parse(raw);

      const d = st?.curiousPerLevel;
      const okDist =
        Array.isArray(d) &&
        d.length === 10 &&
        d.every(n => Number.isInteger(n) && n >= 1) &&
        d.reduce((a, b) => a + b, 0) === 20;

      if (okDist) {
        return {
          runId: String(st.runId || Date.now()),
          curiousPerLevel: d,
          curiousCollected: Number.isInteger(st.curiousCollected) ? st.curiousCollected : 0
        };
      }
    }
  } catch (_) {}

  const st = {
    runId: String(Date.now()),
    curiousPerLevel: makeCuriousDistribution(),
    curiousCollected: 0
  };

  try { localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(st)); } catch (_) {}
  return st;
}

function saveRunState() {
  try {
    localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify({
      runId: G.run.runId,
      curiousPerLevel: G.run.curiousPerLevel,
      curiousCollected: G.run.curiousCollected
    }));
  } catch (_) {}
}

function clearRunState() {
  try { localStorage.removeItem(RUN_STORAGE_KEY); } catch (_) {}
}

// -------------------- AUDIO --------------------
let bgMusic = null;
let musicOn = true;

function initAudio() {
  if (bgMusic) return;
  bgMusic = new Audio(AUDIO_SRC);
  bgMusic.loop = true;
  bgMusic.volume = 0.55;
}
function playMusic() {
  if (!musicOn) return;
  initAudio();
  bgMusic.play().catch(() => {});
}
function pauseMusic() { if (bgMusic) bgMusic.pause(); }
function resumeMusic() { if (bgMusic && musicOn) bgMusic.play().catch(() => {}); }
function toggleMusic() { musicOn = !musicOn; if (musicOn) resumeMusic(); else pauseMusic(); }

// -------------------- GAME STATE --------------------
let G = {};

function initG(level = 1) {
  // load or preserve run-state
  const run = G.run || loadOrCreateRunState();

  G = {
    screen: 'menu',
    level,
    t: 0,

    player: { x: 1, y: 1 },

    map: null,       // 0 floor, 1 wall
    _reachable: null,

    exitX: COLS - 2,
    exitY: ROWS - 2,

    run: {
      runId: run.runId,
      curiousPerLevel: run.curiousPerLevel,  // [10]
      curiousCollected: run.curiousCollected // 0..20 across whole run
    },

    curious: {
      // per-level items
      thisLevel: 0,
      items: [] // {x,y, taken:false}
    },

    guards: [], // {x,y, acc, stepInterval, mode, patrolTarget, path, pathIdx, repathAcc}

    gas: {
      active: false,
      source: { x: 1, y: 1 },
      frontier: [],
      filled: new Set(),
      acc: 0
    }
  };
}

function isWall(x, y) {
  return !inBounds(x, y) || G.map[y][x] === 1;
}

// -------------------- BFS --------------------
// BFS distance w/ optional depth cutoff
function bfsDistance(sx, sy, tx, ty, maxDepth = 9999) {
  if (sx === tx && sy === ty) return 0;
  if (isWall(sx, sy) || isWall(tx, ty)) return Infinity;

  const q = [{ x: sx, y: sy, d: 0 }];
  const seen = new Set([keyXY(sx, sy)]);

  while (q.length) {
    const cur = q.shift();
    if (cur.d >= maxDepth) continue;

    for (const n of neighbors4(cur.x, cur.y)) {
      if (isWall(n.x, n.y)) continue;
      const k = keyXY(n.x, n.y);
      if (seen.has(k)) continue;

      const nd = cur.d + 1;
      if (n.x === tx && n.y === ty) return nd;

      seen.add(k);
      q.push({ x: n.x, y: n.y, d: nd });
    }
  }
  return Infinity;
}

// BFS path (for guards / same paths as Lazz)
function bfsPath(sx, sy, tx, ty, maxNodes = 8000) {
  if (sx === tx && sy === ty) return [{ x: sx, y: sy }];
  if (isWall(sx, sy) || isWall(tx, ty)) return null;

  const q = [{ x: sx, y: sy }];
  const prev = new Map(); // key -> prevKey
  prev.set(keyXY(sx, sy), null);

  let visited = 0;

  while (q.length && visited < maxNodes) {
    visited++;
    const cur = q.shift();

    for (const n of neighbors4(cur.x, cur.y)) {
      if (isWall(n.x, n.y)) continue;
      const nk = keyXY(n.x, n.y);
      if (prev.has(nk)) continue;

      prev.set(nk, keyXY(cur.x, cur.y));

      if (n.x === tx && n.y === ty) {
        // reconstruct
        const path = [{ x: tx, y: ty }];
        let k = prev.get(keyXY(tx, ty));
        while (k) {
          const [xs, ys] = k.split(',');
          path.push({ x: +xs, y: +ys });
          k = prev.get(k);
        }
        path.reverse();
        return path;
      }

      q.push({ x: n.x, y: n.y });
    }
  }

  return null;
}

// reachable floor tiles from spawn (guarantees items and exit are reachable)
function computeReachableFromSpawn() {
  const sx = G.player.x, sy = G.player.y;
  if (isWall(sx, sy)) return [];

  const out = [];
  const q = [{ x: sx, y: sy }];
  const seen = new Set([keyXY(sx, sy)]);

  while (q.length) {
    const cur = q.shift();
    out.push(cur);

    for (const n of neighbors4(cur.x, cur.y)) {
      if (isWall(n.x, n.y)) continue;
      const nk = keyXY(n.x, n.y);
      if (seen.has(nk)) continue;
      seen.add(nk);
      q.push(n);
    }
  }

  return out;
}

// -------------------- MAZE GENERATION --------------------
// Perfect maze via DFS backtracker on odd grid cells.
// Convention: walls everywhere, carve passages on odd cells.
// This guarantees a path exists from spawn to any reachable tile.
function buildMazeMap() {
  const m = Array.from({ length: ROWS }, () => Array(COLS).fill(1));

  const start = { x: 1, y: 1 };
  m[start.y][start.x] = 0;

  const stack = [start];
  const dirs = [
    { dx: 2, dy: 0 },
    { dx: -2, dy: 0 },
    { dx: 0, dy: 2 },
    { dx: 0, dy: -2 }
  ];

  function inCellBounds(x, y) {
    return x > 0 && x < COLS - 1 && y > 0 && y < ROWS - 1;
  }

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const shuffled = dirs.slice().sort(() => Math.random() - 0.5);

    let carved = false;
    for (const d of shuffled) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (!inCellBounds(nx, ny)) continue;
      if (m[ny][nx] === 0) continue;

      const wx = cur.x + d.dx / 2;
      const wy = cur.y + d.dy / 2;

      m[wy][wx] = 0;
      m[ny][nx] = 0;

      stack.push({ x: nx, y: ny });
      carved = true;
      break;
    }

    if (!carved) stack.pop();
  }

  return m;
}

// pick farthest reachable tile from spawn -> exit
function placeExit(reachable) {
  let best = reachable[0];
  let bestD = -1;

  for (const p of reachable) {
    const d = bfsDistance(G.player.x, G.player.y, p.x, p.y);
    if (Number.isFinite(d) && d > bestD) {
      bestD = d;
      best = p;
    }
  }

  G.exitX = best.x;
  G.exitY = best.y;
}

// place curious points (always on reachable tiles, so always path exists)
function placeCurious(reachable) {
  const want = G.run.curiousPerLevel[G.level - 1] ?? 1;
  G.curious.thisLevel = want;

  const items = [];

  const candidates = reachable.filter(p => {
    if (p.x === G.player.x && p.y === G.player.y) return false;
    if (p.x === G.exitX && p.y === G.exitY) return false;
    const d = bfsDistance(G.player.x, G.player.y, p.x, p.y, 9999);
    return Number.isFinite(d) && d >= 6;
  });

  const pool = candidates.length ? candidates : reachable.slice();

  const minSep = 7;
  let attempts = 0;

  while (items.length < want && attempts < 3000) {
    attempts++;
    const p = pool[rndInt(0, pool.length - 1)];
    if (p.x === G.exitX && p.y === G.exitY) continue;
    if (p.x === G.player.x && p.y === G.player.y) continue;

    let ok = true;
    for (const it of items) {
      const d = bfsDistance(it.x, it.y, p.x, p.y, 9999);
      if (Number.isFinite(d) && d < minSep) { ok = false; break; }
    }
    if (!ok) continue;

    items.push({ x: p.x, y: p.y, taken: false });
  }

  // fallback (guarantee >= 1 if want >= 1)
  while (items.length < want && pool.length) {
    const p = pool[rndInt(0, pool.length - 1)];
    if (p.x === G.exitX && p.y === G.exitY) continue;
    if (p.x === G.player.x && p.y === G.player.y) continue;
    items.push({ x: p.x, y: p.y, taken: false });
  }

  G.curious.items = items;
}

// -------------------- GUARDS --------------------
// Requirement: guards increase patrol speed gradually per level,
// and they can take the same paths as Lazz (walkable tiles, BFS path).
function guardCountForLevel(level) {
  // Your requested counts:
  // 1-3 => 3, 4-7 => 4, 8-10 => 6
  if (level <= 3) return 3;
  if (level <= 7) return 4;
  return 6;
}

function guardStepInterval(level) {
  // smaller interval => faster
  // L1 ~0.55s/tile, gets faster each level, clamped
  return Math.max(0.18, 0.55 - (level - 1) * 0.035);
}

function spawnGuards(reachable) {
  G.guards = [];
  const want = guardCountForLevel(G.level);
  const minFromPlayer = (G.level <= 3) ? 8 : 10;

  let tries = 0;
  while (G.guards.length < want && tries < 8000) {
    tries++;
    const p = reachable[rndInt(0, reachable.length - 1)];

    if ((p.x === G.player.x && p.y === G.player.y) || (p.x === G.exitX && p.y === G.exitY)) continue;
    if (G.curious.items.some(it => !it.taken && it.x === p.x && it.y === p.y)) continue;

    const d = bfsDistance(G.player.x, G.player.y, p.x, p.y, 9999);
    if (!Number.isFinite(d) || d < minFromPlayer) continue;

    G.guards.push({
      x: p.x, y: p.y,
      acc: 0,
      stepInterval: guardStepInterval(G.level),
      mode: 'patrol', // or 'chase'
      patrolTarget: null,
      path: null,
      pathIdx: 0,
      repathAcc: 0
    });
  }
}

function pickRandomPatrolTarget(reachable) {
  return reachable[rndInt(0, reachable.length - 1)];
}

function updateGuards(dt, reachable) {
  for (const gd of G.guards) {
    gd.acc += dt;
    gd.repathAcc += dt;

    const dToPlayer = bfsDistance(gd.x, gd.y, G.player.x, G.player.y, 12);
    const shouldChase = Number.isFinite(dToPlayer) && dToPlayer <= 12;
    gd.mode = shouldChase ? 'chase' : 'patrol';

    const repathEvery = (gd.mode === 'chase') ? 0.35 : 1.2;
    if (!gd.path || gd.repathAcc >= repathEvery) {
      gd.repathAcc = 0;

      let tx, ty;
      if (gd.mode === 'chase') {
        tx = G.player.x; ty = G.player.y;
      } else {
        if (!gd.patrolTarget || (gd.x === gd.patrolTarget.x && gd.y === gd.patrolTarget.y)) {
          gd.patrolTarget = pickRandomPatrolTarget(reachable);
        }
        tx = gd.patrolTarget.x; ty = gd.patrolTarget.y;
      }

      gd.path = bfsPath(gd.x, gd.y, tx, ty);
      gd.pathIdx = 0;
    }

    while (gd.acc >= gd.stepInterval) {
      gd.acc -= gd.stepInterval;
      if (!gd.path || gd.path.length < 2) break;

      const nextIdx = Math.min(gd.path.length - 1, gd.pathIdx + 1);
      const nxt = gd.path[nextIdx];
      if (isWall(nxt.x, nxt.y)) break;

      gd.x = nxt.x;
      gd.y = nxt.y;
      gd.pathIdx = nextIdx;
    }

    // caught
    if (gd.x === G.player.x && gd.y === G.player.y) {
      // restart same level, keep run state
      startLevel(G.level, /*newRun*/false);
      return;
    }
  }
}

// -------------------- GAS (trigger + diffusion) --------------------
function gasTriggerDistance(level) {
  return (level >= 5) ? 10 : 4;
}
function gasIntervalSeconds(level) {
  const base = 2.0;
  const perLevelDelta = 0.5;
  const interval = base - (level - 1) * perLevelDelta;
  return Math.max(0.35, interval);
}

function ensureGasSeeded() {
  const g = G.gas;
  if (g.frontier.length || g.filled.size) return;
  if (isWall(g.source.x, g.source.y)) return;

  g.frontier.push({ x: g.source.x, y: g.source.y });
  g.filled.add(keyXY(g.source.x, g.source.y));
}

function spreadGasOneStep() {
  const g = G.gas;
  if (!g.frontier.length) return;

  const cur = g.frontier.shift();
  for (const n of neighbors4(cur.x, cur.y)) {
    if (isWall(n.x, n.y)) continue;

    const k = keyXY(n.x, n.y);
    if (g.filled.has(k)) continue;

    g.filled.add(k);
    g.frontier.push({ x: n.x, y: n.y });
  }
}

function updateGas(dt) {
  const g = G.gas;
  const trig = gasTriggerDistance(G.level);
  const dist = bfsDistance(g.source.x, g.source.y, G.player.x, G.player.y, trig);

  if (!g.active) {
    if (Number.isFinite(dist) && dist >= trig) {
      g.active = true;
      ensureGasSeeded();
      g.acc = 0;
    } else {
      return;
    }
  }

  ensureGasSeeded();

  const interval = gasIntervalSeconds(G.level);
  g.acc += dt;

  while (g.acc >= interval) {
    g.acc -= interval;
    spreadGasOneStep();
  }

  // if player is in gas -> restart same level
  if (g.filled.has(keyXY(G.player.x, G.player.y))) {
    startLevel(G.level, /*newRun*/false);
  }
}

// -------------------- INPUT --------------------
let moveQ = [];
document.addEventListener('keydown', e => {
  if (G.screen !== 'playing') return;
  const k = e.key.toLowerCase();

  if (k === 'w' || k === 'arrowup') moveQ.push([-1, 0]);
  if (k === 's' || k === 'arrowdown') moveQ.push([1, 0]);
  if (k === 'a' || k === 'arrowleft') moveQ.push([0, -1]);
  if (k === 'd' || k === 'arrowright') moveQ.push([0, 1]);

  if (k === 'm') toggleMusic();
});

// -------------------- MOVEMENT --------------------
function processMove() {
  if (!moveQ.length) return;

  const [dr, dc] = moveQ.shift();
  const nx = G.player.x + dc;
  const ny = G.player.y + dr;

  if (!inBounds(nx, ny)) return;
  if (G.map[ny][nx] === 1) return;

  G.player.x = nx;
  G.player.y = ny;

  // pickup curious items (counts towards 20 total)
  for (const it of G.curious.items) {
    if (!it.taken && it.x === nx && it.y === ny) {
      it.taken = true;
      G.run.curiousCollected = Math.min(20, G.run.curiousCollected + 1);
      saveRunState();
    }
  }

  // exit reached: next level or end
  if (nx === G.exitX && ny === G.exitY) {
    if (G.level >= 10) {
      G.screen = "won";
      saveRunState();
    } else {
      startLevel(G.level + 1, /*newRun*/false);
    }
  }
}

// -------------------- HUD (optional) --------------------
function setHudText() {
  const left = document.getElementById("h-left");
  const mid = document.getElementById("h-mid");
  const right = document.getElementById("h-right");
  if (!left || !mid || !right) return;

  left.textContent = `LV${G.level} · FUMIGATION`;
  mid.textContent = `TIME: ${Math.floor(G.t)}s`;
  right.textContent = `CURIOUS: ${G.run.curiousCollected}/20`;
}

// -------------------- DRAW --------------------
function draw() {
  ct.clearRect(0, 0, CW, CH);

  // map
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ct.fillStyle = G.map[r][c] === 1 ? '#222' : '#0d0d1d';
      ct.fillRect(c * T, r * T, T, T);
    }
  }

  // curious items
  for (const it of G.curious.items) {
    if (it.taken) continue;
    ct.fillStyle = '#8ad0ff';
    ct.fillRect(it.x * T + T * 0.25, it.y * T + T * 0.25, T * 0.5, T * 0.5);
  }

  // exit
  ct.fillStyle = '#22cc55';
  ct.fillRect(G.exitX * T, G.exitY * T, T, T);

  // gas overlay
  if (G.gas.filled.size) {
    ct.fillStyle = 'rgba(34, 204, 85, 0.28)';
    for (const k of G.gas.filled) {
      const [xs, ys] = k.split(',');
      ct.fillRect((+xs) * T, (+ys) * T, T, T);
    }
  }

  // guards
  for (const gd of G.guards) {
    ct.fillStyle = '#cc3333';
    ct.fillRect(gd.x * T, gd.y * T, T, T);
  }

  // player
  ct.fillStyle = '#c8a84b';
  ct.fillRect(G.player.x * T, G.player.y * T, T, T);

  // win overlay
  if (G.screen === "won") {
    ct.fillStyle = 'rgba(0,0,0,0.65)';
    ct.fillRect(0, 0, CW, CH);

    ct.fillStyle = '#c8a84b';
    ct.font = `${Math.max(14, T)}px monospace`;
    ct.fillText("ARCHIVES CLEARED!", 20, 40);

    ct.font = `${Math.max(12, T * 0.8)}px monospace`;
    ct.fillText(`Curious Points: ${G.run.curiousCollected} / 20`, 20, 70);
    ct.fillText("Press START to play again", 20, 100);
  }
}

// -------------------- LOOP --------------------
let last = 0;
function loop(ts) {
  const dt = (ts - last) / 1000;
  last = ts;

  if (G.screen === 'playing') {
    G.t += dt;

    const reachable = G._reachable || computeReachableFromSpawn();
    G._reachable = reachable;

    processMove();
    updateGuards(dt, reachable);
    updateGas(dt);
    setHudText();
    draw();
  } else if (G.screen === "won") {
    setHudText();
    draw();
  }

  requestAnimationFrame(loop);
}

// -------------------- LEVEL/START --------------------
function startLevel(level, newRun) {
  if (newRun) {
    clearRunState();
    // after clearing, initG() will re-create a new run state
    G.run = null;
  }

  // Preserve run state across level restarts (deaths)
  const run = newRun ? null : (G.run || loadOrCreateRunState());

  initG(level);

  // re-apply preserved run
  if (run) {
    G.run.runId = run.runId;
    G.run.curiousPerLevel = run.curiousPerLevel;
    G.run.curiousCollected = run.curiousCollected;
  }

  // build maze + compute reachable set
  G.map = buildMazeMap();

  // ensure spawn is floor
  G.player.x = 1; G.player.y = 1;
  G.map[G.player.y][G.player.x] = 0;

  const reachable = computeReachableFromSpawn();
  G._reachable = reachable;

  // guaranteed reachable exit + curious points
  placeExit(reachable);
  placeCurious(reachable);

  // guards (walk same paths as player) and speed scales per level
  spawnGuards(reachable);

  // reset gas for each (re)start
  G.gas.active = false;
  G.gas.source = { x: 1, y: 1 };
  G.gas.frontier = [];
  G.gas.filled = new Set();
  G.gas.acc = 0;

  G.screen = 'playing';
  playMusic();
  saveRunState();
}

function startGame() {
  // If you won, START begins a new run with a new distribution
  const newRun = (G.screen === "won");
  startLevel(1, newRun);
}

window.startGame = startGame;

// boot
initG(1);
requestAnimationFrame(loop);

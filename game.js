const AUDIO_SRC = "Overkill Beatz - 90's NINTENDO (Video Game Beat).mp3";

// canvas
const cv = document.getElementById('gc');
const ct = cv.getContext('2d');

const T = 18, COLS = 51, ROWS = 41;
const CW = COLS * T, CH = ROWS * T;
cv.width = CW; cv.height = CH;

let G = {};

function initG() {
  G = {
    screen: 'menu',
    level: 1,
    player: { x: 1, y: 1 },
    map: null,
    exitX: COLS - 2,
    exitY: ROWS - 2,
    gas: {
      active: false,
      source: { x: 1, y: 1 }, // gas origin (adjust later if needed)
      frontier: [],
      filled: new Set(),
      acc: 0
    }
  };
}

// audio
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

// helpers
function inBounds(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}
function isWall(x, y) {
  return !inBounds(x, y) || G.map[y][x] === 1;
}
function keyXY(x, y) { return `${x},${y}`; }

// map
function buildMap() {
  let m = [];
  for (let r = 0; r < ROWS; r++) {
    m[r] = [];
    for (let c = 0; c < COLS; c++) {
      m[r][c] = (r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1) ? 1 : 0;
    }
  }
  G.exitX = COLS - 2;
  G.exitY = ROWS - 2;
  return m;
}

// input
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

// move
function processMove() {
  if (!moveQ.length) return;

  const [dr, dc] = moveQ.shift();
  const nx = G.player.x + dc;
  const ny = G.player.y + dr;

  if (!inBounds(nx, ny)) return;
  if (G.map[ny][nx] === 1) return;

  G.player.x = nx;
  G.player.y = ny;
}

// ----- GAS: trigger rules + diffusion -----
function gasTriggerDistance(level) {
  return (level >= 5) ? 10 : 4;
}

// Level 1: 2.0s/tile
// Level 2: 1.5s/tile (25% faster)
// Linear beyond that, clamped to a minimum.
function gasIntervalSeconds(level) {
  const base = 2.0;
  const perLevelDelta = 0.5; // L2 = 2.0 - 0.5 = 1.5
  const interval = base - (level - 1) * perLevelDelta;
  return Math.max(0.35, interval);
}

// BFS shortest path distance through corridors (not Manhattan)
function bfsDistance(sx, sy, tx, ty, maxDepth = 9999) {
  if (sx === tx && sy === ty) return 0;
  if (isWall(sx, sy) || isWall(tx, ty)) return Infinity;

  const q = [{ x: sx, y: sy, d: 0 }];
  const seen = new Set([keyXY(sx, sy)]);

  while (q.length) {
    const cur = q.shift();
    if (cur.d >= maxDepth) continue;

    const nbrs = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 }
    ];

    for (const n of nbrs) {
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
  const nbrs = [
    { x: cur.x + 1, y: cur.y },
    { x: cur.x - 1, y: cur.y },
    { x: cur.x, y: cur.y + 1 },
    { x: cur.x, y: cur.y - 1 }
  ];

  for (const n of nbrs) {
    if (isWall(n.x, n.y)) continue;

    const k = keyXY(n.x, n.y);
    if (g.filled.has(k)) continue;

    g.filled.add(k);
    g.frontier.push({ x: n.x, y: n.y });
  }
}

function updateGas(dt) {
  const g = G.gas;

  // Trigger based on SHORTEST WALKABLE PATH distance
  const trig = gasTriggerDistance(G.level);

  // cap BFS search depth for performance (we only care whether it's >= trig)
  const dist = bfsDistance(g.source.x, g.source.y, G.player.x, G.player.y, trig);

  if (!g.active) {
    // if BFS returns trig or more, it means player is at least trig steps away
    // - if unreachable, dist = Infinity, we should NOT activate (so check finite).
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
}

// draw
function draw() {
  ct.clearRect(0, 0, CW, CH);

  // map
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ct.fillStyle = G.map[r][c] === 1 ? '#222' : '#0d0d1d';
      ct.fillRect(c * T, r * T, T, T);
    }
  }

  // gas overlay
  if (G.gas.filled.size) {
    ct.fillStyle = 'rgba(34, 204, 85, 0.28)';
    for (const k of G.gas.filled) {
      const [xs, ys] = k.split(',');
      const x = +xs, y = +ys;
      ct.fillRect(x * T, y * T, T, T);
    }
  }

  // player
  ct.fillStyle = '#c8a84b';
  ct.fillRect(G.player.x * T, G.player.y * T, T, T);

  // exit
  ct.fillStyle = '#22cc55';
  ct.fillRect(G.exitX * T, G.exitY * T, T, T);
}

// loop
let last = 0;
function loop(ts) {
  const dt = (ts - last) / 1000;
  last = ts;

  if (G.screen === 'playing') {
    processMove();
    updateGas(dt);
    draw();
  }
  requestAnimationFrame(loop);
}

// start
function startGame() {
  initG();
  G.map = buildMap();
  G.screen = 'playing';
  playMusic();
}

window.startGame = startGame;

initG();
requestAnimationFrame(loop);

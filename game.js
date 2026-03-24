const AUDIO_SRC = "Overkill Beatz - 90's NINTENDO (Video Game Beat).mp3";

// canvas
const cv = document.getElementById('gc');
const ct = cv.getContext('2d');

// Fixed grid size (must be ODD for maze algorithm)
const COLS = 51, ROWS = 41;

// Dynamic tile size and canvas size in CSS pixels
let T = 18;
let CW = COLS * T, CH = ROWS * T;

function resizeToFit(){
  const HUD_H = 34;
  const availW = window.innerWidth;
  const availH = window.innerHeight - HUD_H;
  const tileW = Math.floor(availW / COLS);
  const tileH = Math.floor(availH / ROWS);
  T = Math.max(8, Math.min(tileW, tileH));
  CW = COLS * T; CH = ROWS * T;
  const dpr = window.devicePixelRatio || 1;
  cv.style.width = `${CW}px`;
  cv.style.height = `${CH}px`;
  cv.width = Math.floor(CW * dpr);
  cv.height = Math.floor(CH * dpr);
  ct.setTransform(dpr,0,0,dpr,0,0);
  ct.imageSmoothingEnabled = false;
}

window.addEventListener('resize', resizeToFit);
resizeToFit();

let G = {};

function keyXY(x,y){return `${x},${y}`;}
function inBounds(x,y){return x>=0&&x<COLS&&y>=0&&y<ROWS;}
function isWall(x,y){return !inBounds(x,y) || G.map[y][x]===1;}
function neighbors4(x,y){
  return [
    {x:x+1,y},{x:x-1,y},{x,y:y+1},{x,y:y-1}
  ].filter(p=>inBounds(p.x,p.y));
}
function rndInt(a,b){return a+Math.floor(Math.random()*(b-a+1));}

// BFS distance with cutoff
function bfsDistance(sx,sy,tx,ty,maxDepth=9999){
  if(sx===tx&&sy===ty) return 0;
  if(isWall(sx,sy)||isWall(tx,ty)) return Infinity;
  const q=[{x:sx,y:sy,d:0}];
  const seen=new Set([keyXY(sx,sy)]);
  while(q.length){
    const cur=q.shift();
    if(cur.d>=maxDepth) continue;
    for(const n of neighbors4(cur.x,cur.y)){
      if(isWall(n.x,n.y)) continue;
      const k=keyXY(n.x,n.y);
      if(seen.has(k)) continue;
      const nd=cur.d+1;
      if(n.x===tx&&n.y===ty) return nd;
      seen.add(k);
      q.push({x:n.x,y:n.y,d:nd});
    }
  }
  return Infinity;
}

// BFS path (for guards)
function bfsPath(sx,sy,tx,ty,maxNodes=8000){
  if(sx===tx&&sy===ty) return [{x:sx,y:sy}];
  if(isWall(sx,sy)||isWall(tx,ty)) return null;
  const q=[{x:sx,y:sy}];
  const prev=new Map();
  prev.set(keyXY(sx,sy), null);
  let visited=0;
  while(q.length && visited<maxNodes){
    visited++;
    const cur=q.shift();
    for(const n of neighbors4(cur.x,cur.y)){
      if(isWall(n.x,n.y)) continue;
      const nk=keyXY(n.x,n.y);
      if(prev.has(nk)) continue;
      prev.set(nk, keyXY(cur.x,cur.y));
      if(n.x===tx && n.y===ty){
        const path=[{x:tx,y:ty}];
        let k=prev.get(keyXY(tx,ty));
        while(k){
          const [xs,ys]=k.split(',');
          path.push({x:+xs,y:+ys});
          k=prev.get(k);
        }
        path.reverse();
        return path;
      }
      q.push({x:n.x,y:n.y});
    }
  }
  return null;
}

function computeReachable(sx,sy){
  const out=[];
  const q=[{x:sx,y:sy}];
  const seen=new Set([keyXY(sx,sy)]);
  while(q.length){
    const cur=q.shift();
    out.push(cur);
    for(const n of neighbors4(cur.x,cur.y)){
      if(isWall(n.x,n.y)) continue;
      const nk=keyXY(n.x,n.y);
      if(seen.has(nk)) continue;
      seen.add(nk);
      q.push(n);
    }
  }
  return out;
}

// Perfect maze generator (DFS backtracker) for odd-sized grid
function buildMazeMap(){
  const m=Array.from({length:ROWS},()=>Array(COLS).fill(1));
  const start={x:1,y:1};
  m[start.y][start.x]=0;
  const stack=[start];
  const dirs=[{dx:2,dy:0},{dx:-2,dy:0},{dx:0,dy:2},{dx:0,dy:-2}];
  function inCell(x,y){return x>0&&x<COLS-1&&y>0&&y<ROWS-1;}
  while(stack.length){
    const cur=stack[stack.length-1];
    const shuffled=dirs.slice().sort(()=>Math.random()-0.5);
    let carved=false;
    for(const d of shuffled){
      const nx=cur.x+d.dx, ny=cur.y+d.dy;
      if(!inCell(nx,ny)) continue;
      if(m[ny][nx]===0) continue;
      const wx=cur.x+d.dx/2, wy=cur.y+d.dy/2;
      m[wy][wx]=0;
      m[ny][nx]=0;
      stack.push({x:nx,y:ny});
      carved=true;
      break;
    }
    if(!carved) stack.pop();
  }
  return m;
}

// Curious distribution across 10 levels totals 20, at least 1 per level
const CURIOUS_PER_LEVEL = (()=>{
  const base=Array(10).fill(1); // 10
  let remaining=10;
  while(remaining>0){
    const i=rndInt(0,9);
    base[i]++; // add 1
    remaining--;
  }
  return base; // sums to 20
})();

function guardsForLevel(level){
  if(level<=3) return 3;
  if(level<=7) return 4;
  return 6; // 8-10
}

function guardStepInterval(level){
  // faster with levels; clamp
  return Math.max(0.18, 0.55 - (level-1)*0.035);
}

function initG(level=1){
  G={
    screen:'menu',
    level,
    player:{x:1,y:1},
    map:null,
    reachable:[],
    exitX:COLS-2,
    exitY:ROWS-2,
    curiousTotal:20,
    curiousCollected:0,
    curiousThisLevel:0,
    curiousItems:[], // {x,y,taken}
    guards:[],
    gas:{active:false, source:{x:1,y:1}, frontier:[], filled:new Set(), acc:0},
    winShown:false
  };
}

// audio
let bgMusic=null; let musicOn=true;
function initAudio(){
  if(bgMusic) return;
  bgMusic=new Audio(AUDIO_SRC);
  bgMusic.loop=true;
  bgMusic.volume=0.55;
}
function playMusic(){ if(!musicOn) return; initAudio(); bgMusic.play().catch(()=>{}); }
function pauseMusic(){ if(bgMusic) bgMusic.pause(); }
function resumeMusic(){ if(bgMusic&&musicOn) bgMusic.play().catch(()=>{}); }
function toggleMusic(){ musicOn=!musicOn; if(musicOn) resumeMusic(); else pauseMusic(); }

// input
let moveQ=[];
document.addEventListener('keydown',e=>{
  if(G.screen!=='playing') return;
  const k=e.key.toLowerCase();
  if(k==='w'||k==='arrowup') moveQ.push([-1,0]);
  if(k==='s'||k==='arrowdown') moveQ.push([1,0]);
  if(k==='a'||k==='arrowleft') moveQ.push([0,-1]);
  if(k==='d'||k==='arrowright') moveQ.push([0,1]);
  if(k==='m') toggleMusic();
});

function placeExit(){
  // farthest reachable tile from spawn
  let best=G.reachable[0];
  let bestD=-1;
  for(const p of G.reachable){
    const d=bfsDistance(G.player.x,G.player.y,p.x,p.y);
    if(Number.isFinite(d)&&d>bestD){bestD=d;best=p;}
  }
  G.exitX=best.x; G.exitY=best.y;
}

function placeCurious(){
  const count = CURIOUS_PER_LEVEL[G.level-1];
  G.curiousThisLevel=count;
  const items=[];
  const candidates = G.reachable.filter(p=>{
    if(p.x===G.player.x&&p.y===G.player.y) return false;
    if(p.x===G.exitX&&p.y===G.exitY) return false;
    return true;
  });
  const minSep=7;
  let attempts=0;
  while(items.length<count && attempts<3000){
    attempts++;
    const p=candidates[rndInt(0,candidates.length-1)];
    let ok=true;
    for(const it of items){
      const d=bfsDistance(it.x,it.y,p.x,p.y,9999);
      if(Number.isFinite(d) && d<minSep){ok=false;break;}
    }
    if(!ok) continue;
    items.push({x:p.x,y:p.y,taken:false});
  }
  // fallback if spacing too strict
  while(items.length<count){
    const p=candidates[rndInt(0,candidates.length-1)];
    items.push({x:p.x,y:p.y,taken:false});
  }
  G.curiousItems=items;
}

function spawnGuards(){
  const want=guardsForLevel(G.level);
  const minFromPlayer = (G.level<=3)?8:10;
  const stepInt=guardStepInterval(G.level);
  const guards=[];
  let tries=0;
  while(guards.length<want && tries<5000){
    tries++;
    const p=G.reachable[rndInt(0,G.reachable.length-1)];
    if(p.x===G.player.x&&p.y===G.player.y) continue;
    if(p.x===G.exitX&&p.y===G.exitY) continue;
    if(G.curiousItems.some(it=>!it.taken && it.x===p.x && it.y===p.y)) continue;
    const d=bfsDistance(G.player.x,G.player.y,p.x,p.y,9999);
    if(!Number.isFinite(d) || d<minFromPlayer) continue;
    guards.push({
      x:p.x,y:p.y,
      acc:0,
      stepInterval:stepInt,
      mode:'patrol',
      patrolTarget:null,
      path:null,
      pathIdx:0,
      repathAcc:0
    });
  }
  G.guards=guards;
}

function pickPatrolTarget(){
  return G.reachable[rndInt(0,G.reachable.length-1)];
}

function updateGuards(dt){
  for(const gd of G.guards){
    gd.acc += dt;
    gd.repathAcc += dt;

    const dToPlayer = bfsDistance(gd.x,gd.y,G.player.x,G.player.y,12);
    const chasing = Number.isFinite(dToPlayer) && dToPlayer<=12;
    gd.mode = chasing ? 'chase' : 'patrol';

    const repathEvery = chasing ? 0.35 : 1.2;
    if(!gd.path || gd.repathAcc>=repathEvery){
      gd.repathAcc=0;
      let tx,ty;
      if(chasing){
        tx=G.player.x; ty=G.player.y;
      } else {
        if(!gd.patrolTarget || (gd.x===gd.patrolTarget.x && gd.y===gd.patrolTarget.y)){
          gd.patrolTarget = pickPatrolTarget();
        }
        tx=gd.patrolTarget.x; ty=gd.patrolTarget.y;
      }
      const path=bfsPath(gd.x,gd.y,tx,ty);
      gd.path=path;
      gd.pathIdx=0;
    }

    while(gd.acc >= gd.stepInterval){
      gd.acc -= gd.stepInterval;
      if(!gd.path || gd.path.length<2) break;
      const nextIdx = Math.min(gd.path.length-1, gd.pathIdx+1);
      const nxt = gd.path[nextIdx];
      if(isWall(nxt.x,nxt.y)) break;
      gd.x=nxt.x; gd.y=nxt.y; gd.pathIdx=nextIdx;

      // caught
      if(gd.x===G.player.x && gd.y===G.player.y){
        startLevel(G.level, true);
        return;
      }
    }
  }
}

// GAS
function gasTriggerDistance(level){ return (level>=5)?10:4; }
function gasIntervalSeconds(level){
  const base=2.0; const perLevelDelta=0.5;
  const interval=base-(level-1)*perLevelDelta;
  return Math.max(0.35, interval);
}
function ensureGasSeeded(){
  const g=G.gas;
  if(g.frontier.length||g.filled.size) return;
  if(isWall(g.source.x,g.source.y)) return;
  g.frontier.push({x:g.source.x,y:g.source.y});
  g.filled.add(keyXY(g.source.x,g.source.y));
}
function spreadGasOneStep(){
  const g=G.gas;
  if(!g.frontier.length) return;
  const cur=g.frontier.shift();
  for(const n of neighbors4(cur.x,cur.y)){if(isWall(n.x,n.y)) continue;
    const k=keyXY(n.x,n.y);
    if(g.filled.has(k)) continue;
    g.filled.add(k);
    g.frontier.push({x:n.x,y:n.y});
  }
}
function updateGas(dt){
  const g=G.gas;
  const trig=gasTriggerDistance(G.level);
  const dist=bfsDistance(g.source.x,g.source.y,G.player.x,G.player.y,trig);
  if(!g.active){
    if(Number.isFinite(dist) && dist>=trig){
      g.active=true;
      ensureGasSeeded();
      g.acc=0;
    } else return;
  }
  ensureGasSeeded();
  const interval=gasIntervalSeconds(G.level);
  g.acc += dt;
  while(g.acc>=interval){
    g.acc -= interval;
    spreadGasOneStep();
  }
  if(g.filled.has(keyXY(G.player.x,G.player.y))){
    startLevel(G.level, true);
  }
}

function processMove(){
  if(!moveQ.length) return;
  const [dr,dc]=moveQ.shift();
  const nx=G.player.x+dc;
  const ny=G.player.y+dr;
  if(!inBounds(nx,ny)) return;
  if(G.map[ny][nx]===1) return;
  G.player.x=nx; G.player.y=ny;

  // pickup curious
  for(const it of G.curiousItems){
    if(!it.taken && it.x===nx && it.y===ny){
      it.taken=true;
      G.curiousCollected++;
    }
  }

  // exit
  if(nx===G.exitX && ny===G.exitY){
    if(G.level>=10){
      G.screen='won';
      G.winShown=true;
    } else {
      startLevel(G.level+1, false);
    }
  }
}

function draw(){
  ct.clearRect(0,0,CW,CH);

  for(let r=0;r<ROWS;r++){for(let c=0;c<COLS;c++){ct.fillStyle = (G.map[r][c]===1) ? '#222' : '#0d0d1d';ct.fillRect(c*T,r*T,T,T);}}

  // curious
  for(const it of G.curiousItems){if(it.taken) continue;ct.fillStyle = '#8ad0ff';ct.fillRect(it.x*T+T*0.25, it.y*T+T*0.25, T*0.5, T*0.5);}

  // exit
  ct.fillStyle='#22cc55';ct.fillRect(G.exitX*T,G.exitY*T,T,T);

  // gas overlay
  if(G.gas.filled.size){
    ct.fillStyle='rgba(34, 204, 85, 0.28)';
    for(const k of G.gas.filled){
      const [xs,ys]=k.split(',');
      ct.fillRect((+xs)*T,(+ys)*T,T,T);
    }
  }

  // guards
  for(const gd of G.guards){
    ct.fillStyle='#cc3333';
    ct.fillRect(gd.x*T, gd.y*T, T, T);
  }

  // player
  ct.fillStyle='#c8a84b';
  ct.fillRect(G.player.x*T,G.player.y*T,T,T);

  // win overlay
  if(G.screen==='won'){
    ct.fillStyle='rgba(0,0,0,0.65)';
    ct.fillRect(0,0,CW,CH);
    ct.fillStyle='#c8a84b';
    ct.font=`${Math.max(14, T)}px monospace`;
    ct.fillText('ARCHIVES CLEARED!', 20, 40);
    ct.font=`${Math.max(12, T*0.8)}px monospace`;
    ct.fillText(`Curious Points: ${G.curiousCollected} / ${G.curiousTotal}`, 20, 70);
    ct.fillText('Press START to play again', 20, 100);
  }
}

let last=0;
function loop(ts){
  const dt=(ts-last)/1000; last=ts;
  if(G.screen==='playing'){
    processMove();
    updateGuards(dt);
    updateGas(dt);
    draw();
  } else if(G.screen==='won'){
    draw();
  }
  requestAnimationFrame(loop);
}

function startLevel(level, keepCurious){
  const prevCurious = keepCurious ? G.curiousCollected : G.curiousCollected;
  initG(level);
  G.curiousCollected = prevCurious;

  G.map = buildMazeMap();
  // ensure spawn is floor
  G.map[1][1]=0;
  G.player={x:1,y:1};

  G.reachable = computeReachable(1,1);
  placeExit();
  placeCurious();
  spawnGuards();

  // reset gas
  G.gas.active=false;
  G.gas.source={x:1,y:1};
  G.gas.frontier=[];
  G.gas.filled=new Set();
  G.gas.acc=0;

  G.screen='playing';
  playMusic();
}

function startGame(){
  if(G.screen==='won'){startLevel(1, false);
  } else {startLevel(1, false);}}

window.startGame=startGame;

initG(1);
requestAnimationFrame(loop);
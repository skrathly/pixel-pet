// =============================================================
//  pixel-pet · renderer (MULTI-AGENTE + sprites + estados)
//  LIBRE  (sin tarea): camina; si se cruza con otro libre -> saltito + "¡hola!"
//  TRABAJANDO (con tarea): quieto de ESPALDAS + pantalla estilo Matrix con la tarea
//  Cada char N.png: 3 frames x 4 direcciones, celda 32x48, PNG con alfa.
//    filas: 0=FRENTE 1=IZQUIERDA 2=DERECHA 3=ESPALDA
// =============================================================

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; ctx.imageSmoothingEnabled = false; }
window.addEventListener('resize', resize); resize();

const FW = 32, FH = 48, FRAME_COLS = 3, SCALE = 1;
const DIR = { FRONT: 0, LEFT: 1, RIGHT: 2, BACK: 3 };
const WALK_SEQUENCE = [0, 1, 2, 1];
const STAND_COL = 1;

// ---- Caché de sprites ---------------------------------------
const SPRITES = ['sprites/char1.png','sprites/char2.png','sprites/char3.png','sprites/char4.png','sprites/char5.png','sprites/char6.png','sprites/char7.png','sprites/char8.png'];
const cache = {};
function loadSprite(file) {
  if (cache[file]) return cache[file];
  const e = { img: new Image(), ready: false, foot: [], spawn: [] };
  e.img.onload = () => { computeSpriteData(e); e.ready = true; };
  e.img.src = file; cache[file] = e; return e;
}
function computeSpriteData(e) {
  const img = e.img;
  const off = document.createElement('canvas'); off.width = FW; off.height = FH;
  const o = off.getContext('2d'); o.imageSmoothingEnabled = false;
  o.drawImage(img, STAND_COL * FW, DIR.FRONT * FH, FW, FH, 0, 0, FW, FH);
  const d = o.getImageData(0, 0, FW, FH).data; const sp = [];
  for (let r = 0; r < FH; r++) for (let c = 0; c < FW; c++) { const i = (r * FW + c) * 4; if (d[i + 3] > 10) sp.push({ c, r, color: `rgb(${d[i]},${d[i+1]},${d[i+2]})` }); }
  for (let i = sp.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [sp[i], sp[j]] = [sp[j], sp[i]]; }
  e.spawn = sp;
  const big = document.createElement('canvas'); big.width = img.width; big.height = img.height;
  const b = big.getContext('2d'); b.imageSmoothingEnabled = false; b.drawImage(img, 0, 0);
  const bd = b.getImageData(0, 0, img.width, img.height).data;
  for (let row = 0; row < 4; row++) { e.foot[row] = [];
    for (let col = 0; col < FRAME_COLS; col++) { let fr = FH - 1;
      for (let r = FH - 1; r >= 0; r--) { let any = false;
        for (let c = 0; c < FW; c++) { const X = col * FW + c, Y = row * FH + r; if (bd[(Y * img.width + X) * 4 + 3] > 10) { any = true; break; } }
        if (any) { fr = r; break; } }
      e.foot[row][col] = fr + 1; } }
}
SPRITES.forEach(loadSprite);

const easeOut = x => 1 - Math.pow(1 - x, 3);
const easeIn  = x => x * x * x;

const _p = new URLSearchParams(location.search);
let FLOOR = _p.has('floor') ? parseInt(_p.get('floor'), 10) : null;
const FOOT_INTO_BAR = 2;
function groundY() { return (FLOOR != null ? FLOOR : canvas.height - 1) + FOOT_INTO_BAR; }

const MARGIN = 50, HOP_EDGE = 6;
const SPAWN_DUR = 0.9, DESPAWN_DUR = 0.7;
const GREET_DIST = 34;          // px de cercanía para saludarse
const GREET_TIME = 1.4;         // duración del saludo
const GREET_COOLDOWN = 6;       // s antes de poder volver a saludar

// ---- Personajes ---------------------------------------------
const pets = new Map();
let draggingId = null, hopPending = false, mouseX = -1, mouseY = -1, ignoring = true;

// --- Pantalla "Matrix" por personaje (canvas propio) ---
const MATRIX_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノﾊﾋﾌﾍﾎ0123456789<>$#*+=/'.split('');
function makeScreen() {
  const el = document.createElement('div'); el.className = 'screen';
  const cv = document.createElement('canvas');
  const ov = document.createElement('div'); ov.className = 'screen-overlay';
  const head = document.createElement('div'); head.className = 'screen-head';
  const body = document.createElement('div'); body.className = 'screen-body';
  ov.appendChild(head); ov.appendChild(body);
  el.appendChild(cv); el.appendChild(ov);
  el.style.display = 'none'; document.body.appendChild(el);
  return { el, cv, cctx: cv.getContext('2d'), head, body, cols: null, drops: null };
}
function matrixStep(scr) {
  const W = scr.el.clientWidth, H = scr.el.clientHeight;
  if (scr.cv.width !== W || scr.cv.height !== H) {
    scr.cv.width = W; scr.cv.height = H;
    const step = 8; scr.cols = Math.max(1, Math.floor(W / step)); scr.step = step;
    scr.drops = Array.from({ length: scr.cols }, () => Math.random() * -H);
  }
  const g = scr.cctx, step = scr.step;
  g.fillStyle = 'rgba(2,5,10,0.28)'; g.fillRect(0, 0, W, H);   // estela
  g.font = '9px monospace';
  for (let i = 0; i < scr.cols; i++) {
    const ch = MATRIX_CHARS[(Math.random() * MATRIX_CHARS.length) | 0];
    const x = i * step, y = scr.drops[i];
    g.fillStyle = '#9dffc4'; g.fillText(ch, x, y);            // cabeza brillante
    g.fillStyle = '#1f7a3f'; g.fillText(ch, x, y - step);     // cola tenue
    scr.drops[i] += step;
    if (scr.drops[i] > H && Math.random() > 0.975) scr.drops[i] = 0;
  }
}

// --- globito de saludo ---
const GREET_RANDOM = [
  '¡hola!',
  '¿qué más parce?',
  'muévete, déjame pasar',
  'ponte a trabajar',
  'pídele al dev tareas',
  'aún hay bugs y sigues aquí sin hacer nada',
];
function greetByHour() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return '¡buenos días!';
  if (h >= 12 && h < 19) return '¡buenas tardes!';
  return '¡buenas noches!';
}
function pickGreeting() {
  return Math.random() < 0.35 ? greetByHour() : GREET_RANDOM[Math.floor(Math.random() * GREET_RANDOM.length)];
}
function makeHi() { const el = document.createElement('div'); el.className = 'hi'; el.textContent = '¡hola!'; el.style.display = 'none'; document.body.appendChild(el); return el; }

function makePet(id, label) {
  const screen = makeScreen(); screen.head.textContent = (label || 'agent').slice(0, 22);
  const hi = makeHi();
  return {
    id, label: label || '', task: null,
    sprite: loadSprite(SPRITES[Math.floor(Math.random() * SPRITES.length)]),
    x: MARGIN + Math.random() * Math.max(1, canvas.width - 2 * MARGIN),
    y: groundY(), dir: Math.random() < 0.5 ? -1 : 1, speed: 65,
    state: 'spawn', seqIdx: 0, frameTimer: 0, frameInterval: 0.15,
    progress: 0, stateTimer: 0, vy: 0, grabX: 0, grabY: 0, dead: false,
    greetT: 0, greetCool: 0, faceDir: 1,
    screen, hi
  };
}
function killPet(p) {
  if (p.screen && p.screen.el.parentNode) p.screen.el.parentNode.removeChild(p.screen.el);
  if (p.hi && p.hi.parentNode) p.hi.parentNode.removeChild(p.hi);
}

// ---- Lista de agentes (de main) -----------------------------
if (window.petAPI && window.petAPI.onAgents) window.petAPI.onAgents(list => {
  const seen = new Set();
  for (const a of (list || [])) {
    seen.add(a.id);
    let p = pets.get(a.id);
    if (!p) { p = makePet(a.id, a.label); pets.set(a.id, p); }
    p.label = a.label || p.label; p.task = a.task || null;
    if (p.screen) p.screen.head.textContent = (p.label || 'agent').slice(0, 22);
    if (p.state === 'despawn') { p.state = 'spawn'; p.progress = 0; }
  }
  for (const [id, p] of pets) if (!seen.has(id) && p.state !== 'despawn') { p.state = 'despawn'; p.progress = 0; }
});

// ---- Salto de pantalla --------------------------------------
function requestHop(dir) {
  if (hopPending || !(window.petAPI && window.petAPI.hop)) return;
  hopPending = true; window.petAPI.hop(dir); setTimeout(() => { hopPending = false; }, 400);
}
if (window.petAPI && window.petAPI.onPlaced) window.petAPI.onPlaced(d => {
  FLOOR = d.floor; hopPending = false;
  const W = window.innerWidth, dp = draggingId && pets.get(draggingId);
  if (dp) { if (d.entrySide === 'left') { dp.x = 8; dp.grabX = 0; } if (d.entrySide === 'right') { dp.x = W - 8; dp.grabX = 0; } }
  for (const p of pets.values()) if (p !== dp) p.x = Math.max(MARGIN, Math.min(p.x, W - MARGIN));
});

// ---- Ratón --------------------------------------------------
function setIgnore(v) { if (v !== ignoring) { ignoring = v; if (window.petAPI) window.petAPI.setIgnore(v); } }
function petBox(p) { const w = FW * SCALE, h = FH * SCALE; return { l: p.x - w / 2, r: p.x + w / 2, t: p.y - h, b: p.y }; }
function overPet(p, mx, my) { const b = petBox(p); return mx >= b.l && mx <= b.r && my >= b.t && my <= b.b; }
const GRABBABLE = s => s === 'walk' || s === 'idle' || s === 'fall' || s === 'work' || s === 'greet';
function topPetAt(mx, my) { let f = null; for (const p of pets.values()) if (GRABBABLE(p.state) && overPet(p, mx, my)) f = p; return f; }

window.addEventListener('mousemove', e => {
  mouseX = e.clientX; mouseY = e.clientY;
  if (draggingId) { const p = pets.get(draggingId);
    if (p) { p.x = mouseX - p.grabX; p.y = mouseY - p.grabY;
      if (p.x > canvas.width - HOP_EDGE) requestHop('right'); else if (p.x < HOP_EDGE) requestHop('left'); } }
});
window.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const p = topPetAt(e.clientX, e.clientY);
  if (p) { p.state = 'drag'; draggingId = p.id; p.grabX = e.clientX - p.x; p.grabY = e.clientY - p.y; document.body.style.cursor = 'grabbing'; }
});
window.addEventListener('mouseup', () => { if (draggingId) { const p = pets.get(draggingId); if (p) { p.state = 'fall'; p.vy = 0; } draggingId = null; } });

// ---- Saludo entre personajes libres -------------------------
function tryGreet() {
  const arr = [...pets.values()].filter(p => p.state === 'walk' && p.greetCool <= 0);
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const a = arr[i], b = arr[j];
    if (a.greetCool > 0 || b.greetCool > 0) continue;
    if (Math.abs(a.x - b.x) <= GREET_DIST) {
      a.state = b.state = 'greet';
      a.greetT = b.greetT = GREET_TIME;
      a.faceDir = (b.x >= a.x) ? 1 : -1;          // mirarse de frente
      b.faceDir = -a.faceDir;
      a.jump = b.jump = 0;
      a.hi.textContent = pickGreeting();
      b.hi.textContent = pickGreeting();
    }
  }
}

// ---- Lógica -------------------------------------------------
function updatePet(p, dt) {
  if (!p.sprite.ready) return;
  if (p.greetCool > 0) p.greetCool -= dt;
  const working = !!p.task;
  if (p.state !== 'drag' && p.state !== 'fall') p.y = groundY();

  // Entrar/salir de "trabajo" según haya tarea (solo desde estados libres)
  if (working && (p.state === 'walk' || p.state === 'idle')) { p.state = 'work'; }
  if (!working && p.state === 'work') { p.state = 'walk'; }

  switch (p.state) {
    case 'spawn':
      p.progress += dt / SPAWN_DUR;
      if (p.progress >= 1) p.state = working ? 'work' : 'walk';
      break;
    case 'walk':
      p.x += p.dir * p.speed * dt;
      if (p.x < MARGIN) { p.x = MARGIN; p.dir = 1; }
      if (p.x > canvas.width - MARGIN) { p.x = canvas.width - MARGIN; p.dir = -1; }
      p.frameTimer += dt;
      if (p.frameTimer >= p.frameInterval) { p.frameTimer -= p.frameInterval; p.seqIdx = (p.seqIdx + 1) % WALK_SEQUENCE.length; }
      if (Math.random() < 0.2 * dt) { p.state = 'idle'; p.stateTimer = 1 + Math.random() * 2; }
      break;
    case 'idle':
      p.stateTimer -= dt; if (p.stateTimer <= 0) p.state = 'walk'; break;
    case 'work':
      // quieto de espaldas; nada que mover
      break;
    case 'greet':
      p.greetT -= dt;
      p.jump = (p.jump || 0) + dt;
      if (p.greetT <= 0) { p.state = working ? 'work' : 'walk'; p.greetCool = GREET_COOLDOWN; p.dir = -p.faceDir; }
      break;
    case 'drag': break;
    case 'fall':
      p.vy += 900 * dt; p.y += p.vy * dt;
      if (p.y >= groundY()) { p.y = groundY(); p.state = working ? 'work' : 'walk'; } break;
    case 'despawn':
      p.progress += dt / DESPAWN_DUR; if (p.progress >= 1) p.dead = true; break;
  }
}
function update(dt) {
  for (const p of pets.values()) updatePet(p, dt);
  tryGreet();
  for (const [id, p] of pets) if (p.dead) { killPet(p); pets.delete(id); }
  if (draggingId) setIgnore(false);
  else { const over = !!topPetAt(mouseX, mouseY); setIgnore(!over); document.body.style.cursor = over ? 'grab' : 'default'; }
}

// ---- Dibujo del personaje -----------------------------------
function drawShadow(p, alpha) {
  const lift = Math.max(0, groundY() - p.y), k = Math.max(0.4, 1 - lift / 220);
  ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.18 * alpha * k})`;
  ctx.beginPath(); ctx.ellipse(p.x, groundY() + 1, FW * SCALE * 0.36 * k, 4 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function frameRowCol(p) {
  if (p.state === 'work') return [DIR.BACK, STAND_COL];                 // de espaldas, quieto
  if (p.state === 'greet') return [p.faceDir < 0 ? DIR.LEFT : DIR.RIGHT, STAND_COL];
  if (p.state === 'walk') return [p.dir < 0 ? DIR.LEFT : DIR.RIGHT, WALK_SEQUENCE[p.seqIdx]];
  return [DIR.FRONT, STAND_COL];
}
function drawCharacter(p) {
  const s = p.sprite, [row, col] = frameRowCol(p), fb = (s.foot[row] && s.foot[row][col]) || FH;
  let yoff = 0;
  if (p.state === 'greet') yoff = -Math.abs(Math.sin(p.jump * 12)) * 6;  // saltito
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y + yoff)); ctx.scale(SCALE, SCALE);
  ctx.drawImage(s.img, col * FW, row * FH, FW, FH, -FW / 2, -fb, FW, FH); ctx.restore();
}
function drawReveal(p) {
  const s = p.sprite, total = s.spawn.length;
  const pr = p.state === 'spawn' ? easeOut(p.progress) : easeIn(p.progress);
  const visible = p.state === 'spawn' ? Math.floor(pr * total) : Math.floor((1 - pr) * total);
  const FRONTN = 16, fb = (s.foot[DIR.FRONT] && s.foot[DIR.FRONT][STAND_COL]) || FH;
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.scale(SCALE, SCALE);
  for (let i = 0; i < visible; i++) {
    const px = s.spawn[i], dx = px.c - FW / 2, dy = px.r - fb;
    ctx.fillStyle = px.color; ctx.fillRect(dx, dy, 1, 1);
    if (i >= visible - FRONTN) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(dx, dy, 1, 1); }
  }
  ctx.restore();
}

// ---- Tooltips (pantalla de trabajo + saludo) ----------------
function placeAbove(el, p, gap) {
  const r = el.getBoundingClientRect();
  let left = p.x - r.width / 2, top = p.y - FH * SCALE - r.height - gap;
  left = Math.max(4, Math.min(left, canvas.width - r.width - 4)); if (top < 4) top = 4;
  el.style.left = Math.round(left) + 'px'; el.style.top = Math.round(top) + 'px';
}
function updateScreen(p) {
  const scr = p.screen;
  if (p.state === 'work') {
    if (scr.el.style.display !== 'block') {
      scr.el.style.display = 'block';
      scr.body.innerHTML = '<span class="prompt">$ </span>' + escapeHtml(p.task || '') + '<span class="cursor">_</span>';
    } else {
      // refrescar texto si cambió la tarea
      const want = '<span class="prompt">$ </span>' + escapeHtml(p.task || '') + '<span class="cursor">_</span>';
      if (scr.body.dataset.t !== (p.task || '')) { scr.body.innerHTML = want; scr.body.dataset.t = (p.task || ''); }
    }
    matrixStep(scr);
    placeAbove(scr.el, p, 12);
  } else if (scr.el.style.display !== 'none') {
    scr.el.style.display = 'none';
  }
}
function updateHi(p) {
  if (p.state === 'greet') { p.hi.style.display = 'block'; placeAbove(p.hi, p, 8); }
  else if (p.hi.style.display !== 'none') p.hi.style.display = 'none';
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const p of pets.values()) {
    if (!p.sprite.ready) continue;
    if (p.state === 'spawn' || p.state === 'despawn') {
      const a = p.state === 'spawn' ? easeOut(p.progress) : 1 - easeIn(p.progress);
      drawShadow(p, a); drawReveal(p);
    } else { drawShadow(p, 1); drawCharacter(p); }
    updateScreen(p); updateHi(p);
  }
}

let last = performance.now();
function loop(now) {
  let dt = (now - last) / 1000; if (dt > 0.1) dt = 0.1; last = now;
  update(dt); render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

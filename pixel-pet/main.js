const { app, BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');

let win = null, curDisplay = 0, lastIgnore = true, readerStarted = false;

// ================= Ventana / monitores =================
function dlist() { return screen.getAllDisplays(); }
function floorFor(d) { return (d.workArea.y - d.bounds.y) + d.workArea.height; }

function place(i, entrySide) {
  const ds = dlist();
  curDisplay = ((i % ds.length) + ds.length) % ds.length;
  const d = ds[curDisplay];
  const apply = () => {
    if (!win) return;
    win.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(lastIgnore, { forward: true });
    win.webContents.send('placed', { floor: floorFor(d), entrySide: entrySide || null });
  };
  apply(); setTimeout(apply, 60);
}
function neighbor(dir) {
  const ds = dlist(), cur = ds[curDisplay];
  for (let i = 0; i < ds.length; i++) {
    if (i === curDisplay) continue;
    const d = ds[i];
    const vOverlap = !(d.bounds.y + d.bounds.height <= cur.bounds.y || d.bounds.y >= cur.bounds.y + cur.bounds.height);
    if (!vOverlap) continue;
    if (dir === 'right' && d.bounds.x >= cur.bounds.x + cur.bounds.width - 5) return i;
    if (dir === 'left'  && d.bounds.x + d.bounds.width <= cur.bounds.x + 5) return i;
  }
  return -1;
}
function createWindow() {
  const ds = dlist();
  const primary = screen.getPrimaryDisplay();
  curDisplay = Math.max(0, ds.findIndex(d => d.id === primary.id));
  const d = ds[curDisplay];
  win = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    transparent: true, frame: false, resizable: true, movable: true,
    hasShadow: false, skipTaskbar: true, focusable: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile('index.html', { query: { floor: String(floorFor(d)) } });
  win.webContents.on('did-finish-load', startReader);
}
ipcMain.on('set-ignore', (e, ig) => { lastIgnore = ig; if (win) win.setIgnoreMouseEvents(ig, { forward: true }); });
ipcMain.on('hop', (e, dir) => { const n = neighbor(dir); if (n >= 0) place(n, dir === 'right' ? 'left' : 'right'); });

// ============ Lector de transcripts: UN agente por sesión ============
const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
const SESSION_TTL = 120000;   // ms sin ESCRIBIR -> sesión cerrada (se desmaterializa)
const sessions = new Map();   // file -> { offset, lastActivity, task, cwd, working }
let lastSent = '';

function listJsonl(dir, depth, out) {
  if (depth < 0) return;
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listJsonl(full, depth - 1, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
}
function readNew(file, s) {
  let st; try { st = fs.statSync(file); } catch { return []; }
  if (st.size < s.offset) s.offset = 0;
  if (st.size === s.offset) return [];
  let fd; const len = st.size - s.offset; const buf = Buffer.alloc(len);
  try { fd = fs.openSync(file, 'r'); fs.readSync(fd, buf, 0, len, s.offset); }
  catch { return []; }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
  const text = buf.toString('utf8');
  const nl = text.lastIndexOf('\n');
  if (nl < 0) return [];
  s.offset += Buffer.byteLength(text.slice(0, nl + 1), 'utf8');
  return text.slice(0, nl).split('\n').filter(Boolean);
}
const truncate = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const baseName = (p) => p ? String(p).split(/[\\/]/).pop() : '';
function toolToText(name, input) {
  input = input || {};
  switch (name) {
    case 'Bash': return 'Ejecutando: ' + truncate(input.command || '', 38);
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit':
      return 'Editando ' + baseName(input.file_path || input.path || input.notebook_path);
    case 'Read': return 'Leyendo ' + baseName(input.file_path || input.path);
    case 'Grep': return 'Buscando "' + truncate(input.pattern || '', 22) + '"';
    case 'Glob': return 'Buscando archivos';
    case 'WebFetch': return 'Leyendo la web';
    case 'WebSearch': return 'Buscando en la web';
    case 'Task': return 'Lanzando subagente';
    case 'TodoWrite': return 'Actualizando tareas';
    default: return name ? ('Usando ' + name) : null;
  }
}
// Procesa una línea del transcript y actualiza el estado de la sesión.
// "working" sigue el TURNO del agente: arranca con un mensaje del usuario o una
// herramienta, y termina solo cuando el asistente cierra con un mensaje de texto.
function applyLine(s, obj) {
  if (obj.cwd) s.cwd = obj.cwd;

  // Señal de cierre: Claude Code escribe "last-prompt" al hacer /exit
  if (obj.type === 'last-prompt') {
    s.closing = true;      // activar despedida → se despide y luego se desmaterializa
    s.working = false;
    s.task = null;
    return;
  }

  const msg = obj.message || obj;
  const type = obj.type || (msg && msg.role);
  const content = msg && msg.content;

  if (type === 'assistant') {
    if (Array.isArray(content)) {
      // tarea = última herramienta usada
      for (let i = content.length - 1; i >= 0; i--) {
        const b = content[i];
        if (b && b.type === 'tool_use') { s.task = toolToText(b.name, b.input); break; }
      }
      const hasTool = content.some(b => b && b.type === 'tool_use');
      s.working = hasTool;                 // termina herramienta -> sigue; solo texto -> turno cerrado
      if (!hasTool) s.task = null;
    } else {
      s.working = false;                   // respuesta de texto final -> libre
      s.task = null;
    }
  } else if (type === 'user') {
    s.working = true;                      // prompt del usuario o tool_result -> trabajando
    if (!s.task) s.task = 'Pensando…';
  }
  // otros tipos (system, summary) no cambian el estado
}
function sessionId(file) { return baseName(file).replace(/\.jsonl$/, ''); }
function agentLabel(s, file) {
  if (s.cwd) return baseName(s.cwd);
  return baseName(path.dirname(file)) || sessionId(file).slice(0, 8);
}

function tick() {
  if (!win) return;
  const files = []; listJsonl(PROJECTS_DIR, 3, files);
  const now = Date.now();
  for (const f of files) {
    let s = sessions.get(f);
    if (!s) { s = { offset: 0, lastActivity: now, task: null, cwd: null, working: false }; sessions.set(f, s); }
    const lines = readNew(f, s);
    if (lines.length) s.lastActivity = now;
    for (const ln of lines) { let obj; try { obj = JSON.parse(ln); } catch { continue; } applyLine(s, obj); }
  }
  const agents = [];
  for (const [f, s] of sessions) {
    if (s.closing) {
      if (!s.closingAt) s.closingAt = now;
      if (now - s.closingAt < 4000)        // ventana de despedida (4s: 2.5s animación + margen)
        agents.push({ id: sessionId(f), label: agentLabel(s, f), working: false, task: null, farewell: true });
      // después de 4s no se incluye → renderer lo desmaterializa
    } else if (now - s.lastActivity <= SESSION_TTL) {
      agents.push({ id: sessionId(f), label: agentLabel(s, f), working: !!s.working, task: s.working ? (s.task || 'Pensando…') : null });
    }
  }
  const j = JSON.stringify(agents);
  if (j !== lastSent) { lastSent = j; win.webContents.send('agents', agents); }
}
function startReader() {
  if (readerStarted) return; readerStarted = true;
  const files = []; listJsonl(PROJECTS_DIR, 3, files);
  for (const f of files) { try { sessions.set(f, { offset: fs.statSync(f).size, lastActivity: 0, task: null, cwd: null, working: false }); } catch {} }

  // Polling cada 1s como respaldo
  setInterval(tick, 1000);

  // fs.watch: aviso instantáneo del SO cuando aparece/cambia un .jsonl
  let debounce = null;
  const wake = () => { if (debounce) return; debounce = setTimeout(() => { debounce = null; tick(); }, 150); };
  try {
    fs.watch(PROJECTS_DIR, { recursive: true }, (event, filename) => {
      if (filename && filename.endsWith('.jsonl')) wake();
    });
  } catch (e) { /* si la carpeta no existe aún, el polling se encarga */ }

  tick();
}

const _singleLock = app.requestSingleInstanceLock();
if (!_singleLock) app.quit();

app.whenReady().then(() => {
  if (!_singleLock) return;
  createWindow();
  globalShortcut.register('CommandOrControl+Alt+Right', () => place(curDisplay + 1));
  globalShortcut.register('CommandOrControl+Alt+Left',  () => place(curDisplay - 1));
  for (let n = 1; n <= 3; n++) globalShortcut.register(`CommandOrControl+Alt+${n}`, () => place(n - 1));
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
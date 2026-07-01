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

// ============ Lector de sesiones activas + transcripts ============
// Presencia = existe ~/.claude/sessions/<pid>.json (Claude Code lo borra al cerrar sesión).
// "Trabajando" (espaldas + pantallita) = ese registro dice status:"busy".
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(CLAUDE_DIR, 'projects');
const registryState = new Map();   // sessionId -> { offset, task }  (solo para texto de la tarea)
let lastSent = '';

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }   // proceso muerto sin haber limpiado su registro -> tratar como cerrada
}
function readRegistry() {
  const found = new Map();   // sessionId -> { pid, cwd, status }
  let names; try { names = fs.readdirSync(SESSIONS_DIR); } catch { return found; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let info; try { info = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, name), 'utf8')); } catch { continue; }
    if (!info || !info.sessionId || !info.pid || !pidAlive(info.pid)) continue;
    found.set(info.sessionId, info);
  }
  return found;
}
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
function taskFromObj(obj) {
  const msg = obj.message || obj;
  const content = msg && msg.content;
  if (Array.isArray(content)) {
    for (let i = content.length - 1; i >= 0; i--) {
      const b = content[i];
      if (b && b.type === 'tool_use') return toolToText(b.name, b.input);
    }
    if (msg.role === 'assistant') return 'Pensando…';
  } else if (typeof content === 'string' && msg.role === 'assistant') return 'Pensando…';
  return undefined;
}
function sessionIdOf(file) { return baseName(file).replace(/\.jsonl$/, ''); }

function tick() {
  if (!win) return;
  const reg = readRegistry();   // sesiones abiertas AHORA MISMO, según Claude Code

  const jsonlFiles = []; listJsonl(PROJECTS_DIR, 3, jsonlFiles);
  const jsonlBySession = new Map();
  for (const f of jsonlFiles) jsonlBySession.set(sessionIdOf(f), f);

  for (const id of registryState.keys()) if (!reg.has(id)) registryState.delete(id);   // limpiar sesiones cerradas

  const agents = [];
  for (const [id, info] of reg) {
    let rec = registryState.get(id);
    if (!rec) { rec = { offset: null, task: null }; registryState.set(id, rec); }
    const busy = info.status === 'busy';
    if (busy) {
      const file = jsonlBySession.get(id);
      if (file) {
        if (rec.offset === null) { try { rec.offset = fs.statSync(file).size; } catch { rec.offset = 0; } }
        for (const ln of readNew(file, rec)) {
          let obj; try { obj = JSON.parse(ln); } catch { continue; }
          const t = taskFromObj(obj);
          if (t !== undefined) rec.task = t;
        }
      }
    } else {
      rec.task = null; rec.offset = null;   // al volver a estar ocupada, retomar desde el final actual
    }
    agents.push({ id, label: baseName(info.cwd) || id.slice(0, 8), task: busy ? (rec.task || 'Procesando…') : null });
  }
  const j = JSON.stringify(agents);
  if (j !== lastSent) { lastSent = j; win.webContents.send('agents', agents); }
}
function startReader() {
  if (readerStarted) return; readerStarted = true;
  setInterval(tick, 1000); tick();
}

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register('CommandOrControl+Alt+Right', () => place(curDisplay + 1));
  globalShortcut.register('CommandOrControl+Alt+Left',  () => place(curDisplay - 1));
  for (let n = 1; n <= 3; n++) globalShortcut.register(`CommandOrControl+Alt+${n}`, () => place(n - 1));
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
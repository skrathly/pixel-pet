const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

let child = null;
let statusItem = null;
let out = null;

const cfg = () => vscode.workspace.getConfiguration('pixelPet');
const running = () => !!(child && child.exitCode === null && !child.killed);
const log = (m) => { if (out) out.appendLine('[' + new Date().toLocaleTimeString() + '] ' + m); };

// Lanzador: usar el electron.exe del proyecto directamente (lo más fiable en Windows)
function resolveLauncher(appPath) {
  // 1) ruta canónica que exporta el módulo electron
  try {
    const p = require(path.join(appPath, 'node_modules', 'electron'));
    if (typeof p === 'string' && fs.existsSync(p)) return { cmd: p, args: ['.'], shell: false };
  } catch (e) { log('require(electron) falló: ' + e.message); }
  // 2) ruta directa al binario (Windows)
  const exe = path.join(appPath, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (fs.existsSync(exe)) return { cmd: exe, args: ['.'], shell: false };
  // 3) atajo .bin
  const bin = process.platform === 'win32' ? 'electron.cmd' : 'electron';
  const local = path.join(appPath, 'node_modules', '.bin', bin);
  if (fs.existsSync(local)) return { cmd: local, args: ['.'], shell: process.platform === 'win32' };
  // 4) npx como último recurso
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return { cmd: npx, args: ['electron', '.'], shell: process.platform === 'win32' };
}

function startPet() {
  if (running()) { log('ya está corriendo'); return; }
  let appPath = (cfg().get('path') || '').trim();
  log('pixelPet.path = "' + appPath + '"');
  if (!appPath || !fs.existsSync(path.join(appPath, 'main.js'))) {
    log('no se encontró main.js en la ruta');
    vscode.window.showWarningMessage(
      'Pixel Pet: la ruta "pixelPet.path" no apunta a una carpeta con main.js.',
      'Abrir ajustes', 'Ver detalle'
    ).then(s => {
      if (s === 'Abrir ajustes') vscode.commands.executeCommand('workbench.action.openSettings', 'pixelPet.path');
      if (s === 'Ver detalle') out.show();
    });
    return;
  }
  const { cmd, args, shell } = resolveLauncher(appPath);
  log('lanzando: ' + cmd + ' ' + args.join(' ') + '  (cwd=' + appPath + ', shell=' + shell + ')');
  try {
    child = cp.spawn(cmd, args, { cwd: appPath, shell, windowsHide: true });
  } catch (e) {
    log('spawn lanzó excepción: ' + e.message);
    vscode.window.showErrorMessage('Pixel Pet: no se pudo lanzar — ' + e.message + ' (ver Output > Pixel Pet)');
    child = null; updateStatus(); return;
  }
  if (child.stderr) child.stderr.on('data', d => log('stderr: ' + d.toString().trim()));
  if (child.stdout) child.stdout.on('data', d => log('stdout: ' + d.toString().trim()));
  child.on('exit', (code) => { log('proceso terminó (code=' + code + ')'); child = null; updateStatus(); });
  child.on('error', (e) => { log('error de proceso: ' + e.message); vscode.window.showErrorMessage('Pixel Pet: ' + e.message + ' (ver Output > Pixel Pet)'); child = null; updateStatus(); });
  updateStatus();
}

function stopPet() {
  if (running()) { try { child.kill(); } catch (e) {} }
  child = null; updateStatus();
}

function updateStatus() {
  if (!statusItem) return;
  statusItem.text = running() ? '$(squirrel) Pet: on' : '$(squirrel) Pet: off';
  statusItem.tooltip = running() ? 'Pixel Pet activo — clic para apagar' : 'Pixel Pet apagado — clic para encender';
}

function activate(context) {
  out = vscode.window.createOutputChannel('Pixel Pet');
  log('extensión activada (v0.3.0)');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'pixelPet.toggle';
  statusItem.show();
  context.subscriptions.push(statusItem, out,
    vscode.commands.registerCommand('pixelPet.start', startPet),
    vscode.commands.registerCommand('pixelPet.stop', stopPet),
    vscode.commands.registerCommand('pixelPet.restart', () => { stopPet(); setTimeout(startPet, 400); }),
    vscode.commands.registerCommand('pixelPet.toggle', () => { running() ? stopPet() : startPet(); })
  );
  updateStatus();
  if (cfg().get('autoStart', true)) startPet();
}
function deactivate() { stopPet(); }
module.exports = { activate, deactivate };

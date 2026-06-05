const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

let child = null, statusItem = null, out = null;
const cfg = () => vscode.workspace.getConfiguration('pixelPet');
const running = () => !!(child && child.exitCode === null && !child.killed);
const log = (m) => { if (out) out.appendLine('[' + new Date().toLocaleTimeString() + '] ' + m); };

function resolveLauncher(appPath) {
  try { const p = require(path.join(appPath, 'node_modules', 'electron')); if (typeof p === 'string' && fs.existsSync(p)) return { cmd: p, args: ['.'], shell: false }; } catch (e) { log('require(electron): ' + e.message); }
  const exe = path.join(appPath, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (fs.existsSync(exe)) return { cmd: exe, args: ['.'], shell: false };
  const bin = process.platform === 'win32' ? 'electron.cmd' : 'electron';
  const local = path.join(appPath, 'node_modules', '.bin', bin);
  if (fs.existsSync(local)) return { cmd: local, args: ['.'], shell: process.platform === 'win32' };
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return { cmd: npx, args: ['electron', '.'], shell: process.platform === 'win32' };
}

function startPet() {
  if (running()) { log('ya corre'); return; }
  const appPath = (cfg().get('path') || '').trim();
  log('path = "' + appPath + '"');
  if (!appPath || !fs.existsSync(path.join(appPath, 'main.js'))) {
    log('no se encontró main.js en la ruta configurada');
    vscode.window.showWarningMessage('Pixel Pet: "pixelPet.path" no apunta a una carpeta con main.js.', 'Abrir ajustes', 'Ver detalle')
      .then(s => { if (s === 'Abrir ajustes') vscode.commands.executeCommand('workbench.action.openSettings', 'pixelPet.path'); if (s === 'Ver detalle') out.show(); });
    return;
  }
  const { cmd, args, shell } = resolveLauncher(appPath);
  log('lanzando: ' + cmd + ' ' + args.join(' ') + '  (cwd=' + appPath + ', shell=' + shell + ')');
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  try { child = cp.spawn(cmd, args, { cwd: appPath, shell, windowsHide: true, env }); }
  catch (e) { log('spawn excepción: ' + e.message); vscode.window.showErrorMessage('Pixel Pet: ' + e.message); child = null; updateStatus(); return; }
  if (child.stderr) child.stderr.on('data', d => log('stderr: ' + d.toString().trim()));
  child.on('exit', c => { log('proceso terminó (code=' + c + ')'); child = null; updateStatus(); });
  child.on('error', e => { log('error de proceso: ' + e.message); vscode.window.showErrorMessage('Pixel Pet: ' + e.message); child = null; updateStatus(); });
  log('proceso lanzado'); updateStatus();
}
function stopPet() { if (running()) { try { child.kill(); } catch (e) {} } child = null; updateStatus(); }
function updateStatus() { if (statusItem) statusItem.text = running() ? '$(squirrel) Pet: on' : '$(squirrel) Pet: off'; }

function activate(context) {
  out = vscode.window.createOutputChannel('Pixel Pet');
  log('extensión activada (v0.2.1)');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'pixelPet.toggle'; statusItem.show();
  context.subscriptions.push(statusItem, out,
    vscode.commands.registerCommand('pixelPet.start', startPet),
    vscode.commands.registerCommand('pixelPet.stop', stopPet),
    vscode.commands.registerCommand('pixelPet.restart', () => { stopPet(); setTimeout(startPet, 400); }),
    vscode.commands.registerCommand('pixelPet.toggle', () => { running() ? stopPet() : startPet(); }));
  updateStatus();
  if (cfg().get('autoStart', true)) startPet();
}
function deactivate() { stopPet(); }
module.exports = { activate, deactivate };

# Pixel Pet (extensión de VS Code)

Enciende/apaga la mascota de escritorio (app Electron independiente) junto con la extensión.
La mascota sigue siendo un overlay del sistema y lee los agentes de Claude Code por su cuenta;
esta extensión solo controla su ciclo de vida.

## Configuración
- `pixelPet.path`: ruta absoluta a la carpeta de la app (donde está `main.js`).
- `pixelPet.autoStart`: encender al habilitar la extensión (por defecto: sí).

Requisito: haber corrido `npm install` en la carpeta de la app al menos una vez.

## Comandos
- Pixel Pet: Encender / Apagar / Reiniciar / Alternar
- Atajo rápido: el item "Pet: on/off" en la barra de estado (clic para alternar).

## Instalar
Desarrollo: abre esta carpeta en VS Code y pulsa F5 (Extension Development Host).
Permanente: `npm i -g @vscode/vsce` → `vsce package` → instala el `.vsix`
(Extensiones → "..." → "Install from VSIX").

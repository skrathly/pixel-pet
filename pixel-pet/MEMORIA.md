# Memoria de la sesión — Pixel Pet

## Bug original
La mascota desaparecía sin que la sesión de Claude Code hubiera cerrado, y reaparecía luego de forma intermitente.

**Causa raíz:** `main.js` inferí­a si una sesión seguía abierta según cuánto tiempo pasaba sin escribirse una línea nueva al `.jsonl` de la sesión (`SESSION_TTL`, originalmente 45s). Un agente puede pasar más de 45s sin escribir (pensando, corriendo un comando largo, un subagente, etc.), así que la sesión se daba por "cerrada" y el personaje se desmaterializaba aunque el agente siguiera trabajando. Al volver a escribir, el personaje se creaba de nuevo (reaparición).

**Dato importante descubierto:** el `.jsonl` de una sesión **nunca se borra** al cerrar el agente — queda como historial permanente (para `--resume`, etc.). Por eso nunca sirvió como señal de "sesión cerrada".

**Señal confiable encontrada:** `~/.claude/sessions/<pid>.json` — un archivo que Claude Code mantiene *mientras el proceso CLI sigue vivo* y borra al cerrar la sesión. Contiene `sessionId`, `pid`, `cwd`, y `status` (`"busy"`/otros), actualizado en vivo.

## Rediseño de `main.js`
- Presencia del personaje = existe su archivo en `~/.claude/sessions/` (+ chequeo de respaldo: `process.kill(pid, 0)` para descartar sesiones "fantasma" de procesos que crashearon sin limpiar su registro).
- Ya no existen `SESSION_TTL` ni `IDLE_HIDE`.
- Estado "trabajando" (personaje de espaldas + pantallita tipo Matrix) = `status === "busy"` del registro, en vez de inferencia por inactividad de escritura.
- El `.jsonl` se sigue leyendo, pero solo para mostrar de forma cosmética qué herramienta está usando el agente (Bash, Edit, etc.) mientras está `busy` — ya no decide si el personaje existe.

## Rediseño de `renderer.js` (saludo entre personajes)
Antes el globito de saludo era siempre `"¡hola!"`. Ahora, cada vez que dos personajes se cruzan (`tryGreet()`), cada uno recibe una frase independiente elegida al azar:
- 35% de las veces: saludo según la hora del sistema (`¡buenos días!` / `¡buenas tardes!` / `¡buenas noches!`).
- 65% de las veces: frase random de una lista (`¿qué más parce?`, `muévete, déjame pasar`, `ponte a trabajar`, `pídele al dev tareas`, `aún hay bugs y sigues aquí sin hacer nada`, etc.).

Probado con dos sesiones reales de Claude Code abiertas a la vez: el saludo funciona.

## Gotcha operativo: no correr dos instancias a la vez
La extensión de VS Code (`pixelPet.autoStart`) puede dejar una instancia de la app corriendo en segundo plano. Si además se lanza `npm start` manualmente, quedan **dos ventanas Electron independientes**, cada una con su propio estado en memoria — ambas detectan la misma sesión y dibujan su propio personaje por separado, pero **nunca pueden saludarse entre sí** porque no comparten el `pets` Map de JavaScript. Antes de probar cambios manualmente con `npm start`, conviene cerrar cualquier instancia ya corriendo (`taskkill /PID <pid> /T /F` sobre el proceso raíz de `electron.exe`).

## Esta copia del proyecto (`Documents\pixel-pet\pixel-pet\pixel-pet`)
- Existe una segunda copia del proyecto en `C:\Users\GustavoJurado\Desktop\snopthick` (no es symlink ni hardlink — son archivos independientes que, por alguna sincronización externa no identificada, ya reflejaban los mismos cambios de `main.js`/`renderer.js`).
- Diferencia encontrada: aquí los sprites viven en `sprites/char1.png`...`char8.png` (en `snopthick` están sueltos en la raíz). Se corrigió `renderer.js` para apuntar a `sprites/...`.
- Se corrió `npm install` (quedó 1 vulnerabilidad de severidad alta reportada por npm, sin resolver — `npm audit fix --force` implicaría un cambio de versión mayor de Electron, no se aplicó).
- Probado con `npm start`: carga bien, sprites visibles.

# pixel-pet
Es una representación de agentes animados para vscode con claude-code.

Al crear un agente desde vscode usando la terminal

Ejm:
Terminal:
  C:>claude 
          ingresar promt

  Esta desplegara el personaje. hasta que el agente cierre. o se desactive la mascota. dese vscode

  Usando el comando ctl+shift+p

Puedes descargar su instalador desde aqui:

https://github.com/skrathly/pixel-pet/blob/main/pixel-pet-setup.zip

**********************************************************************
                      Pixel Pet — Instalador
**********************************************************************


Requisitos previos:

  • Node.js  (https://nodejs.org)
  
  • VS Code  (https://code.visualstudio.com)

Pasos:
  1. Agrega el archivo "pixel-pet.vsix" a esta carpeta
     (el que generaste con: npx @vscode/vsce package)
  2. Haz clic derecho en "install.ps1"
     → "Ejecutar con PowerShell"
  3. Abre VS Code — la mascota arranca sola.

El instalador:

  ✔ Copia los archivos a %LOCALAPPDATA%\PixelPet\app
  
  ✔ Descarga Electron automáticamente (primera vez)
  
  ✔ Configura pixelPet.path en VS Code
  ✔ Instala la extensión
  ✔ Crea acceso directo en el escritorio

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "  >> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  OK $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  !! $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  ERROR: $msg" -ForegroundColor Red; Read-Host "Enter para cerrar"; exit 1 }

Clear-Host
Write-Host "  Pixel Pet v0.3.1 - Instalador" -ForegroundColor Magenta
Write-Host ""

$scriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$appSrc       = Join-Path $scriptDir "app"
$vsixSrc      = Join-Path $scriptDir "pixel-pet.vsix"
$installDir   = "$env:LOCALAPPDATA\PixelPet"
$appDest      = "$installDir\app"
$vsixDest     = "$installDir\pixel-pet.vsix"
$settingsPath = "$env:APPDATA\Code\User\settings.json"

Write-Step "Verificando requisitos ..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Fail "Node.js no encontrado. Instala desde https://nodejs.org" }
if (-not (Test-Path $appSrc))  { Write-Fail "No se encontro la carpeta 'app'." }
if (-not (Test-Path $vsixSrc)) { Write-Fail "No se encontro 'pixel-pet.vsix'." }
Write-OK "Requisitos OK."

Write-Step "Instalando archivos en $appDest ..."
if (Test-Path $appDest) { Remove-Item $appDest -Recurse -Force }
New-Item -ItemType Directory -Path $appDest -Force | Out-Null
Copy-Item "$appSrc\*" $appDest -Recurse -Force
Write-OK "Archivos copiados."

Write-Step "Instalando Electron (puede tardar ~1 minuto) ..."
$npm = "npm.cmd"
$proc = Start-Process -FilePath $npm -ArgumentList "install" -WorkingDirectory $appDest -Wait -PassThru -WindowStyle Hidden
if ($proc.ExitCode -ne 0) { Write-Fail "npm install fallo." }
Write-OK "Electron instalado."

Write-Step "Copiando extension ..."
Copy-Item $vsixSrc $vsixDest -Force
Write-OK "Extension copiada."

Write-Step "Configurando VS Code (pixelPet.path) ..."
try {
    $settingsDir = Split-Path $settingsPath
    if (-not (Test-Path $settingsDir)) { New-Item -ItemType Directory $settingsDir -Force | Out-Null }
    if (-not (Test-Path $settingsPath)) {
        [System.IO.File]::WriteAllText($settingsPath, "{}", (New-Object System.Text.UTF8Encoding($false)))
    }
    $raw     = [System.IO.File]::ReadAllText($settingsPath)
    $jsonVal = $appDest -replace '\\', '\\\\'
    $newLine = "  `"pixelPet.path`": `"$jsonVal`""
    if ($raw -match '"pixelPet\.path"') {
        $raw = $raw -replace '(?m)^\s*"pixelPet\.path"\s*:.*$', $newLine
    } else {
        $raw = [System.Text.RegularExpressions.Regex]::Replace(
            $raw, '(?s)(.*\S)(\s*\}\s*)$',
            ('$1,' + [Environment]::NewLine + $newLine + [Environment]::NewLine + '}'))
    }
    [System.IO.File]::WriteAllText($settingsPath, $raw, (New-Object System.Text.UTF8Encoding($false)))
    Write-OK "pixelPet.path configurado."
} catch {
    Write-Warn "No se pudo actualizar settings.json: $_"
}

Write-Step "Instalando extension en VS Code ..."
$codeExe = ""
foreach ($c in @("code", "code.cmd", "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd")) {
    if (Get-Command $c -ErrorAction SilentlyContinue) { $codeExe = $c; break }
    if (Test-Path $c) { $codeExe = $c; break }
}
if ($codeExe) {
    try { & $codeExe --install-extension $vsixDest --force 2>&1 | Out-Null; Write-OK "Extension instalada." }
    catch { Write-Warn "Instalacion automatica fallo. Usa el acceso directo del escritorio." }
} else { Write-Warn "VS Code no encontrado en PATH." }

Write-Step "Creando acceso directo en el escritorio ..."
try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $ws  = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut("$desktop\Instalar Pixel Pet.lnk")
    if ($codeExe) {
        $lnk.TargetPath  = "cmd.exe"
        $lnk.Arguments   = "/k `"$codeExe`" --install-extension `"$vsixDest`" --force"
        $lnk.Description = "Instala o actualiza Pixel Pet en VS Code"
    } else {
        $lnk.TargetPath  = $vsixDest
    }
    $lnk.Save()
    Write-OK "Acceso directo creado."
} catch { Write-Warn "No se pudo crear el acceso directo." }

Write-Host ""
Write-Host "  Instalacion completada!" -ForegroundColor Green
Write-Host "  App: $appDest" -ForegroundColor Gray
Write-Host "  Abre VS Code - la mascota arrancara sola." -ForegroundColor White
Write-Host ""
Read-Host "  Enter para cerrar"

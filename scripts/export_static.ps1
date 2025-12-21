$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$src = Join-Path $repo "vakaroslive\\static"
$dst = Join-Path $repo "dist"

if (Test-Path $dst) {
  Remove-Item -Recurse -Force $dst
}
New-Item -ItemType Directory -Path $dst | Out-Null

Copy-Item -Recurse -Force (Join-Path $src "*") $dst

Write-Host "Export OK -> $dst"
Write-Host "Sugerencia: publica la carpeta dist/ en un hosting HTTPS (GitHub Pages/Netlify) e instala la PWA en Android."

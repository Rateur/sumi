# Builds the Microsoft Store package from a release build of Sumi.
#   pack.ps1                 lays out the package in target/store/layout and packs target/store/Sumi_<version>_x64.msix
#   pack.ps1 -LayoutOnly     only lays it out, to try it: Add-AppxPackage -Register target\store\layout\AppxManifest.xml
# The .msix is unsigned: the Store signs it after certification.
param([switch]$LayoutOnly)
$ErrorActionPreference = 'Stop'

$root = Resolve-Path "$PSScriptRoot\..\.."
# The Store wants four numbers and keeps the last one for itself.
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version + '.0'
$exe = "$root\src-tauri\target\release\sumi.exe"
if (-not (Test-Path $exe)) { throw "No release build at ${exe}: run npm run tauri build first." }

$out = "$root\src-tauri\target\store"
$layout = "$out\layout"
Remove-Item $layout -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$layout\assets" | Out-Null
Copy-Item $exe "$layout\Sumi.exe"
Copy-Item "$PSScriptRoot\assets\*" "$layout\assets"
(Get-Content "$PSScriptRoot\AppxManifest.xml" -Raw).Replace('{VERSION}', $version) |
  Set-Content "$layout\AppxManifest.xml" -Encoding utf8
if ($LayoutOnly) { Write-Output $layout; return }

$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" |
  Sort-Object FullName | Select-Object -Last 1
if (-not $makeappx) { throw 'makeappx.exe not found: install the Windows SDK.' }
$msix = "$out\Sumi_${version}_x64.msix"
& $makeappx.FullName pack /o /d $layout /p $msix | Out-Null
if ($LASTEXITCODE) { throw "makeappx failed with $LASTEXITCODE" }
Write-Output $msix

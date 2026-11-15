# Downloads a portable Node.js (Windows x64) into the given folder. Used by Build-Pocketwave.bat.
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$Work
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$base = 'https://nodejs.org/dist/latest-v22.x'
New-Item -ItemType Directory -Force -Path $Work | Out-Null

Write-Host '        Looking for the latest Node.js 22 (LTS)...'
$sums = [string](Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content
$entry = $null
foreach ($l in ($sums -split "`n")) {
  if ($l -match '^([0-9a-f]{64})\s+(node-v[\d\.]+-win-x64\.zip)\s*$') { $entry = @{ Hash = $Matches[1]; Name = $Matches[2] }; break }
}
if (-not $entry) { throw 'Could not find the Node.js download for Windows x64.' }

$zip = Join-Path $Work 'node.zip'
Write-Host ("        Downloading " + $entry.Name + " (about 30 MB)...")
Invoke-WebRequest -UseBasicParsing -Uri "$base/$($entry.Name)" -OutFile $zip

$hash = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
if ($hash -ne $entry.Hash) { throw 'The downloaded file is damaged (checksum mismatch). Please try again.' }

Write-Host '        Unpacking...'
$tmp = Join-Path $Work 'node-unpack'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$inner = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
Move-Item -Path $inner.FullName -Destination $InstallDir
Remove-Item -Recurse -Force $tmp
Remove-Item -Force $zip
if (-not (Test-Path (Join-Path $InstallDir 'node.exe'))) { throw 'Node.js was not unpacked correctly.' }
Write-Host '        Node.js is ready.'

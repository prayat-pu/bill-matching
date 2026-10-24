# Installs everything the app needs on a Windows 10/11 host:
# Node 24, poppler, the .env key, the packages and the built page.
# Run it through install.cmd, which asks for administrator rights first.

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$PopplerDir = Join-Path $Root "vendor\poppler"
$EnvFile = Join-Path $Root ".env"
$Port = 40000

# A pinned version to fall back on when GitHub's API is rate limited.
$PopplerFallback = "25.07.0-0"
$NodeFallback = "24.22.1"

function Say($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Ok($text) { Write-Host "  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  $text" -ForegroundColor Yellow }

function Refresh-Path {
  # A fresh install does not show up in this process's PATH on its own.
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Node-Major {
  Refresh-Path
  $exe = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $exe) { return 0 }
  try { return [int]((& node -p "process.versions.node").Split(".")[0]) } catch { return 0 }
}

# --- Windows version -------------------------------------------------------
Say "checking Windows"
if ([Environment]::Is64BitOperatingSystem -ne $true) {
  throw "This is a 32-bit Windows. Node 24 only ships 64-bit - the app cannot run here."
}
$build = [Environment]::OSVersion.Version
if ($build.Major -lt 10) {
  throw "This is Windows $($build.Major). Node 24 needs Windows 10 or newer - run the app on a newer PC and open it from this one in a browser."
}
Ok "Windows $($build.Major), 64-bit"

# --- Node ------------------------------------------------------------------
Say "checking Node"
$major = Node-Major
if ($major -ge 24) {
  Ok "Node $(& node -v) is already installed"
} else {
  if ($major -gt 0) { Warn "Node $major is too old, installing a newer one" } else { Warn "Node is not installed" }

  $version = $NodeFallback
  try {
    $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing
    $newest = $index | Where-Object { $_.version -like "v24.*" } | Select-Object -First 1
    if ($newest) { $version = $newest.version.TrimStart("v") }
  } catch {
    Warn "could not reach nodejs.org for the version list, using $NodeFallback"
  }

  $msi = Join-Path $env:TEMP "node-v$version-x64.msi"
  Write-Host "  downloading Node $version ..."
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$version/node-v$version-x64.msi" -OutFile $msi -UseBasicParsing
  Write-Host "  installing (quiet, a minute or two) ..."
  $run = Start-Process msiexec.exe -ArgumentList "/i", "`"$msi`"", "/qn", "/norestart" -Wait -PassThru
  if ($run.ExitCode -ne 0) { throw "the Node installer failed with code $($run.ExitCode)" }
  Remove-Item $msi -ErrorAction SilentlyContinue

  if ((Node-Major) -lt 24) { throw "Node still is not on PATH. Reboot and run this again." }
  Ok "Node $(& node -v) installed"
}

# --- poppler ---------------------------------------------------------------
Say "checking poppler"
$pdftoppm = @(
  (Join-Path $PopplerDir "Library\bin\pdftoppm.exe"),
  (Join-Path $PopplerDir "bin\pdftoppm.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($pdftoppm) {
  Ok "already here: $pdftoppm"
} else {
  $url = "https://github.com/oschwartz10612/poppler-windows/releases/download/v$PopplerFallback/Release-$PopplerFallback.zip"
  try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/oschwartz10612/poppler-windows/releases/latest" `
      -Headers @{ "User-Agent" = "bill-matching-installer" } -UseBasicParsing
    $asset = $release.assets | Where-Object { $_.name -like "Release-*.zip" } | Select-Object -First 1
    if ($asset) { $url = $asset.browser_download_url }
  } catch {
    Warn "GitHub's API did not answer, using the pinned build $PopplerFallback"
  }

  $zip = Join-Path $env:TEMP "poppler.zip"
  $unpack = Join-Path $env:TEMP "poppler-unpack"
  Write-Host "  downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $unpack -Force

  # The zip wraps everything in one folder; find the level above bin, so that
  # vendor\poppler ends up with the same shape the zip had.
  $found = Get-ChildItem -Path $unpack -Recurse -Filter "pdftoppm.exe" | Select-Object -First 1
  if (-not $found) { throw "pdftoppm.exe was not in the zip - download it by hand instead" }
  $binDir = $found.DirectoryName
  $above = Split-Path -Parent $binDir
  if ((Split-Path -Leaf $binDir) -eq "bin" -and (Split-Path -Leaf $above) -eq "Library") {
    $popplerRoot = Split-Path -Parent $above          # ...\<release>\Library\bin
  } elseif ((Split-Path -Leaf $binDir) -eq "bin") {
    $popplerRoot = $above                             # ...\<release>\bin
  } else {
    $popplerRoot = $binDir
  }

  if (Test-Path $PopplerDir) { Remove-Item $PopplerDir -Recurse -Force }
  New-Item -ItemType Directory -Path (Split-Path -Parent $PopplerDir) -Force | Out-Null
  Move-Item -Path $popplerRoot -Destination $PopplerDir
  Remove-Item $zip, $unpack -Recurse -Force -ErrorAction SilentlyContinue

  $pdftoppm = @(
    (Join-Path $PopplerDir "Library\bin\pdftoppm.exe"),
    (Join-Path $PopplerDir "bin\pdftoppm.exe")
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $pdftoppm) { throw "poppler unpacked, but pdftoppm.exe is not where it was expected" }
  Ok "installed: $pdftoppm"
}

# --- the API key -----------------------------------------------------------
Say "checking the Gemini key"
if (Test-Path $EnvFile) {
  Ok ".env is there"
} else {
  Write-Host "  .env is missing. Paste the Gemini API key (it is stored only in $EnvFile):"
  $key = Read-Host "  GEMINI_API_KEY"
  if ([string]::IsNullOrWhiteSpace($key)) { throw "no key given - create .env by hand and run this again" }
  # No BOM: Node's env file reader would read it as part of the first name.
  [IO.File]::WriteAllText($EnvFile, "GEMINI_API_KEY=$($key.Trim())`n", (New-Object Text.UTF8Encoding($false)))
  Ok "wrote $EnvFile"
}

# --- packages and the page -------------------------------------------------
Say "installing packages (needs internet, a few minutes)"
Push-Location $Root
try {
  & cmd /c "npm ci"
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
  Say "building the page"
  & cmd /c "npm run build"
  if ($LASTEXITCODE -ne 0) { throw "the build failed" }
} finally {
  Pop-Location
}
Ok "ready"

# --- firewall --------------------------------------------------------------
Say "opening TCP $Port for the office network"
try {
  netsh advfirewall firewall delete rule name="Bill Matching" | Out-Null
  netsh advfirewall firewall add rule name="Bill Matching" dir=in action=allow protocol=TCP localport=$Port | Out-Null
  Ok "firewall rule added"
} catch {
  Warn "could not add the firewall rule - other PCs may not be able to connect"
}

# --- done ------------------------------------------------------------------
Say "finished"
Write-Host "  start the app with:  deploy\windows\start.cmd"
Write-Host "  this PC:   http://localhost:$Port"
try {
  Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -ne "127.0.0.1" } |
    ForEach-Object { Write-Host "  other PCs: http://$($_.IPAddress):$Port" }
} catch { }
Write-Host ""
$answer = Read-Host "Start it now? (y/n)"
if ($answer -eq "y") { Start-Process (Join-Path $PSScriptRoot "start.cmd") }

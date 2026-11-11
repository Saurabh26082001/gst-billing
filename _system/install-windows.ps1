# Free GST Billing - Windows installer.
#
# Invoked by the HTA launcher on first run. Idempotent - safe to
# re-run any time. Installs Node.js if missing, runs npm install
# inside _system/, and creates Desktop and Start Menu icons that open
# the app (see app-shortcut.ps1) so the user never has to open the
# extract folder again.

$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = 'Free GST Billing - Installer'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SystemDir = $ScriptDir
$RootDir   = Split-Path -Parent $ScriptDir

Write-Host ''
Write-Host '  ============================================================'
Write-Host '   Free GST Billing Software - Installer'
Write-Host '  ============================================================'
Write-Host ''

# v1.10.75 - never make a second copy by accident. Every new ZIP extracts to a
# new folder (Downloads\Free-GST-Billing-v1.10.74), and installing there made
# a second, empty app and moved the shortcuts to it, so the invoices seemed
# gone. The shortcuts point at the real install; if that is another folder
# with the app in it, stop and send the user to Update instead. Setting
# FREEGSTBILL_DIR still allows a deliberate second copy.
function Find-OtherInstall {
  $here = $RootDir.TrimEnd('\')
  $roots = @()
  foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    # One unreadable or empty shortcut must not stop the others being checked.
    try {
      $lnk = Join-Path $dir 'Free GST Billing.lnk'
      if (-not (Test-Path -LiteralPath $lnk)) { continue }
      # v1.10.83 - the one-line install's shortcut runs "...\_system\start-windows.ps1"
      # -AppWindow; the launcher's runs "...\Free GST Billing - WINDOWS.hta". The
      # first quoted path is the script either way.
      $a = [string](New-Object -ComObject WScript.Shell).CreateShortcut($lnk).Arguments
      $p = if ($a -match '"([^"]+)"') { $Matches[1] } else { $a.Trim() }
      $r = Split-Path -Parent $p
      if ((Split-Path -Leaf $r) -eq '_system') { $r = Split-Path -Parent $r }
      $roots += $r
    } catch { }
  }
  $roots += Join-Path $env:LOCALAPPDATA 'Programs\Free GST Billing'
  foreach ($r in $roots) {
    if (-not $r -or $r.TrimEnd('\') -eq $here) { continue }
    if ((Test-Path -LiteralPath (Join-Path $r '_system\server.js')) -and (Test-Path -LiteralPath (Join-Path $r '_system\node_modules'))) { return $r }
  }
  return $null
}
if (-not $env:FREEGSTBILL_DIR) {
  $other = Find-OtherInstall
  if ($other) {
    Write-Host '  Free GST Billing is already installed on this computer, in:' -ForegroundColor Yellow
    Write-Host "    $other"
    Write-Host ''
    Write-Host '  Installing again here would make a second copy with no invoices in it.'
    Write-Host '  To get the newest version, update the installed copy instead:'
    Write-Host '  open it from your Free GST Billing shortcut, then'
    Write-Host '  More options -> Update to the latest version.'
    Write-Host ''
    Write-Host '  Nothing was changed. This folder is not needed; you can delete it.'
    Read-Host '  Press Enter to close'
    exit 0
  }
}

# --- Step 1: Node.js check ---
# v1.10.69 - Node.js is installed INTO the app folder, not into Windows.
#
# This used to run the official .msi with /qn. That installer writes to
# C:\Program Files\nodejs, which needs administrator rights - and /qn means
# "fully silent", so Windows cannot even show the UAC prompt that would grant
# them. On a standard account, or a work laptop, or any PC where the user is
# not a local admin, it simply did nothing. The exit code was never checked,
# so the script marched on to npm install, which failed with
# "npm is not recognized" - and the person was told "npm install failed",
# which tells them nothing they can act on.
#
# The official portable ZIP needs no rights at all: unpack it next to the app
# and point PATH at it. Nothing is written outside this folder, no UAC prompt
# appears, and a Node.js the user already has is left completely alone.
# v1.10.81 (#109) - and only a Node.js new enough: see ensure-node.ps1.
. (Join-Path $SystemDir 'ensure-node.ps1')
if (-not (Use-GoodNode)) {
  Read-Host '  Press Enter to close'
  exit 1
}
# v1.10.83 - the release ZIP carries its packages, so there is nothing to
# download here. npm runs only for a folder whose packages are missing or were
# left half-done by an old npm (ERR-060).
$needNpm = -not (Test-PackagesReady)
if ($needNpm -and ($script:NodeWasFetched -or (Test-PackagesBroken))) { Reset-Packages }

# --- Step 2: npm install inside _system/ ---
Write-Host ''
if (-not $needNpm) {
  Write-Host '  The app packages are already in place - nothing to download.'
} else {
Write-Host '  Installing app dependencies (npm install)...'
if (-not (Test-InstallReady)) {
  Read-Host '  Press Enter to close'
  exit 1
}
Push-Location $SystemDir
try {
  npm install --omit=dev --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw "npm install exited $LASTEXITCODE" }
} catch {
  Write-Host ''
  Pop-Location
  Show-InstallHelp
  Write-Host '  Then run this again - it carries on where it stopped.'
  Read-Host '  Press Enter to close'
  exit 1
}
Pop-Location
}

# --- Steps 3 and 4: Desktop and Start Menu icons ---
# v1.10.83 - the icons open the app itself (start-windows.ps1 starts the
# server when it is not running, then opens the app in its own window), the
# same as the one-line install's. They used to open the launcher, which
# needed a second click on Open App. The launcher stays in the app folder for
# installing, updating and repairs; the app's Control Panel does the rest.
. (Join-Path $SystemDir 'app-shortcut.ps1')
Write-Host ''
Write-Host '  Creating the Desktop and Start Menu icons...'
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  try {
    New-AppShortcut (Join-Path $dir 'Free GST Billing.lnk') $SystemDir
    Write-Host "  Icon created in $dir"
  } catch {
    Write-Host "  WARNING: could not create the icon in $dir ($($_.Exception.Message)). You can still open the app from the launcher in the app folder."
  }
}

# --- Step 5: Hide _system folder so root looks clean ---
try {
  attrib +H "$SystemDir" 2>$null
} catch { }

# --- Step 6: give the app folder our icon ---
# Windows will not let a .hta, .sh or .command file carry its own icon - a
# file gets whatever its TYPE is registered with, and only .exe, .ico, .lnk
# and folders can say otherwise. A folder can, through desktop.ini, and only
# when the folder itself is marked read-only or system. So the one icon we
# are allowed to set here, we set: the install folder stops looking like a
# nameless yellow folder full of files Windows has no idea about.
try {
  $iconFile = Join-Path $SystemDir 'app-icon.ico'
  if (Test-Path $iconFile) {
    $ini = Join-Path $RootDir 'desktop.ini'
    $lines = @(
      '[.ShellClassInfo]',
      'IconResource=_system\app-icon.ico,0',
      'InfoTip=Free GST Billing Software - open the launcher inside'
    )
    Set-Content -Path $ini -Value $lines -Encoding ASCII -Force
    attrib +H +S "$ini" 2>$null
    # The folder needs one of these bits before the shell reads desktop.ini.
    # +R on a folder is only this marker; it does not make anything inside
    # read-only.
    attrib +R "$RootDir" 2>$null
  }
} catch { }

Write-Host ''
Write-Host '  ============================================================'
Write-Host '   [OK] Install complete!' -ForegroundColor Green
Write-Host '  ============================================================'
Write-Host ''
Write-Host '  Opening the app in your browser now...'
Write-Host ''
Write-Host '  Next time, click the Free GST Billing icon on your Desktop or in the Start menu.'
Write-Host ''

# v1.10.69 - finish the job. Leaving a console window saying "now go and
# click Open App" is one step too many for someone who has never installed
# anything but an .exe: they saw a black window, it said OK, and nothing
# happened. Start the server and open the browser ourselves. This runs for
# the launcher path and for the one-command install alike.
$starter = Join-Path $SystemDir 'start-windows.ps1'
if (Test-Path $starter) {
  & $starter -AppWindow
} else {
  Write-Host '  Could not find start-windows.ps1 - open the launcher and click Open App.'
  Read-Host '  Press Enter to close'
}

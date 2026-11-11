# Free GST Billing - the app's Desktop / Start Menu icon (v1.10.83).
# Dot-sourced by install-windows.ps1 and start-windows.ps1. install.ps1 (the
# one-line install) has its own copy of New-AppShortcut: keep the two alike.
#
# The icon opens the app itself: start-windows.ps1 starts the server when it
# is not running and opens the app in its own window. The console is
# minimised and then hidden, so all that shows is the app (-Hidden puts a
# problem on screen if there is one).

function New-AppShortcut([string]$path, [string]$sys) {
  $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
  $sc.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $sc.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $sys 'start-windows.ps1')`" -AppWindow -Hidden"
  $sc.WorkingDirectory = $sys
  $sc.WindowStyle = 7
  $sc.IconLocation = "$(Join-Path $sys 'app-icon.ico'),0"
  $sc.Description = 'Free GST Billing Software'
  $sc.Save()
}

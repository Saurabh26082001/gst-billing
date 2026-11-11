#!/bin/sh
# Free GST Billing - open the app in its own window (macOS and Linux).
#
# v1.10.83 - what the one-line install's icons run: the Mac app, the Linux
# menu entry and "start with the computer". Starts the server if it is not
# running yet, then opens the app without tabs or an address bar when Chrome,
# Edge, Chromium or Brave is installed, else in the default browser.
#
# Plain POSIX sh (NAS images have no bash); keep it ASCII only (ERR-001).
# FREEGSTBILL_TEST=<anything> starts the server but opens no window.

SYS=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)

# Finder and desktop menus start programs with a bare PATH. Add where Node.js
# can be: our own copy, the one install.sh found, Homebrew, the nodejs.org pkg.
NODE_DIR=$(cat "$SYS/node-dir.txt" 2>/dev/null)
PATH="$SYS/node/bin:${NODE_DIR:+$NODE_DIR:}/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

# The server writes the port it really got (another program may hold ours)
# to data/port.txt, so this is read again while waiting for it.
read_port() {
  PORT=$(tr -cd '0-9' < "$SYS/data/port.txt" 2>/dev/null)
  [ -n "$PORT" ] || PORT=47371
  URL="http://localhost:$PORT/"
}
read_port

problem() {
  msg="Free GST Billing could not start: $1 To repair it, run the install line again (https://dicecodes.com/free-gst-software-documentation/install.html)."
  if [ "$(uname -s)" = Darwin ] && [ -z "${FREEGSTBILL_TEST:-}" ]; then
    osascript -e "display alert \"Free GST Billing\" message \"$msg\"" >/dev/null 2>&1
  fi
  printf '  %s\n' "$msg" >&2
  exit 1
}

up() {
  node -e "fetch('http://127.0.0.1:$PORT/api/profile').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null
}

command -v node >/dev/null 2>&1 || problem 'Node.js was not found.'
node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || problem 'the Node.js on this computer is older than version 18.'

if ! up; then
  [ -f "$SYS/node_modules/express/package.json" ] || problem 'some of its files are missing.'
  printf '  Starting Free GST Billing...\n'
  (cd "$SYS" && nohup node "$SYS/server.js" >/dev/null 2>&1 &)
  # The first start after an install is the slow one (90s, as on Windows).
  i=0
  while ! up; do
    i=$((i + 1))
    [ "$i" -gt 90 ] && problem "it did not answer in 90 seconds. Try $URL in your browser in a minute."
    sleep 1
    read_port
  done
fi

if [ -n "${FREEGSTBILL_TEST:-}" ]; then
  printf '  (test mode: would open %s)\n' "$URL"
  exit 0
fi

if [ "$(uname -s)" = Darwin ]; then
  for app in 'Google Chrome' 'Microsoft Edge' 'Chromium' 'Brave Browser'; do
    if [ -d "/Applications/$app.app" ] || [ -d "$HOME/Applications/$app.app" ]; then
      open -na "$app" --args --app="$URL" && exit 0
    fi
  done
  open "$URL"
else
  for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser; do
    if command -v "$b" >/dev/null 2>&1; then
      nohup "$b" --app="$URL" >/dev/null 2>&1 &
      exit 0
    fi
  done
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
  else
    printf '  Open %s in your browser.\n' "$URL"
  fi
fi

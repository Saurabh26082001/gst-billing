#!/bin/sh
# Free GST Billing - remove the app (Control Panel -> Remove the app).
#
# The server starts this from a temp copy and exits; this waits for it, then
# deletes. Arguments: <_system folder> <server pid> [data] [pdfs] [backups].
# The program and its icons always go; the words say what else goes.
# Whatever is kept stays in _system, so installing into the same folder again
# brings it all back. Plain POSIX sh, like update-unix.sh.

SYS=$1
PID=$2
shift 2 || exit 1
DATA='' PDFS='' BACKUPS=''
for a in "$@"; do
  case $a in data) DATA=1 ;; pdfs) PDFS=1 ;; backups) BACKUPS=1 ;; esac
done
[ "$(basename "$SYS")" = _system ] && [ -f "$SYS/server.js" ] || exit 1
ROOT=$(dirname "$SYS")

i=0
while [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null && [ $i -lt 20 ]; do sleep 1; i=$((i + 1)); done

# Icons the install line made, only if they open this copy.
for f in "$HOME/Applications/Free GST Billing.app/Contents/MacOS/launch" \
         "$HOME/Library/LaunchAgents/com.dicecodes.freegstbilling.plist" \
         "${XDG_DATA_HOME:-$HOME/.local/share}/applications/free-gst-billing.desktop" \
         "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/free-gst-billing.desktop"; do
  grep -qsF "$SYS" "$f" || continue
  case $f in */MacOS/launch) rm -rf "$HOME/Applications/Free GST Billing.app" ;; *) rm -f "$f" ;; esac
done

# Data deleted but backups kept: one last copy first. If that copy fails the
# data is kept, never lost.
BACKUP_HOME="$HOME/Documents/FreeGSTBill Backups"
if [ -n "$DATA" ] && [ -z "$BACKUPS" ] && [ -n "$(ls -A "$SYS/data" 2>/dev/null)" ]; then
  mkdir -p "$BACKUP_HOME" 2>/dev/null &&
    tar -czf "$BACKUP_HOME/before-removal-$(date +%Y-%m-%d_%H-%M-%S).tar.gz" -C "$SYS" data || DATA=''
fi

for entry in "$SYS"/* "$SYS"/.[!.]*; do
  [ -e "$entry" ] || continue
  case "$(basename "$entry")" in
    data) [ -n "$DATA" ] || continue ;;
    'Saved Invoices' | Trash) [ -n "$PDFS" ] || continue ;;
  esac
  rm -rf "$entry"
done
# Only the app's own files beside _system; anything else there is the user's.
for entry in "$ROOT"/'Free GST Billing - '* "$ROOT/READ ME FIRST.txt"; do
  [ -e "$entry" ] && rm -rf "$entry"
done
rmdir "$SYS" 2>/dev/null
rmdir "$ROOT" 2>/dev/null
[ -z "$BACKUPS" ] || rm -rf "$BACKUP_HOME"
# The temp copy the server made; never the folder if run from _system by hand.
case "$(basename "$(dirname "$0")")" in fgsb-remove-*) rm -rf "$(dirname "$0")" ;; esac

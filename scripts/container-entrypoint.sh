#!/bin/sh
set -eu

if [ "${PARKRUN_HEADLESS:-true}" = "false" ]; then
  if [ -z "${PARKRUN_VNC_PASSWORD:-}" ]; then
    echo '{"level":"error","component":"browser-console","event":"missing_vnc_password","message":"PARKRUN_VNC_PASSWORD is required when PARKRUN_HEADLESS=false"}' >&2
    exit 1
  fi

  export DISPLAY="${DISPLAY:-:99}"
  password_file="${PARKRUN_DATA_DIR:-/data}/.vnc-password"
  x11vnc -storepasswd "$PARKRUN_VNC_PASSWORD" "$password_file" >/dev/null
  chmod 600 "$password_file"

  echo "{\"level\":\"info\",\"component\":\"browser-console\",\"event\":\"xvfb_starting\",\"display\":\"$DISPLAY\"}"
  Xvfb "$DISPLAY" -screen 0 1440x900x24 -nolisten tcp &

  attempts=0
  display_number="${DISPLAY#:}"
  display_number="${display_number%%.*}"
  while [ ! -S "/tmp/.X11-unix/X${display_number}" ]; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 100 ]; then
      echo '{"level":"error","component":"browser-console","event":"xvfb_start_failed"}' >&2
      exit 1
    fi
    sleep 0.1
  done

  x11vnc -display "$DISPLAY" -rfbauth "$password_file" -forever -shared -localhost -quiet &
  websockify --web=/usr/share/novnc/ 6080 localhost:5900 &
  echo '{"level":"info","component":"browser-console","event":"browser_console_ready","port":6080}'
fi

exec "$@"

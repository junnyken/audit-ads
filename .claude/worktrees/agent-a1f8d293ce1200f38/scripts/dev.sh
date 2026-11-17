#!/usr/bin/env bash
# Local development servers that stay up.
#
# Why this exists. The dev servers died repeatedly during A10.1–A10.3, and every time it cost
# real diagnosis time because a dead frontend looks exactly like a broken feature: the page is
# still in the browser, it just cannot reach `/api` any more, so every panel shows "Failed to
# fetch". Two causes, both structural rather than bad luck:
#
#   1. Started in the foreground of an interactive terminal. The server then belongs to that
#      terminal — reuse the tab, close the window, or hit Ctrl+C by reflex, and it is gone.
#   2. Stopped with `pkill -f vite` / `pkill -f uvicorn`. A `-f` pattern matches *any* command
#      line containing it, including the shell that is running the pkill itself and any wrapper
#      around it, so the kill takes out more than the target. That is exactly how a backend
#      restart was killed mid-flight in this project (exit 144).
#
# So: every server runs under `setsid`, in its own session with no controlling terminal, wrapped
# in a keeper loop that restarts it if it exits. Stopping goes through this script, which kills a
# recorded process group — never a fuzzy pattern.
#
#   scripts/dev.sh start     # start whatever is not already running
#   scripts/dev.sh status    # what is up, on which port, and does it answer
#   scripts/dev.sh stop      # stop both, by process group
#   scripts/dev.sh restart
#   scripts/dev.sh logs [backend|frontend]
#
# It is idempotent: `start` on an already-running server leaves it alone rather than starting a
# second one on a port that is already taken.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.dev"
mkdir -p "$RUN_DIR"

BACKEND_PORT=8001
FRONTEND_PORT=5173

cmd_for() {
  case "$1" in
    backend)  echo "cd '$ROOT/backend' && exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $BACKEND_PORT --reload" ;;
    # VITE_API_BASE_URL is forced empty so the app calls `/api/...` relatively and goes through
    # the dev proxy. A real environment variable beats `.env.local`, so a stale value in that
    # file — it once pointed at a dead port 8009 — can no longer send every request off to
    # nowhere while the backend sits there healthy. Redirect the proxy with VITE_DEV_API_TARGET.
    frontend) echo "cd '$ROOT/frontend' && export VITE_API_BASE_URL= && exec npx vite --host 0.0.0.0 --port $FRONTEND_PORT" ;;
    *) return 1 ;;
  esac
}

port_of() { [ "$1" = backend ] && echo "$BACKEND_PORT" || echo "$FRONTEND_PORT"; }
pidfile() { echo "$RUN_DIR/$1.pid"; }
logfile() { echo "$RUN_DIR/$1.log"; }

# Is the port actually answering? The only question that matters to the browser — a live process
# with a dead listener is still a broken frontend.
port_answers() {
  # A 401 or 404 is an answer: the server is up and routing. Only a connection failure — which
  # curl reports as status 000 — means down. Checking for 200 would call a healthy API dead.
  local port code
  port="$(port_of "$1")"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$port/" 2>/dev/null)"
  [ -n "$code" ] && [ "$code" != "000" ]
}

keeper_pid() {
  local f; f="$(pidfile "$1")"
  [ -f "$f" ] || return 1
  local pid; pid="$(cat "$f" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo "$pid"
}

start_one() {
  local name="$1"
  if keeper_pid "$name" >/dev/null; then
    echo "$name: already running (pid $(keeper_pid "$name"))"
    return 0
  fi
  if port_answers "$name"; then
    # Something else holds the port — started by hand, or from an older session. Refuse rather
    # than start a second server that will fail to bind and then be restarted forever.
    echo "$name: port $(port_of "$name") is already answering, and it is not ours. Not starting."
    echo "        Stop it first, or use 'scripts/dev.sh stop' if this script started it earlier."
    return 1
  fi

  # setsid: own session, no controlling terminal, so closing a terminal cannot take it down.
  # The keeper loop restarts the server if it exits for any reason, with a short pause so a
  # server that cannot bind does not spin.
  local log; log="$(logfile "$name")"
  setsid bash -c "
    while :; do
      ( $(cmd_for "$name") ) >> '$log' 2>&1
      echo \"[dev.sh] $name exited (status \$?) at \$(date '+%H:%M:%S'), restarting in 2s\" >> '$log'
      sleep 2
    done
  " >/dev/null 2>&1 &
  local pid=$!
  echo "$pid" > "$(pidfile "$name")"
  echo "$name: started (keeper pid $pid, port $(port_of "$name"))"
}

wait_for() {
  local name="$1" tries=40
  while [ "$tries" -gt 0 ]; do
    port_answers "$name" && { echo "$name: answering on port $(port_of "$name")"; return 0; }
    tries=$((tries - 1))
    sleep 0.5
  done
  echo "$name: did NOT come up within 20s — see $(logfile "$name")"
  return 1
}

stop_one() {
  local name="$1" pid
  pid="$(keeper_pid "$name")" || { echo "$name: not running"; rm -f "$(pidfile "$name")"; return 0; }
  # Negative pid = the whole process group. setsid made the keeper its leader, so this reaches
  # the server and anything it spawned (npm exec -> sh -> node), and nothing outside it.
  kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  for _ in $(seq 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
  kill -KILL -"$pid" 2>/dev/null || true
  rm -f "$(pidfile "$name")"
  echo "$name: stopped"
}

status_one() {
  local name="$1" pid answering
  pid="$(keeper_pid "$name")" || pid="-"
  port_answers "$name" && answering="yes" || answering="NO"
  printf '  %-9s keeper=%-8s port=%-5s answering=%s\n' "$name" "$pid" "$(port_of "$name")" "$answering"
}

case "${1:-status}" in
  start)
    start_one backend; start_one frontend
    wait_for backend; wait_for frontend
    ;;
  stop)
    stop_one frontend; stop_one backend
    ;;
  restart)
    stop_one frontend; stop_one backend
    start_one backend; start_one frontend
    wait_for backend; wait_for frontend
    ;;
  status)
    echo "dev servers:"
    status_one backend; status_one frontend
    ;;
  logs)
    tail -n 40 -f "$(logfile "${2:-frontend}")"
    ;;
  *)
    echo "usage: scripts/dev.sh {start|stop|restart|status|logs [backend|frontend]}" >&2
    exit 2
    ;;
esac

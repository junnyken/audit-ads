#!/bin/sh
# Container start command for the API image.
#
# The dispatcher is a separate container wherever the platform allows one
# (`docker-compose.production.yml`). Vibe Host does not: a project cannot override the image's
# start command, and a second project cannot read the stack's database secrets. So on that
# platform, and only when RUN_DISPATCHER_IN_API is exactly "true", the dispatcher runs beside
# uvicorn in this container. It is the same bounded loop with the same settings; nothing about
# what it does changes, only where it runs. Leaving the variable unset keeps one process, as before.
#
# The dispatcher is restarted after 30 seconds if it exits, so a crash does not silently end
# scheduling. A crash loop still shows up as a stale dispatcher on System Status (rule 28).
# uvicorn is exec'd so it stays PID 1 and receives the platform's stop signal.
set -eu

if [ "${RUN_DISPATCHER_IN_API:-}" = "true" ]; then
  (
    while true; do
      python -m app.commands.run_dispatcher || echo "dispatcher exited with $?; restarting in 30s" >&2
      sleep 30
    done
  ) &
fi

# See the Dockerfile for why there is one worker and no --proxy-headers.
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --no-server-header

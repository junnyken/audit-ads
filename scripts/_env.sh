# Shared env-file reader.
#
# Deliberately does NOT `source` the file. Two reasons:
#   * an unquoted value with a space (BOOTSTRAP_WORKSPACE_NAME=AdsOps Staging) makes `source`
#     try to run a command — this actually broke the backup script the first time it met a
#     realistic env file;
#   * an env file holds secrets and should be read, not executed.

read_env_var() {
  local key="$1" file="$2" line value
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" 2>/dev/null | tail -1)" || true
  [[ -n "$line" ]] || return 1
  value="${line#*=}"
  # Strip one layer of surrounding quotes, if present.
  if [[ "$value" == \"*\" ]]; then value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

require_env_file() {
  [[ -f "$1" ]] || { echo "env file not found: $1" >&2; exit 1; }
  # A file holding production secrets should not be world-readable.
  local mode
  mode="$(stat -c '%a' "$1" 2>/dev/null || echo '')"
  if [[ -n "$mode" && "${mode: -1}" != "0" ]]; then
    echo "warning: $1 is readable by others (mode $mode); chmod 600 it" >&2
  fi
}

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/spotifeel-backend"
FRONTEND_DIR="$ROOT_DIR/spotifeel-frontend"
VENV_DIR="$ROOT_DIR/.venv"
DEPS_STAMP_FILE="$VENV_DIR/.spotifeel_deps_stamp"

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  local exit_code=${1:-0}
  trap - EXIT INT TERM

  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    pkill -P "$BACKEND_PID" 2>/dev/null || true
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    pkill -P "$FRONTEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi

  wait 2>/dev/null || true
  exit "$exit_code"
}

trap 'cleanup 0' INT TERM
trap 'cleanup $?' EXIT

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

pick_python_cmd() {
  local candidate
  for candidate in python3.13 python3.12 python3.11; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

python_minor_version() {
  "$1" -c 'import sys; print(sys.version_info.minor)'
}

requirements_stamp() {
  {
    cat "$ROOT_DIR/requirements.txt"
    echo "python-dotenv"
    echo "greenlet"
  } | shasum -a 256 | awk '{print $1}'
}

ensure_python_deps() {
  local wanted_stamp installed_stamp
  wanted_stamp="$(requirements_stamp)"
  installed_stamp=""
  if [[ -f "$DEPS_STAMP_FILE" ]]; then
    installed_stamp="$(cat "$DEPS_STAMP_FILE")"
  fi

  if [[ "$installed_stamp" == "$wanted_stamp" ]]; then
    echo "Python deps already installed in .venv. Skipping pip install."
    return
  fi

  echo "Installing Python dependencies into .venv (first run may take several minutes)..."
  python -m pip install --disable-pip-version-check -r "$ROOT_DIR/requirements.txt"
  python -m pip install --disable-pip-version-check python-dotenv
  python -m pip install --disable-pip-version-check greenlet
  echo "$wanted_stamp" > "$DEPS_STAMP_FILE"
}

frontend_rollup_native_ok() {
  (
    cd "$FRONTEND_DIR"
    node -e 'const mod = `@rollup/rollup-${process.platform}-${process.arch}`; try { require(mod); process.exit(0); } catch (_) { process.exit(1); }'
  )
}

frontend_vite_ok() {
  (
    cd "$FRONTEND_DIR"
    node -e 'try { require.resolve("vite/package.json"); process.exit(0); } catch (_) { process.exit(1); }'
  )
}

frontend_deps_ok() {
  frontend_rollup_native_ok && frontend_vite_ok
}

ensure_frontend_deps() {
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    echo "node_modules missing. Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm install --include=dev --include=optional)
    return
  fi

  if frontend_deps_ok; then
    echo "Frontend dependencies look healthy."
    return
  fi

  echo "Frontend dependencies are incomplete. Repairing..."
  (
    cd "$FRONTEND_DIR"
    npm install --include=dev --include=optional
  )

  if frontend_deps_ok; then
    echo "Frontend dependency repair succeeded."
    return
  fi

  echo "Optional dependency repair did not fix it. Rebuilding node_modules..."
  (
    cd "$FRONTEND_DIR"
    rm -rf node_modules
    npm install --include=dev --include=optional
  )
}

echo "Checking required tools..."
need_cmd python3
need_cmd npm
need_cmd docker

if ! PYTHON_CMD="$(pick_python_cmd)"; then
  echo "No compatible Python found. Install Python 3.13 (or 3.12/3.11) and rerun."
  echo "Current default python3 is: $(python3 --version 2>/dev/null || echo 'not found')"
  exit 1
fi

echo "Using $PYTHON_CMD ($($PYTHON_CMD --version))."

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop and rerun ./dev-up.sh"
  exit 1
fi

echo "Ensuring Python virtualenv and dependencies..."
if [[ -x "$VENV_DIR/bin/python" ]]; then
  venv_minor="$(python_minor_version "$VENV_DIR/bin/python")"
  if [[ "$venv_minor" -ge 14 ]]; then
    echo "Existing .venv uses Python 3.$venv_minor, which is incompatible with pinned deps."
    echo "Recreating .venv with $PYTHON_CMD ..."
    rm -rf "$VENV_DIR"
  fi
fi

if [[ ! -d "$VENV_DIR" ]]; then
  echo "Creating virtualenv at $VENV_DIR ..."
  "$PYTHON_CMD" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
echo "Active venv python: $(python --version)"
ensure_python_deps

echo "Ensuring frontend dependencies..."
ensure_frontend_deps

echo "Starting Postgres..."
(cd "$BACKEND_DIR" && docker compose up -d)

track_count="0"
query_output=""
set +e
query_output=$(cd "$BACKEND_DIR" && docker compose exec -T postgres psql -U spotifeel -d spotifeel -tAc "SELECT COUNT(*) FROM track_features;" 2>/dev/null)
query_status=$?
set -e
if [[ $query_status -eq 0 ]]; then
  track_count=$(echo "$query_output" | tr -d '[:space:]')
  if [[ -z "$track_count" ]]; then
    track_count="0"
  fi
fi

if [[ "$track_count" == "0" ]]; then
  load_max_rows="${LOAD_MAX_ROWS:-100000}"
  echo "track_features is empty or missing. Loading dataset with LOAD_MAX_ROWS=${load_max_rows} ..."
  (cd "$BACKEND_DIR" && LOAD_MAX_ROWS="$load_max_rows" python scripts/load_ozefe_dataset.py)
else
  echo "track_features already populated (${track_count} rows). Skipping dataset load."
fi

echo "Starting backend on http://localhost:8000 ..."
(
  cd "$BACKEND_DIR"
  source "$VENV_DIR/bin/activate"
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) &
BACKEND_PID=$!

echo "Starting frontend on http://localhost:5173 ..."
(
  cd "$FRONTEND_DIR"
  npm run dev -- --host 0.0.0.0 --port 5173
) &
FRONTEND_PID=$!

echo "Spotifeel is running. Press Ctrl+C to stop backend/frontend."

while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend process exited."
    break
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "Frontend process exited."
    break
  fi
  sleep 1
done

cleanup 1

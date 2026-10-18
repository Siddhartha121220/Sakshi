#!/usr/bin/env bash
# One-command local demo: Anvil chain -> contract deploy -> embedded dev DB -> API + anchor worker ->
# web verifier -> (optionally) the USB-attached phone. Ctrl+C stops everything it started.
#
#   scripts/demo.sh                    full run, including resetting the phone's app
#   scripts/demo.sh --no-phone         laptop side only (no adb calls at all)
#   scripts/demo.sh --keep-phone-data  forward the port but don't clear/reinstall the app
#
# Why the phone is reset by default: the dev DB is in-memory, so every run starts with an empty
# server. A phone still holding the previous run's device registration would get UNKNOWN_DEVICE on
# its first upload. Resetting the app also wipes its private captures (gallery copies are unaffected).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="${TMPDIR:-/tmp}/sakshi-demo"
APK="$ROOT/apps/android/app/build/outputs/apk/debug/app-debug.apk"
API_ENV="$ROOT/apps/api/.env"
WEB_ENV="$ROOT/apps/web/.env.local"
RPC=http://127.0.0.1:8545

# Anvil's well-known public dev accounts #0 (deployer), #1 (anchorer, matches apps/api/.env), #0 again
# as revoker. Public test keys, worthless outside a local Anvil.
export DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export ANCHORER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
export REVOKER_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

PHONE=reset
for arg in "$@"; do
  case "$arg" in
    --no-phone) PHONE=skip ;;
    --keep-phone-data) PHONE=keep ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  echo; echo "Stopping..."
  # Each service runs in its own process group (setsid), so kill the group, not just the wrapper
  # (pnpm and tsx both spawn children that would otherwise outlive it).
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill -TERM -- "-$pid" 2>/dev/null || true; done
  [ "$PHONE" != skip ] && adb reverse --remove tcp:3000 >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

die() { echo "ERROR: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }
port_busy() { ss -tln 2>/dev/null | grep -q ":$1 "; }

# start <name> <logfile> <cwd> <command...>  — runs in its own process group, records the pgid
start() {
  local name=$1 log=$2 cwd=$3; shift 3
  (cd "$cwd" && exec setsid "$@" >"$log" 2>&1) &
  PIDS+=("$!")
  echo "    started $name (pid $!, log: $log)"
}

wait_for() { # <what> <seconds> <command...>
  local what=$1 secs=$2; shift 2
  for _ in $(seq 1 $((secs * 2))); do "$@" >/dev/null 2>&1 && return 0; sleep 0.5; done
  die "$what did not come up within ${secs}s — see logs in $LOGS"
}

step "Preflight"
for bin in anvil forge cast pnpm curl setsid; do command -v "$bin" >/dev/null || die "missing required tool: $bin"; done
[ -f "$API_ENV" ] || die "$API_ENV missing — copy apps/api/.env.example and fill it in"
[ -f "$WEB_ENV" ] || die "$WEB_ENV missing — copy apps/web/.env.example and fill it in"
for p in 8545 3000 5173; do
  port_busy "$p" && die "port $p is already in use — stop whatever is on it first (ss -tlnp | grep :$p)"
done
mkdir -p "$LOGS"

step "1/5  Local chain (Anvil)"
# --block-time: stock Anvil only mines when a transaction arrives, so a lone photo's batch would sit at
# "confirmed" forever — the worker's local finality rule needs one more block on top of it. A real
# chain mines continuously; this makes the demo behave like one.
start anvil "$LOGS/anvil.log" "$ROOT" anvil --block-time 2
rpc_up() { curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' "$RPC"; }
wait_for "Anvil" 20 rpc_up

step "2/5  Deploy SakshiAnchor"
DEPLOY_OUT="$(cd "$ROOT/packages/contracts" && forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast 2>&1)" \
  || { echo "$DEPLOY_OUT" | tail -20; die "contract deployment failed"; }
CONTRACT="$(echo "$DEPLOY_OUT" | grep "SakshiAnchor deployed at" | grep -oE '0x[0-9a-fA-F]{40}' | head -1)"
[ -n "$CONTRACT" ] || { echo "$DEPLOY_OUT" | tail -20; die "could not read the deployed address from forge output"; }
[ "$(cast code "$CONTRACT" --rpc-url "$RPC")" != "0x" ] || die "no contract code at $CONTRACT after deploy"
echo "    deployed at $CONTRACT"
sed -i "s|^SAKSHI_ANCHOR_CONTRACT=.*|SAKSHI_ANCHOR_CONTRACT=$CONTRACT|" "$API_ENV"
sed -i "s|^VITE_SAKSHI_ANCHOR_CONTRACT=.*|VITE_SAKSHI_ANCHOR_CONTRACT=$CONTRACT|" "$WEB_ENV"

step "3/5  Dev database (embedded, in-memory)"
start db "$LOGS/db.log" "$ROOT/apps/api" ./node_modules/.bin/tsx scripts/dev-db.ts
db_url_ready() { grep -q '^DATABASE_URL=' "$LOGS/db.log"; }
wait_for "dev database" 60 db_url_ready
DB_URL="$(grep '^DATABASE_URL=' "$LOGS/db.log" | head -1 | cut -d= -f2-)"
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DB_URL|" "$API_ENV"
echo "    $DB_URL"

step "4/5  API + anchor worker (one process — the embedded DB serves one connection)"
start api "$LOGS/api.log" "$ROOT/apps/api" bash -c 'set -a; . ./.env; set +a; exec ./node_modules/.bin/tsx scripts/dev-server.ts'
api_up() { curl -s -o /dev/null "http://127.0.0.1:3000/v1/captures/by-hash/$(printf '0%.0s' $(seq 64))"; }
wait_for "API" 40 api_up

step "5/5  Web verifier"
start web "$LOGS/web.log" "$ROOT" pnpm --filter web dev
web_up() { curl -sf -o /dev/null http://localhost:5173/; }
wait_for "web verifier" 40 web_up

if [ "$PHONE" != skip ]; then
  step "Phone"
  if ! command -v adb >/dev/null; then
    echo "    adb not found — skipping the phone (laptop side is up)"
  elif ! adb get-state >/dev/null 2>&1; then
    echo "    no phone attached over USB (or USB debugging is off) — skipping. Plug it in and re-run,"
    echo "    or do it by hand:  adb reverse tcp:3000 tcp:3000"
  else
    adb reverse tcp:3000 tcp:3000 >/dev/null
    echo "    adb reverse tcp:3000 -> laptop:3000 (phone reaches the API over the cable, no shared Wi-Fi needed)"
    if [ "$PHONE" = reset ]; then
      # Uninstall rather than `pm clear`: ColorOS/OxygenOS phones reject `pm clear` from adb with a
      # SecurityException (CLEAR_APP_USER_DATA) unless a Developer Options toggle is on, and the old
      # script swallowed that error, leaving the stale registration in place -> HTTP 401 on every
      # upload. `adb uninstall` needs no such permission and also drops the old Keystore key.
      if adb uninstall app.sakshi >/dev/null 2>&1; then
        echo "    removed the previous install (wipes its stale registration; gallery copies are untouched)"
      else
        echo "    no previous install to remove"
      fi
      if [ -f "$APK" ]; then
        adb install "$APK" >/dev/null || die "could not install $APK"
        echo "    installed $(basename "$APK")"
      else
        echo "    no APK at $APK — build it: (cd apps/android && ./gradlew :app:assembleDebug)"
      fi
    fi
  fi
fi

cat <<EOF

────────────────────────────────────────────────────────────
  Sakshi demo is up

  Verifier   http://localhost:5173
  API        http://localhost:3000
  Chain      $RPC   (contract $CONTRACT)
  Logs       $LOGS/{anvil,db,api,web}.log

  1. Open the app on the phone, wait for registration, take a photo.
  2. Watch it go Signed -> Uploaded -> Anchored -> Finalized (~15s per step).
  3. Get the photo to the laptop and drop it on the verifier.

  Ctrl+C stops everything.
────────────────────────────────────────────────────────────
EOF

wait

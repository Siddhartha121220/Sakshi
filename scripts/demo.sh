#!/usr/bin/env bash
# One-command local stack: Anvil chain -> contract (deployed once) -> embedded dev DB -> API + anchor
# worker -> web verifier -> the USB-attached phone. Ctrl+C stops everything it started.
#
#   scripts/demo.sh             start (or resume) the local stack; updates the app on the phone in place
#   scripts/demo.sh --reset     wipe the local chain and DB first, for a clean slate
#   scripts/demo.sh --no-phone  laptop side only (no adb calls at all)
#   scripts/demo.sh --phone SERIAL   which phone, when more than one is connected (`adb devices` lists them)
#
# Phone connection, any of:
#   USB cable               plug in with USB debugging on; nothing else to do
#   Wi-Fi via adb           pair once: phone Settings > Developer options > Wireless debugging > Pair with
#                           code, then `adb pair IP:PAIRPORT` and `adb connect IP:PORT`. adb reverse works
#                           over that link exactly as over USB. Phone and laptop must share a network.
#   Wi-Fi without adb       in the app: Settings > Server > http://<laptop Wi-Fi IP>:3000 (printed at the end)
#
# State persists between runs: the chain in .devchain/, the DB in apps/api/.devdb/. So the phone stays
# registered, and photos anchored yesterday still verify today. After --reset the app notices the
# server has forgotten it and re-registers by itself (captures signed before that are marked failed;
# the photos stay in the gallery) — no reinstall needed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="${TMPDIR:-/tmp}/sakshi-demo"
APK="$ROOT/apps/android/app/build/outputs/apk/debug/app-debug.apk"
API_ENV="$ROOT/apps/api/.env"
WEB_ENV="$ROOT/apps/web/.env.local"
RPC=http://127.0.0.1:8545
CHAIN_DIR="$ROOT/.devchain"
CHAIN_STATE="$CHAIN_DIR/state.json"
DB_DIR="$ROOT/apps/api/.devdb"

# Anvil's well-known public dev accounts #0 (deployer), #1 (anchorer, matches apps/api/.env), #0 again
# as revoker. Public test keys, worthless outside a local Anvil.
export DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export ANCHORER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
export REVOKER_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

PHONE=update
RESET=no
PHONE_NEXT=no
for arg in "$@"; do
  if [ "$PHONE_NEXT" = yes ]; then export ANDROID_SERIAL="$arg"; PHONE_NEXT=no; continue; fi
  case "$arg" in
    --no-phone) PHONE=skip ;;
    --reset) RESET=yes ;;
    --phone) PHONE_NEXT=yes ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
[ "$PHONE_NEXT" = yes ] && { echo "--phone needs a serial (see adb devices)" >&2; exit 2; }

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

if [ "$RESET" = yes ]; then
  rm -rf "$CHAIN_DIR" "$DB_DIR"
  echo "    reset: wiped the local chain and database"
fi
# The DB's batches point at roots on the chain. A DB without its chain means every stored proof would
# fail verification as INVALID, so refuse rather than start in that silently-broken state.
if [ -d "$DB_DIR" ] && [ ! -f "$CHAIN_STATE" ]; then
  die "the dev DB exists but the chain state ($CHAIN_STATE) is gone — their data no longer matches. Run with --reset."
fi
mkdir -p "$CHAIN_DIR"

step "1/5  Local chain (Anvil)"
# --block-time: stock Anvil only mines when a transaction arrives, so a lone photo's batch would sit at
# "confirmed" forever — the worker's local finality rule needs one more block on top of it. A real
# chain mines continuously; this makes the demo behave like one.
# --state: load the chain from disk and save it back (every second, and on exit), block hashes included,
# so beacons and anchors from earlier runs still check out.
# --slots-in-an-epoch 1: Anvil reports "finalized" as two epochs (default 2x32 = 64 blocks) behind the
# head. A fresh chain is shorter than that, so it reads as genesis and the worker falls back to its own
# rule; a persisted chain is longer, so photos really did wait ~64 blocks (2+ minutes) to finalize.
# One-slot epochs make finalized trail by ~2 blocks, close to the fresh-chain behaviour.
start anvil "$LOGS/anvil.log" "$ROOT" anvil --block-time 2 --slots-in-an-epoch 1 --state "$CHAIN_STATE" --state-interval 1
rpc_up() { curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' "$RPC"; }
wait_for "Anvil" 20 rpc_up
# A reloaded chain resumes from its last saved block timestamp, so every restart would leave the chain
# clock behind real time by however long it was stopped — and the verifier's "proven taken between"
# window would be wrong by that much. Jump the next block to now (time only ever moves forward).
HEAD_TS="$(cast block latest --field timestamp --rpc-url "$RPC")"
if [ "$HEAD_TS" -lt "$(date +%s)" ]; then
  cast rpc evm_setNextBlockTimestamp "$(date +%s)" --rpc-url "$RPC" >/dev/null
  echo "    chain clock caught up with real time (it was $(( $(date +%s) - HEAD_TS ))s behind after reloading)"
fi

step "2/5  SakshiAnchor contract"
CONTRACT="$(grep -oE '^SAKSHI_ANCHOR_CONTRACT=0x[0-9a-fA-F]{40}' "$API_ENV" | cut -d= -f2 || true)"
CODE="$( [ -n "$CONTRACT" ] && cast code "$CONTRACT" --rpc-url "$RPC" 2>/dev/null || true)"
if [ -n "$CODE" ] && [ "$CODE" != "0x" ]; then
  echo "    already deployed at $CONTRACT ($(cast call "$CONTRACT" 'batchCount()(uint256)' --rpc-url "$RPC") batches so far)"
else
DEPLOY_OUT="$(cd "$ROOT/packages/contracts" && forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast 2>&1)" \
  || { echo "$DEPLOY_OUT" | tail -20; die "contract deployment failed"; }
CONTRACT="$(echo "$DEPLOY_OUT" | grep "SakshiAnchor deployed at" | grep -oE '0x[0-9a-fA-F]{40}' | head -1)"
[ -n "$CONTRACT" ] || { echo "$DEPLOY_OUT" | tail -20; die "could not read the deployed address from forge output"; }
[ "$(cast code "$CONTRACT" --rpc-url "$RPC")" != "0x" ] || die "no contract code at $CONTRACT after deploy"
echo "    deployed at $CONTRACT"
fi
sed -i "s|^SAKSHI_ANCHOR_CONTRACT=.*|SAKSHI_ANCHOR_CONTRACT=$CONTRACT|" "$API_ENV"
sed -i "s|^VITE_SAKSHI_ANCHOR_CONTRACT=.*|VITE_SAKSHI_ANCHOR_CONTRACT=$CONTRACT|" "$WEB_ENV"

step "3/5  Dev database (embedded, persisted in apps/api/.devdb)"
start db "$LOGS/db.log" "$ROOT/apps/api" ./node_modules/.bin/tsx scripts/dev-db.ts
db_url_ready() { grep -q '^DATABASE_URL=' "$LOGS/db.log"; }
wait_for "dev database" 60 db_url_ready
DB_URL="$(grep '^DATABASE_URL=' "$LOGS/db.log" | head -1 | cut -d= -f2-)"
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DB_URL|" "$API_ENV"
echo "    $DB_URL"

step "4/5  API + anchor worker (one process — the embedded DB serves one connection)"
start api "$LOGS/api.log" "$ROOT/apps/api" bash -c 'set -a; . ./.env; set +a; exec ./node_modules/.bin/tsx src/serve-all.ts'
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
  elif [ -z "${ANDROID_SERIAL:-}" ] && [ "$(adb devices | awk 'NR>1 && $2=="device"' | wc -l)" -gt 1 ]; then
    echo "    more than one phone/connection attached (e.g. USB and Wi-Fi) — pick one with --phone:"
    adb devices | awk 'NR>1 && $2=="device" {print "      " $1}'
  elif ! adb get-state >/dev/null 2>&1; then
    echo "    no phone reachable over adb (USB debugging off, or not paired over Wi-Fi) — skipping."
    echo "    Connect it and re-run, or use Wi-Fi without adb (see the address below)."
  else
    adb reverse tcp:3000 tcp:3000 >/dev/null
    echo "    adb reverse tcp:3000 -> laptop:3000 on $(adb get-serialno) (the app's 127.0.0.1:3000 now reaches this laptop)"
    if [ -f "$APK" ]; then
      # -r updates in place: the app keeps its registration, key and captures.
      if adb install -r "$APK" >/dev/null 2>&1; then
        echo "    updated the app in place (registration and captures kept)"
      else
        # Happens only if the installed copy was signed with a different debug key (another machine).
        echo "    in-place update refused (different signing key) — reinstalling; the app will re-register"
        adb uninstall app.sakshi >/dev/null 2>&1 || true
        adb install "$APK" >/dev/null || die "could not install $APK"
      fi
    else
      echo "    no APK at $APK — build it: (cd apps/android && ./gradlew :app:assembleDebug)"
    fi
  fi
fi

LAN_IPS="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|br-|veth|virbr)/ {sub(/\/.*/, "", $4); print $4}' | paste -sd' ')"
cat <<EOF

────────────────────────────────────────────────────────────
  Sakshi demo is up

  Verifier   http://localhost:5173
  API        http://localhost:3000
  Chain      $RPC   (contract $CONTRACT)
  Logs       $LOGS/{anvil,db,api,web}.log
  Wi-Fi      phone without adb: app Settings > Server > http://<one of: ${LAN_IPS:-no LAN address found}>:3000

  1. Open the app on the phone, wait for registration, take a photo.
  2. Watch it go Signed -> Uploaded -> Anchored -> Finalized (~15s per step).
  3. Get the photo to the laptop and drop it on the verifier.

  Ctrl+C stops everything.
────────────────────────────────────────────────────────────
EOF

wait

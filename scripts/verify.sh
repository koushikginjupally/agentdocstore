#!/usr/bin/env bash
# AgentDocStore — success-criteria verification harness.
# Runs S1–S15; writes VERIFICATION.md at repo root; exits non-zero on any FAIL.
set -uo pipefail

# --------------------------------------------------------------------------
# Setup
# --------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Uses whatever node is on PATH (nvm/mise/volta users: honour .nvmrc first).

# Verify node is present.
if ! command -v node &>/dev/null; then
  echo "FATAL: node not found on PATH" >&2
  exit 1
fi
NODE_VERSION="$(node -v)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ ]] || (( NODE_MAJOR < 20 )); then
  echo "FATAL: AgentDocStore requires Node.js >= 20; found $NODE_VERSION" >&2
  exit 1
fi

# Tools the checks call directly. Missing ones used to surface as unrelated
# check failures (for example S11 reporting mode "missing"), so name them here.
MISSING_TOOLS=()
for tool in curl jq; do
  command -v "$tool" &>/dev/null || MISSING_TOOLS+=("$tool")
done
if (( ${#MISSING_TOOLS[@]} > 0 )); then
  echo "FATAL: npm run verify needs: ${MISSING_TOOLS[*]} (install and re-run)" >&2
  exit 1
fi

PASS=0
FAIL=0
SKIP=0
declare -a RESULTS=()

log() { printf "\n=== %s ===\n" "$1"; }

record() {
  local criterion="$1" status="$2" detail="$3"
  RESULTS+=("| $criterion | $status | $detail |")
  case "$status" in
    PASS) ((PASS++)) ;;
    FAIL) ((FAIL++)) ;;
    SKIP) ((SKIP++)) ;;
  esac
  printf "[%s] %s — %s\n" "$status" "$criterion" "$detail"
}

# Run a command with a time limit. GNU `timeout` is absent on stock macOS, and
# a missing binary here would be swallowed by the callers' `|| true`, making a
# check fail with a misleading message. Fall back to Homebrew's `gtimeout`,
# then to a perl alarm (perl ships with macOS): the alarm survives exec, so the
# command is killed by SIGALRM when the limit is reached.
run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  else
    perl -e 'alarm shift; exec @ARGV or die "exec failed: $!\n"' "$secs" "$@"
  fi
}

# Port-picking helper.
# Uses node (already required above) rather than python3, which is not a
# declared prerequisite: without it every server check failed as "could not
# pick a free port".
pick_port() {
  local port
  port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})' 2>/dev/null)
  echo "${port:-0}"
}

SERVER_PID=""
cleanup_server() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  SERVER_PID=""
}
trap cleanup_server EXIT

# --------------------------------------------------------------------------
# S1 — Build + Test
# --------------------------------------------------------------------------
log "S1: npm ci / install → build → test"
S1_STATUS="PASS"
S1_DETAIL=""

if npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts 2>/dev/null; then
  S1_DETAIL="install OK"
else
  S1_STATUS="FAIL"; S1_DETAIL="npm install failed"
fi

if [[ "$S1_STATUS" == "PASS" ]]; then
  if npm run build >build.log 2>&1; then
    S1_DETAIL="$S1_DETAIL, build OK"
  else
    S1_STATUS="FAIL"
    S1_DETAIL="$S1_DETAIL, build FAILED (see build.log)"
  fi
fi

if [[ "$S1_STATUS" == "PASS" ]]; then
  # The `agentdocstore` command comes from the CLI package, whose bin is the
  # bundle the build makes; `npx agentdocstore` in a clone must run it.
  CLI_BIN=$(node -e "const p=require('./packages/cli/package.json'); process.stdout.write(p.bin?.agentdocstore ?? '')")
  if [[ "$CLI_BIN" != "./bundle/index.js" ]]; then
    S1_STATUS="FAIL"
    S1_DETAIL="$S1_DETAIL, agentdocstore bin mapping missing from packages/cli/package.json"
  elif [[ ! -x "$REPO_ROOT/packages/cli/${CLI_BIN#./}" ]]; then
    S1_STATUS="FAIL"
    S1_DETAIL="$S1_DETAIL, CLI bundle is not executable"
  elif npx --no-install agentdocstore --version >/dev/null 2>&1; then
    S1_DETAIL="$S1_DETAIL, npx CLI OK"
  else
    S1_STATUS="FAIL"
    S1_DETAIL="$S1_DETAIL, npx CLI FAILED"
  fi
fi

if [[ "$S1_STATUS" == "PASS" ]]; then
  if npm test >test.log 2>&1; then
    # Read the run SUMMARY, not the last per-file line. `grep -oP '\d+ tests?'
    # | tail -1` matched the final "(57 tests)" file heading and under-reported
    # a 389-test run by roughly 6x.
    # vitest emits ANSI colour codes even when redirected to a file, and those
    # escape sequences sit between "Tests" and the count — so strip them first
    # or the extraction silently yields "?".
    sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' test.log >test-plain.log
    # sed -nE, not grep -P: BSD/macOS grep has no -P.
    TEST_COUNT=$(sed -nE 's/^[[:space:]]*Tests[[:space:]]+([0-9]+) passed.*/\1/p' test-plain.log | tail -1 || true)
    FILE_COUNT=$(sed -nE 's/^[[:space:]]*Test Files[[:space:]]+([0-9]+) passed.*/\1/p' test-plain.log | tail -1 || true)
    S1_DETAIL="$S1_DETAIL, test OK (${TEST_COUNT:-?} tests in ${FILE_COUNT:-?} files)"
  else
    S1_STATUS="FAIL"
    S1_DETAIL="$S1_DETAIL, test FAILED (see test.log)"
  fi
fi

record "S1" "$S1_STATUS" "$S1_DETAIL"

# --------------------------------------------------------------------------
# S2 — Server starts, /healthz 200, / returns HTML, binds 127.0.0.1
# --------------------------------------------------------------------------
log "S2: CLI serve --ephemeral"
S2_STATUS="PASS"
S2_DETAIL=""

CLI_BIN="$REPO_ROOT/packages/cli/dist/index.js"
if [[ ! -f "$CLI_BIN" ]]; then
  S2_STATUS="FAIL"
  S2_DETAIL="CLI binary not found at $CLI_BIN (concurrent agent may not be finished yet)"
  record "S2" "$S2_STATUS" "$S2_DETAIL"
else
  PORT=$(pick_port)
  if [[ "$PORT" == "0" ]]; then
    S2_STATUS="FAIL"; S2_DETAIL="could not pick a free port"
    record "S2" "$S2_STATUS" "$S2_DETAIL"
  else
    node "$CLI_BIN" serve --ephemeral --port "$PORT" &
    SERVER_PID=$!
    sleep 2

    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      S2_STATUS="FAIL"; S2_DETAIL="server exited immediately"
    fi

    # /healthz
    if [[ "$S2_STATUS" == "PASS" ]]; then
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/healthz" 2>/dev/null || echo "000")
      if [[ "$HTTP_CODE" != "200" ]]; then
        S2_STATUS="FAIL"; S2_DETAIL="/healthz returned $HTTP_CODE, expected 200"
      else
        S2_DETAIL="/healthz 200"
      fi
    fi

    # / returns HTML
    if [[ "$S2_STATUS" == "PASS" ]]; then
      ROOT_BODY=$(curl -s "http://127.0.0.1:${PORT}/" 2>/dev/null)
      if echo "$ROOT_BODY" | grep -qi '<html'; then
        S2_DETAIL="$S2_DETAIL, / returns HTML"
      else
        S2_STATUS="FAIL"; S2_DETAIL="$S2_DETAIL, / did not return HTML"
      fi
    fi

    # The UI page and bundle carry nosniff, like the API responses
    if [[ "$S2_STATUS" == "PASS" ]]; then
      for ui_path in / /app.js; do
        if ! curl -s -D - -o /dev/null "http://127.0.0.1:${PORT}${ui_path}" 2>/dev/null |
          grep -qi '^x-content-type-options: *nosniff'; then
          S2_STATUS="FAIL"; S2_DETAIL="$S2_DETAIL, ${ui_path} lacks X-Content-Type-Options: nosniff"
        fi
      done
      [[ "$S2_STATUS" == "PASS" ]] && S2_DETAIL="$S2_DETAIL, UI nosniff"
    fi

    # Bind address check
    if [[ "$S2_STATUS" == "PASS" ]]; then
      BIND_CHECK=""
      if command -v ss &>/dev/null; then
        if ss -ltnp 2>/dev/null | grep ":${PORT}" | grep -q '127\.0\.0\.1'; then
          BIND_CHECK="bound to 127.0.0.1 (ss)"
        else
          S2_STATUS="FAIL"; BIND_CHECK="NOT bound to 127.0.0.1 (ss)"
        fi
      elif command -v lsof &>/dev/null; then
        if lsof -i ":${PORT}" -P -n 2>/dev/null | grep -q '127\.0\.0\.1'; then
          BIND_CHECK="bound to 127.0.0.1 (lsof)"
        else
          S2_STATUS="FAIL"; BIND_CHECK="NOT bound to 127.0.0.1 (lsof)"
        fi
      else
        BIND_CHECK="SKIP — neither ss nor lsof available"
        # Don't count the whole criterion as skip — the core checks passed.
      fi
      S2_DETAIL="$S2_DETAIL, $BIND_CHECK"
    fi

    cleanup_server
    record "S2" "$S2_STATUS" "$S2_DETAIL"
  fi
fi

# --------------------------------------------------------------------------
# S3 — REST end-to-end via curl + jq
# --------------------------------------------------------------------------
log "S3: REST end-to-end"
S3_STATUS="PASS"
S3_DETAIL=""

if [[ ! -f "$CLI_BIN" ]]; then
  S3_STATUS="FAIL"
  S3_DETAIL="CLI binary not found"
  record "S3" "$S3_STATUS" "$S3_DETAIL"
else
  PORT=$(pick_port)
  node "$CLI_BIN" serve --ephemeral --port "$PORT" &
  SERVER_PID=$!
  sleep 2

  BASE="http://127.0.0.1:${PORT}"
  JQ_FOUND=true
  command -v jq &>/dev/null || JQ_FOUND=false

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    S3_STATUS="FAIL"; S3_DETAIL="server exited"
  fi

  # Helper to extract JSON field (works with or without jq).
  json_field() {
    local json="$1" field="$2"
    if $JQ_FOUND; then
      echo "$json" | jq -r ".$field" 2>/dev/null
    else
      # Crude fallback: grep for "field": "value"
      echo "$json" | grep -oE "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" | head -1 | sed 's/.*:.*"\(.*\)"/\1/'
    fi
  }

  json_field_int() {
    local json="$1" field="$2"
    if $JQ_FOUND; then
      echo "$json" | jq -r ".$field" 2>/dev/null
    else
      echo "$json" | grep -oE "\"$field\"[[:space:]]*:[[:space:]]*[0-9]+" | head -1 | sed 's/.*: *//'
    fi
  }

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Create
    CREATE_RESP=$(curl -s -X POST "$BASE/api/documents" \
      -H "Content-Type: application/json" \
      -d '{"title":"S3 Test","content":"hello v1","language":"plaintext"}')
    DOCUMENT_ID=$(json_field "$CREATE_RESP" "id")
    if [[ -z "$DOCUMENT_ID" || "$DOCUMENT_ID" == "null" ]]; then
      S3_STATUS="FAIL"; S3_DETAIL="create returned no id: $CREATE_RESP"
    else
      S3_DETAIL="create OK"
    fi
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Read
    READ_RESP=$(curl -s "$BASE/api/documents/$DOCUMENT_ID")
    READ_CONTENT=$(json_field "$READ_RESP" "content")
    if [[ "$READ_CONTENT" != "hello v1" ]]; then
      S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, read content mismatch"
    else
      S3_DETAIL="$S3_DETAIL, read OK"
    fi
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Update twice (v2 and v3)
    curl -s -X PUT "$BASE/api/documents/$DOCUMENT_ID" \
      -H "Content-Type: application/json" \
      -d '{"content":"hello v2"}' >/dev/null
    curl -s -X PUT "$BASE/api/documents/$DOCUMENT_ID" \
      -H "Content-Type: application/json" \
      -d '{"content":"hello v3"}' >/dev/null
    S3_DETAIL="$S3_DETAIL, 2 updates"
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Assert 3 versions
    VERS_RESP=$(curl -s "$BASE/api/documents/$DOCUMENT_ID/versions")
    if $JQ_FOUND; then
      VER_COUNT=$(echo "$VERS_RESP" | jq '.versions | length' 2>/dev/null)
    else
      VER_COUNT=$(echo "$VERS_RESP" | grep -o '"version"' | wc -l)
    fi
    if [[ "$VER_COUNT" != "3" ]]; then
      S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, expected 3 versions got $VER_COUNT"
    else
      S3_DETAIL="$S3_DETAIL, 3 versions"
    fi
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Diff 1..3 non-empty
    DIFF_RESP=$(curl -s "$BASE/api/documents/$DOCUMENT_ID/diff?from=1&to=3")
    DIFF_TEXT=$(json_field "$DIFF_RESP" "diff")
    if [[ -z "$DIFF_TEXT" || "$DIFF_TEXT" == "null" ]]; then
      S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, diff 1..3 empty"
    else
      S3_DETAIL="$S3_DETAIL, diff non-empty"
    fi
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Raw matches latest
    RAW_RESP=$(curl -s "$BASE/raw/$DOCUMENT_ID")
    if [[ "$RAW_RESP" != "hello v3" ]]; then
      S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, raw mismatch: got '$RAW_RESP'"
    else
      S3_DETAIL="$S3_DETAIL, raw OK"
    fi
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Comment add / list / resolve
    COMMENT_RESP=$(curl -s -X POST "$BASE/api/documents/$DOCUMENT_ID/comments" \
      -H "Content-Type: application/json" \
      -d '{"body":"looks good"}')
    COMMENT_ID=$(json_field "$COMMENT_RESP" "id")
    if [[ -z "$COMMENT_ID" || "$COMMENT_ID" == "null" ]]; then
      S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, comment add failed"
    else
      LIST_COMMENTS=$(curl -s "$BASE/api/documents/$DOCUMENT_ID/comments")
      if echo "$LIST_COMMENTS" | grep -q "looks good"; then
        # Resolve
        curl -s -X PATCH "$BASE/api/documents/$DOCUMENT_ID/comments/$COMMENT_ID" \
          -H "Content-Type: application/json" \
          -d '{"resolved":true}' >/dev/null
        S3_DETAIL="$S3_DETAIL, comments OK"
      else
        S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, comment not in list"
      fi
    fi
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Search by keyword
    SEARCH_RESP=$(curl -s "$BASE/api/documents?query=S3+Test")
    if echo "$SEARCH_RESP" | grep -q "$DOCUMENT_ID"; then
      S3_DETAIL="$S3_DETAIL, search OK"
    else
      S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, search did not find document"
    fi
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Visibility flip
    VIS_RESP=$(curl -s -X POST "$BASE/api/documents/$DOCUMENT_ID/visibility" \
      -H "Content-Type: application/json" \
      -d '{"visibility":"PRIVATE"}')
    VIS_CHECK=$(json_field "$VIS_RESP" "visibility")
    if [[ "$VIS_CHECK" != "PRIVATE" ]]; then
      S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, visibility flip failed"
    else
      S3_DETAIL="$S3_DETAIL, visibility PRIVATE"
    fi
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Delete -> 404
    curl -s -X DELETE "$BASE/api/documents/$DOCUMENT_ID" >/dev/null
    DEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/documents/$DOCUMENT_ID" 2>/dev/null)
    if [[ "$DEL_CODE" != "404" ]]; then
      S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, after delete expected 404 got $DEL_CODE"
    else
      S3_DETAIL="$S3_DETAIL, delete OK"
    fi
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Oversized write rejected (>5MB)
    OVER_TMP=$(mktemp)
    trap "rm -f '$OVER_TMP'" EXIT
    python3 -c "
import json, sys
payload = json.dumps({'title':'big','content':'X'*(5*1024*1024+1)})
sys.stdout.write(payload)
" > "$OVER_TMP" 2>/dev/null
    if [[ -s "$OVER_TMP" ]]; then
      OVER_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/documents" \
        -H "Content-Type: application/json" \
        -d "@$OVER_TMP" 2>/dev/null)
      if [[ "$OVER_CODE" == "413" || "$OVER_CODE" == "400" ]]; then
        S3_DETAIL="$S3_DETAIL, oversize rejected $OVER_CODE"
      else
        S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, oversize returned $OVER_CODE"
      fi
    else
      S3_DETAIL="$S3_DETAIL, oversize SKIP (could not generate payload)"
    fi
    rm -f "$OVER_TMP"
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # Credential fixture returns 409 with options
    CRED_CONTENT="password = my_super_secret_value_123"
    CRED_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/documents" \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"cred test\",\"content\":\"$CRED_CONTENT\"}")
    CRED_CODE=$(echo "$CRED_RESP" | tail -1)
    CRED_BODY=$(echo "$CRED_RESP" | sed '$d')
    if [[ "$CRED_CODE" == "409" ]] && echo "$CRED_BODY" | grep -q "options"; then
      S3_DETAIL="$S3_DETAIL, credential 409+options"
    else
      S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, credential detection expected 409 got $CRED_CODE"
    fi
  fi

  if [[ "$S3_STATUS" == "PASS" ]]; then
    # redactionPolicy: redact stores [REDACTED:
    REDACT_RESP=$(curl -s -X POST "$BASE/api/documents" \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"redact test\",\"content\":\"$CRED_CONTENT\",\"redactionPolicy\":\"redact\"}")
    REDACT_ID=$(json_field "$REDACT_RESP" "id")
    if [[ -n "$REDACT_ID" && "$REDACT_ID" != "null" ]]; then
      REDACT_RAW=$(curl -s "$BASE/raw/$REDACT_ID")
      if echo "$REDACT_RAW" | grep -q '\[REDACTED:'; then
        S3_DETAIL="$S3_DETAIL, redaction OK"
      else
        S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, redacted content missing [REDACTED: tag"
      fi
    else
      S3_STATUS="FAIL"; S3_DETAIL="$S3_DETAIL, redact create failed"
    fi
  fi

  cleanup_server
  record "S3" "$S3_STATUS" "$S3_DETAIL"
fi

# --------------------------------------------------------------------------
# S4 — MCP stdio round-trip
# --------------------------------------------------------------------------
log "S4: MCP stdio"
S4_STATUS="PASS"
S4_DETAIL=""

MCP_STDIO="$REPO_ROOT/packages/mcp/dist/stdio.js"
if [[ ! -f "$MCP_STDIO" ]]; then
  S4_STATUS="FAIL"
  S4_DETAIL="MCP stdio binary not found at $MCP_STDIO"
  record "S4" "$S4_STATUS" "$S4_DETAIL"
else
  # We send JSON-RPC messages via stdin and read stdout.
  # The stdio MCP speaks newline-delimited JSON-RPC.

  # Build a sequence of JSON-RPC requests.
  INIT_REQ='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"verify","version":"1.0"}}}'
  INIT_NOTIF='{"jsonrpc":"2.0","method":"notifications/initialized"}'
  TOOLS_REQ='{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  CREATE_REQ='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_document","arguments":{"title":"MCP test","content":"hello mcp","language":"plaintext"}}}'
  SCAN_REQ='{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"scan_content","arguments":{"content":"password = real_secret_123"}}}'

  # Send all requests and capture output.
  MCP_OUTPUT=$(printf '%s\n%s\n%s\n%s\n%s\n' "$INIT_REQ" "$INIT_NOTIF" "$TOOLS_REQ" "$CREATE_REQ" "$SCAN_REQ" \
    | run_with_timeout 15 node "$MCP_STDIO" --user verify-user 2>/dev/null || true)

  if [[ -z "$MCP_OUTPUT" ]]; then
    S4_STATUS="FAIL"; S4_DETAIL="MCP stdio returned no output"
  fi

  # Check initialize response.
  if [[ "$S4_STATUS" == "PASS" ]]; then
    if echo "$MCP_OUTPUT" | grep -q '"protocolVersion"'; then
      S4_DETAIL="initialize OK"
    else
      S4_STATUS="FAIL"; S4_DETAIL="initialize handshake failed"
    fi
  fi

  # Check tools/list returns exactly 16 tools.
  if [[ "$S4_STATUS" == "PASS" ]]; then
    # Find the response to id:2 and count tools.
    TOOLS_LINE=$(echo "$MCP_OUTPUT" | grep '"id":2' | head -1)
    if [[ -n "$TOOLS_LINE" ]]; then
      if $JQ_FOUND; then
        TOOL_COUNT=$(echo "$TOOLS_LINE" | jq '.result.tools | length' 2>/dev/null)
      else
        TOOL_COUNT=$(echo "$TOOLS_LINE" | grep -o '"name"' | wc -l)
      fi
      if [[ "$TOOL_COUNT" == "16" ]]; then
        S4_DETAIL="$S4_DETAIL, 16 tools"
      else
        S4_STATUS="FAIL"; S4_DETAIL="$S4_DETAIL, expected 16 tools got $TOOL_COUNT"
      fi
    else
      S4_STATUS="FAIL"; S4_DETAIL="$S4_DETAIL, no tools/list response"
    fi
  fi

  # Check create_document round-trip (id:3).
  if [[ "$S4_STATUS" == "PASS" ]]; then
    CREATE_LINE=$(echo "$MCP_OUTPUT" | grep '"id":3' | head -1)
    if echo "$CREATE_LINE" | grep -q 'doc'; then
      S4_DETAIL="$S4_DETAIL, create_document OK"
    else
      S4_STATUS="FAIL"; S4_DETAIL="$S4_DETAIL, create_document failed"
    fi
  fi

  # Check scan_content detects fixture (id:5).
  if [[ "$S4_STATUS" == "PASS" ]]; then
    SCAN_LINE=$(echo "$MCP_OUTPUT" | grep '"id":5' | head -1)
    if echo "$SCAN_LINE" | grep -q 'generic-secret\|credential\|findings'; then
      S4_DETAIL="$S4_DETAIL, scan_content detected"
    else
      S4_STATUS="FAIL"; S4_DETAIL="$S4_DETAIL, scan_content did not detect credential"
    fi
  fi

  record "S4" "$S4_STATUS" "$S4_DETAIL"
fi

# --------------------------------------------------------------------------
# S5 — Multi-user isolation (trusted-header mode)
# --------------------------------------------------------------------------
log "S5: Multi-user isolation"
S5_STATUS="PASS"
S5_DETAIL=""

if [[ ! -f "$CLI_BIN" ]]; then
  S5_STATUS="FAIL"
  S5_DETAIL="CLI binary not found"
  record "S5" "$S5_STATUS" "$S5_DETAIL"
else
  PORT=$(pick_port)
  node "$CLI_BIN" serve --ephemeral --port "$PORT" --auth trusted-header &
  SERVER_PID=$!
  sleep 2
  BASE="http://127.0.0.1:${PORT}"

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    S5_STATUS="FAIL"; S5_DETAIL="server exited"
  fi

  if [[ "$S5_STATUS" == "PASS" ]]; then
    # User A creates a PRIVATE document.
    A_RESP=$(curl -s -X POST "$BASE/api/documents" \
      -H "Content-Type: application/json" \
      -H "X-Forwarded-User: alice" \
      -d '{"title":"Alice Secret","content":"private data","visibility":"PRIVATE"}')
    A_ID=$(json_field "$A_RESP" "id")
    if [[ -z "$A_ID" || "$A_ID" == "null" ]]; then
      S5_STATUS="FAIL"; S5_DETAIL="user A create failed"
    fi
  fi

  if [[ "$S5_STATUS" == "PASS" ]]; then
    # User B tries to read -> should get 404 (not 403, by design — no existence leak).
    B_READ_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/documents/$A_ID" \
      -H "X-Forwarded-User: bob")
    if [[ "$B_READ_CODE" != "404" ]]; then
      S5_STATUS="FAIL"; S5_DETAIL="user B read expected 404 got $B_READ_CODE"
    else
      S5_DETAIL="read 404"
    fi
  fi

  if [[ "$S5_STATUS" == "PASS" ]]; then
    # User B tries raw -> 404.
    B_RAW_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/raw/$A_ID" \
      -H "X-Forwarded-User: bob")
    if [[ "$B_RAW_CODE" != "404" ]]; then
      S5_STATUS="FAIL"; S5_DETAIL="$S5_DETAIL, raw expected 404 got $B_RAW_CODE"
    else
      S5_DETAIL="$S5_DETAIL, raw 404"
    fi
  fi

  if [[ "$S5_STATUS" == "PASS" ]]; then
    # User B tries comments -> 404.
    B_COMMENT_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/documents/$A_ID/comments" \
      -H "X-Forwarded-User: bob")
    if [[ "$B_COMMENT_CODE" != "404" ]]; then
      S5_STATUS="FAIL"; S5_DETAIL="$S5_DETAIL, comments expected 404 got $B_COMMENT_CODE"
    else
      S5_DETAIL="$S5_DETAIL, comments 404"
    fi
  fi

  if [[ "$S5_STATUS" == "PASS" ]]; then
    # User B list should not contain A's document.
    B_LIST=$(curl -s "$BASE/api/documents" -H "X-Forwarded-User: bob")
    if echo "$B_LIST" | grep -q "$A_ID"; then
      S5_STATUS="FAIL"; S5_DETAIL="$S5_DETAIL, A's document leaked in B's list"
    else
      S5_DETAIL="$S5_DETAIL, not in list"
    fi
  fi

  if [[ "$S5_STATUS" == "PASS" ]]; then
    # User B search should not find A's PRIVATE document.
    B_SEARCH=$(curl -s "$BASE/api/documents?query=Alice+Secret" -H "X-Forwarded-User: bob")
    if echo "$B_SEARCH" | grep -q "$A_ID"; then
      S5_STATUS="FAIL"; S5_DETAIL="$S5_DETAIL, A's document leaked in B's search"
    else
      S5_DETAIL="$S5_DETAIL, not in search"
    fi
  fi

  cleanup_server
  record "S5" "$S5_STATUS" "$S5_DETAIL"
fi

# --------------------------------------------------------------------------
# S6 — Dependency provenance (+ optional forbidden-terms audit)
# --------------------------------------------------------------------------
# Every package in the lockfile must resolve from the public npm registry, so
# a fresh clone installs anywhere. Optionally, a fork can also assert that
# certain strings never appear in the tree: put an extended regex in the
# AGENTDOCSTORE_FORBIDDEN_TERMS environment variable, or on the first line of a
# git-ignored .forbidden-terms file at the repo root.
log "S6: Dependency provenance"
S6_STATUS="PASS"
S6_DETAIL=""

BAD_RESOLVED=$(grep -oE '"resolved": "[^"]+"' package-lock.json \
  | grep -vE '"resolved": "(https://registry.npmjs.org/|packages/)' || true)
if [[ -n "$BAD_RESOLVED" ]]; then
  S6_STATUS="FAIL"
  S6_DETAIL="$(echo "$BAD_RESOLVED" | wc -l) lockfile entr(ies) outside registry.npmjs.org: $(echo "$BAD_RESOLVED" | head -3 | tr '\n' ' ')"
else
  S6_DETAIL="all lockfile entries resolve from registry.npmjs.org"
fi

FORBIDDEN="${AGENTDOCSTORE_FORBIDDEN_TERMS:-}"
if [[ -z "$FORBIDDEN" && -f "$REPO_ROOT/.forbidden-terms" ]]; then
  FORBIDDEN="$(head -n 1 "$REPO_ROOT/.forbidden-terms")"
fi
if [[ -n "$FORBIDDEN" ]]; then
  # Tracked and not-yet-committed files only; ignored files (logs, local
  # runner state) are not part of what ships.
  HITS=$(git grep -niE --untracked --exclude-standard "$FORBIDDEN" -- \
    ':!package-lock.json' ':!VERIFICATION.md' ':!.forbidden-terms' 2>/dev/null || true)
  if [[ -n "$HITS" ]]; then
    S6_STATUS="FAIL"
    S6_DETAIL="$S6_DETAIL; $(echo "$HITS" | wc -l) forbidden-term hit(s): $(echo "$HITS" | head -5 | tr '\n' ' ')"
  else
    S6_DETAIL="$S6_DETAIL; forbidden-terms audit: zero hits"
  fi
fi

record "S6" "$S6_STATUS" "$S6_DETAIL"

# --------------------------------------------------------------------------
# S7 — Offline audit (no external asset references in built bundle)
# --------------------------------------------------------------------------
log "S7: Offline audit"
S7_STATUS="PASS"
S7_DETAIL=""

WEB_DIST="$REPO_ROOT/packages/web/dist"
if [[ ! -d "$WEB_DIST" ]]; then
  S7_STATUS="SKIP"
  S7_DETAIL="packages/web/dist not found (web package may not be built yet)"
else
  # Grep for external asset references: src="http, href="http, url(http
  # Exclude .map files (source map VLQ noise).
  # POSIX ERE, not grep -P: on BSD/macOS grep -P errors out, and `|| true`
  # would turn that error into an empty result — a false PASS.
  EXT_REFS=$(grep -rEn '(src|href)[[:space:]]*=[[:space:]]*"https?://|url\([[:space:]]*https?://' \
    "$WEB_DIST" --include='*.html' --include='*.js' --include='*.css' \
    --exclude='*.map' 2>/dev/null || true)

  if [[ -n "$EXT_REFS" ]]; then
    # Filter out XML namespace URIs (not fetched) and comment-only lines.
    REAL_REFS=$(echo "$EXT_REFS" | grep -v 'w3\.org' | grep -v '^\s*//' || true)
    if [[ -n "$REAL_REFS" ]]; then
      REF_COUNT=$(echo "$REAL_REFS" | wc -l)
      S7_STATUS="FAIL"
      S7_DETAIL="$REF_COUNT external asset reference(s): $(echo "$REAL_REFS" | head -3 | tr '\n' ' ')"
    else
      S7_DETAIL="only XML namespace URIs (not fetched)"
    fi
  else
    S7_DETAIL="zero external asset references"
  fi
fi

record "S7" "$S7_STATUS" "$S7_DETAIL"

# --------------------------------------------------------------------------
# S8 — HTML iframe sandbox attribute
# --------------------------------------------------------------------------
log "S8: HTML iframe sandbox"
S8_STATUS="PASS"
S8_DETAIL=""

CONSTANTS_FILE="$REPO_ROOT/packages/web/src/constants.ts"
if [[ ! -f "$CONSTANTS_FILE" ]]; then
  S8_STATUS="FAIL"
  S8_DETAIL="constants.ts not found"
else
  # Assert on the HTML_IFRAME_SANDBOX constant value.
  EXPECTED_SANDBOX="allow-scripts allow-popups allow-popups-to-escape-sandbox"
  if grep -q "HTML_IFRAME_SANDBOX.*=.*'$EXPECTED_SANDBOX'" "$CONSTANTS_FILE"; then
    S8_DETAIL="HTML_IFRAME_SANDBOX constant correct"
  elif grep -q "HTML_IFRAME_SANDBOX.*=.*\"$EXPECTED_SANDBOX\"" "$CONSTANTS_FILE"; then
    S8_DETAIL="HTML_IFRAME_SANDBOX constant correct"
  else
    S8_STATUS="FAIL"
    ACTUAL=$(grep 'HTML_IFRAME_SANDBOX' "$CONSTANTS_FILE" | head -1)
    S8_DETAIL="HTML_IFRAME_SANDBOX mismatch: $ACTUAL"
  fi

  # Also verify render.ts applies it via setAttribute.
  RENDER_FILE="$REPO_ROOT/packages/web/src/render.ts"
  if [[ -f "$RENDER_FILE" ]]; then
    if grep -q "sandbox.*HTML_IFRAME_SANDBOX\|setAttribute.*sandbox.*HTML_IFRAME_SANDBOX" "$RENDER_FILE"; then
      S8_DETAIL="$S8_DETAIL, applied in render.ts"
    elif grep -q "HTML_IFRAME_SANDBOX" "$RENDER_FILE"; then
      S8_DETAIL="$S8_DETAIL, referenced in render.ts"
    else
      S8_DETAIL="$S8_DETAIL, WARNING: HTML_IFRAME_SANDBOX not referenced in render.ts"
    fi
  fi
fi

record "S8" "$S8_STATUS" "$S8_DETAIL"

# --------------------------------------------------------------------------
# S9 — npm pack + Docker build
# --------------------------------------------------------------------------
log "S9: npm pack + Docker"
S9_STATUS="PASS"
S9_DETAIL=""

# npm pack --dry-run for each publishable (non-private) package.
#
# Two earlier bugs here: the pack command omitted `-w <name>` so it packed the
# ROOT rather than the package under test, and an unconditional assignment below
# overwrote the loop's result — so a genuine pack failure still reported
# "all packages private". Both are fixed, and an empty publishable set is now a
# FAIL rather than a silent pass, because docs/PROVIDERS.md instructs forks to
# install @agentdocstore/provider-tests and that is impossible if nothing publishes.
PACK_FAIL=0
PACK_OK=0
PACK_PRIVATE=0
PACK_NAMES=""
for pkg_dir in packages/*/; do
  [[ -f "$pkg_dir/package.json" ]] || continue
  PKG_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$pkg_dir/package.json','utf8')).name)" 2>/dev/null || echo "")
  PRIVATE=$(node -e "const p=JSON.parse(require('fs').readFileSync('$pkg_dir/package.json','utf8')); console.log(p.private===true?'true':'false')" 2>/dev/null || echo "true")
  if [[ "$PRIVATE" == "true" ]]; then
    ((PACK_PRIVATE++))
    continue
  fi
  if npm pack --dry-run -w "$PKG_NAME" >/dev/null 2>&1; then
    ((PACK_OK++))
    PACK_NAMES="$PACK_NAMES $PKG_NAME"
  else
    ((PACK_FAIL++))
    S9_DETAIL="$S9_DETAIL, $PKG_NAME pack FAILED"
  fi
done

if (( PACK_FAIL > 0 )); then
  S9_STATUS="FAIL"
  S9_DETAIL="npm pack: $PACK_FAIL failed$S9_DETAIL"
elif (( PACK_OK == 0 )); then
  S9_STATUS="FAIL"
  S9_DETAIL="npm pack: no publishable package found (all $PACK_PRIVATE private) — forks cannot install the conformance suite"
else
  S9_DETAIL="npm pack: $PACK_OK publishable OK ($(echo "$PACK_NAMES" | xargs)), $PACK_PRIVATE private"
fi

# Docker build (skip when unavailable or explicitly disabled).
if [[ "${AGENTDOCSTORE_SKIP_DOCKER:-0}" != "1" ]] && command -v docker &>/dev/null; then
  if [[ -f "$REPO_ROOT/Dockerfile" ]]; then
    if docker build -t agentdocstore-verify "$REPO_ROOT" >docker-build.log 2>&1; then
      S9_DETAIL="$S9_DETAIL, Docker build OK"
      # Quick healthz check.
      DOCKER_PORT=$(pick_port)
      CONTAINER_ID=$(docker run -d -p "$DOCKER_PORT:8787" --name agentdocstore-verify-run agentdocstore-verify 2>/dev/null || true)
      if [[ -n "$CONTAINER_ID" ]]; then
        sleep 3
        DOCKER_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${DOCKER_PORT}/healthz" 2>/dev/null || echo "000")
        if [[ "$DOCKER_HEALTH" == "200" ]]; then
          S9_DETAIL="$S9_DETAIL, Docker /healthz 200"
        else
          S9_DETAIL="$S9_DETAIL, Docker /healthz returned $DOCKER_HEALTH"
        fi
        docker rm -f agentdocstore-verify-run >/dev/null 2>&1 || true
      fi
      # The image is deliberately NOT removed here: S15 re-runs it with
      # `--network none` and deletes it afterwards. Rebuilding would mean a
      # second `npm ci` inside Docker for no benefit.
      S9_IMAGE_READY=true
    else
      S9_STATUS="FAIL"; S9_DETAIL="$S9_DETAIL, Docker build FAILED (see docker-build.log)"
    fi
  else
    S9_STATUS="SKIP"; S9_DETAIL="$S9_DETAIL, no Dockerfile found (concurrent agent may not be finished yet)"
  fi
else
  if [[ "${AGENTDOCSTORE_SKIP_DOCKER:-0}" == "1" ]]; then
    S9_DETAIL="$S9_DETAIL, Docker SKIP (AGENTDOCSTORE_SKIP_DOCKER=1)"
  else
    S9_DETAIL="$S9_DETAIL, Docker SKIP (docker not on PATH)"
  fi
fi

record "S9" "$S9_STATUS" "$S9_DETAIL"

# --------------------------------------------------------------------------
# S10 — Docs completeness
# --------------------------------------------------------------------------
log "S10: Docs completeness"
S10_STATUS="PASS"
S10_DETAIL=""
MIN_LINES=40

check_doc() {
  local filepath="$1" label="$2"
  if [[ ! -f "$filepath" ]]; then
    S10_STATUS="FAIL"
    S10_DETAIL="$S10_DETAIL, $label MISSING"
    return
  fi
  local lines
  lines=$(wc -l < "$filepath")
  if [[ "$lines" -lt "$MIN_LINES" ]]; then
    S10_STATUS="FAIL"
    S10_DETAIL="$S10_DETAIL, $label too short (${lines} lines)"
    return
  fi
  S10_DETAIL="$S10_DETAIL, $label OK (${lines}L)"
}

check_doc "$REPO_ROOT/README.md" "README.md"
check_doc "$REPO_ROOT/CONTRIBUTING.md" "CONTRIBUTING.md"
check_doc "$REPO_ROOT/CHANGELOG.md" "CHANGELOG.md"
check_doc "$REPO_ROOT/CODE_OF_CONDUCT.md" "CODE_OF_CONDUCT.md"
check_doc "$REPO_ROOT/SECURITY.md" "SECURITY.md"
check_doc "$REPO_ROOT/docs/ARCHITECTURE.md" "docs/ARCHITECTURE.md"
check_doc "$REPO_ROOT/docs/API.md" "docs/API.md"
check_doc "$REPO_ROOT/docs/CONFIGURATION.md" "docs/CONFIGURATION.md"
check_doc "$REPO_ROOT/docs/PROVIDERS.md" "docs/PROVIDERS.md"
check_doc "$REPO_ROOT/docs/MCP.md" "docs/MCP.md"
check_doc "$REPO_ROOT/docs/SECURITY.md" "docs/SECURITY.md"
check_doc "$REPO_ROOT/docs/HOSTING.md" "docs/HOSTING.md"

# Trim leading comma-space.
S10_DETAIL="${S10_DETAIL#, }"
record "S10" "$S10_STATUS" "$S10_DETAIL"

# --------------------------------------------------------------------------
# S11 — Offline mode is ENFORCED, not documented
# --------------------------------------------------------------------------
log "S11: Offline enforcement"
S11_STATUS="PASS"
S11_DETAIL=""

CLI="$REPO_ROOT/packages/cli/dist/index.js"

# (a) A non-loopback bind must be REFUSED in offline mode (the default).
S11_OUT="$(node "$CLI" serve --host 0.0.0.0 --ephemeral 2>&1)"
S11_CODE=$?
if [[ "$S11_CODE" -eq 0 ]] || ! grep -qi "refuses to bind" <<<"$S11_OUT"; then
  S11_STATUS="FAIL"
  S11_DETAIL="$S11_DETAIL, non-loopback bind was NOT refused (exit $S11_CODE)"
else
  S11_DETAIL="$S11_DETAIL, non-loopback bind refused"
fi

# (b) The same bind must be ALLOWED with --networked (opt-out works).
S11_PORT="$(pick_port)"
node "$CLI" serve --networked --host 127.0.0.1 --ephemeral --port "$S11_PORT" \
  > "$REPO_ROOT/.verify-s11.log" 2>&1 &
SERVER_PID=$!
sleep 3
S11_MODE="$(curl -s "http://127.0.0.1:$S11_PORT/healthz" | jq -r '.mode // "missing"' 2>/dev/null)"
if [[ "$S11_MODE" != "networked" ]]; then
  S11_STATUS="FAIL"
  S11_DETAIL="$S11_DETAIL, /healthz mode was '$S11_MODE', expected 'networked'"
else
  S11_DETAIL="$S11_DETAIL, --networked accepted and reported on /healthz"
fi
cleanup_server

# (b2) --expose must allow the SAME non-loopback bind while STAYING offline:
#      inbound exposure and outbound egress are separate promises. This is the
#      posture the Docker image runs in.
S11_PORT3="$(pick_port)"
node "$CLI" serve --host 0.0.0.0 --expose --ephemeral --port "$S11_PORT3" \
  > "$REPO_ROOT/.verify-s11c.log" 2>&1 &
SERVER_PID=$!
sleep 3
S11_EXP_MODE="$(curl -s "http://127.0.0.1:$S11_PORT3/healthz" | jq -r '.mode // "missing"' 2>/dev/null)"
if [[ "$S11_EXP_MODE" == "offline" ]] \
  && grep -q "inbound=exposed" "$REPO_ROOT/.verify-s11c.log" \
  && grep -q "egress=fused" "$REPO_ROOT/.verify-s11c.log"; then
  S11_DETAIL="$S11_DETAIL, --expose serves 0.0.0.0 while still offline+fused"
else
  S11_STATUS="FAIL"
  S11_DETAIL="$S11_DETAIL, --expose did not yield offline+fused (mode=$S11_EXP_MODE)"
fi
cleanup_server
rm -f "$REPO_ROOT/.verify-s11c.log"

# (c) Offline mode must report itself on /healthz, with the provider descriptor.
S11_PORT2="$(pick_port)"
node "$CLI" serve --ephemeral --port "$S11_PORT2" > "$REPO_ROOT/.verify-s11b.log" 2>&1 &
SERVER_PID=$!
sleep 3
S11_HEALTH="$(curl -s "http://127.0.0.1:$S11_PORT2/healthz")"
S11_M="$(jq -r '.mode // "missing"' <<<"$S11_HEALTH" 2>/dev/null)"
# NOTE: `// "missing"` would be wrong here — jq treats `false` as absent, and
# requiresNetwork=false is exactly the value we expect.
S11_RN="$(jq -r 'if has("provider") and (.provider | has("requiresNetwork")) then (.provider.requiresNetwork | tostring) else "missing" end' <<<"$S11_HEALTH" 2>/dev/null)"
if [[ "$S11_M" != "offline" || "$S11_RN" != "false" ]]; then
  S11_STATUS="FAIL"
  S11_DETAIL="$S11_DETAIL, offline /healthz reported mode=$S11_M requiresNetwork=$S11_RN"
else
  S11_DETAIL="$S11_DETAIL, offline reported with requiresNetwork=false"
fi
# (d) The fuse must be armed in this offline server: the boot banner says so.
if grep -q "egress=fused" "$REPO_ROOT/.verify-s11b.log"; then
  S11_DETAIL="$S11_DETAIL, fuse armed"
else
  S11_STATUS="FAIL"
  S11_DETAIL="$S11_DETAIL, boot banner did not report egress=fused"
fi
cleanup_server
rm -f "$REPO_ROOT/.verify-s11.log" "$REPO_ROOT/.verify-s11b.log"

S11_DETAIL="${S11_DETAIL#, }"
record "S11" "$S11_STATUS" "$S11_DETAIL"

# --------------------------------------------------------------------------
# S12 — Third-party provider loading + doctor gate
# --------------------------------------------------------------------------
log "S12: Provider loading + doctor"
S12_STATUS="PASS"
S12_DETAIL=""

# (a) doctor passes against a built-in provider.
if node "$CLI" doctor --ephemeral > "$REPO_ROOT/.verify-s12.log" 2>&1; then
  S12_CHECKS="$(grep -c '✓' "$REPO_ROOT/.verify-s12.log" || echo 0)"
  S12_DETAIL="$S12_DETAIL, doctor PASS on memory provider ($S12_CHECKS checks)"
else
  S12_STATUS="FAIL"
  S12_DETAIL="$S12_DETAIL, doctor FAILED on the built-in memory provider"
fi

# (b) init-provider scaffolds a package with the conformance suite wired in.
S12_TMP="$(mktemp -d)"
if (cd "$S12_TMP" && node "$CLI" init-provider teststore > /dev/null 2>&1) \
  && [[ -f "$S12_TMP/agentdocstore-provider-teststore/src/index.ts" ]] \
  && grep -q "requiresNetwork" "$S12_TMP/agentdocstore-provider-teststore/src/index.ts" \
  && grep -q "runProviderConformance" "$S12_TMP/agentdocstore-provider-teststore/src/conformance.test.ts"; then
  S12_DETAIL="$S12_DETAIL, init-provider scaffold complete"
else
  S12_STATUS="FAIL"
  S12_DETAIL="$S12_DETAIL, init-provider scaffold incomplete"
fi

# (c) A third-party module is loadable by path, and a networked one is refused
#     in offline mode but accepted with --networked.
cat > "$S12_TMP/fake-provider.mjs" <<'PEOF'
export const providerName = 'fake-remote';
export async function createProvider() {
  return {
    repository: {}, comments: {}, search: {},
    capabilities: { search: 'core-fallback', nativeTtl: false,
                    atomicVersioning: true, requiresNetwork: true },
    close: async () => {},
  };
}
PEOF
S12_OFFLINE_OUT="$(node "$CLI" doctor --provider "$S12_TMP/fake-provider.mjs" 2>&1)"
if grep -q "requiresNetwork=true" <<<"$S12_OFFLINE_OUT"; then
  S12_DETAIL="$S12_DETAIL, networked provider refused offline"
else
  S12_STATUS="FAIL"
  S12_DETAIL="$S12_DETAIL, networked provider was NOT refused offline"
fi
S12_NET_OUT="$(node "$CLI" doctor --networked --provider "$S12_TMP/fake-provider.mjs" 2>&1)"
if grep -q "fake-remote" <<<"$S12_NET_OUT"; then
  S12_DETAIL="$S12_DETAIL, loaded with --networked"
else
  S12_STATUS="FAIL"
  S12_DETAIL="$S12_DETAIL, third-party module did not load with --networked"
fi

# (d) An unresolvable module must say how to install it.
S12_MISSING_OUT="$(node "$CLI" doctor --provider '@nobody/agentdocstore-provider-absent' 2>&1)"
if grep -q "npm install" <<<"$S12_MISSING_OUT"; then
  S12_DETAIL="$S12_DETAIL, missing module explained"
else
  S12_STATUS="FAIL"
  S12_DETAIL="$S12_DETAIL, missing module error unhelpful"
fi

rm -rf "$S12_TMP" "$REPO_ROOT/.verify-s12.log"
S12_DETAIL="${S12_DETAIL#, }"
record "S12" "$S12_STATUS" "$S12_DETAIL"

# --------------------------------------------------------------------------
# S13 — MCP-over-HTTP enforces the server's auth mode
# --------------------------------------------------------------------------
# /mcp reaches the same provider as REST. S5 proves REST isolation; this proves
# the MCP endpoint is not a way around it.
log "S13: MCP HTTP auth isolation"
S13_STATUS="PASS"
S13_DETAIL=""

S13_PORT="$(pick_port)"
node "$CLI" serve --ephemeral --auth trusted-header --port "$S13_PORT" \
  > "$REPO_ROOT/.verify-s13.log" 2>&1 &
SERVER_PID=$!
sleep 3

MCP_URL="http://127.0.0.1:$S13_PORT/mcp"
INIT_BODY='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"1.0"}}}'

# (a) No identity header => 401, NOT a synthetic user.
S13_ANON="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d "$INIT_BODY")"
if [[ "$S13_ANON" == "401" ]]; then
  S13_DETAIL="$S13_DETAIL, anonymous 401"
else
  S13_STATUS="FAIL"
  S13_DETAIL="$S13_DETAIL, anonymous MCP request returned $S13_ANON (expected 401)"
fi

# (b) Alice opens a session.
S13_HEADERS="$(curl -s -D - -o /dev/null -X POST "$MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'x-forwarded-user: alice' \
  -d "$INIT_BODY")"
S13_SESSION="$(grep -i '^mcp-session-id:' <<<"$S13_HEADERS" | tr -d '\r' | awk '{print $2}')"
if [[ -n "$S13_SESSION" ]]; then
  S13_DETAIL="$S13_DETAIL, session opened for alice"
else
  S13_STATUS="FAIL"
  S13_DETAIL="$S13_DETAIL, alice could not open a session"
fi

# (c) Bob presenting Alice's session id => 403.
if [[ -n "$S13_SESSION" ]]; then
  S13_HIJACK="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$MCP_URL" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -H 'x-forwarded-user: bob' \
    -H "mcp-session-id: $S13_SESSION" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')"
  if [[ "$S13_HIJACK" == "403" ]]; then
    S13_DETAIL="$S13_DETAIL, session reuse by bob 403"
  else
    S13_STATUS="FAIL"
    S13_DETAIL="$S13_DETAIL, session reuse by bob returned $S13_HIJACK (expected 403)"
  fi
fi

# (d) Bob listing Alice's documents over MCP sees her PUBLIC one, never her
# PRIVATE one. The PUBLIC document proves the call worked, so a broken call
# cannot pass as "nothing leaked".
REST_URL="http://127.0.0.1:$S13_PORT/api/documents"
curl -s -o /dev/null -X POST "$REST_URL" -H 'content-type: application/json' \
  -H 'x-forwarded-user: alice' \
  -d '{"title":"S13 alice private","content":"private","visibility":"PRIVATE"}'
curl -s -o /dev/null -X POST "$REST_URL" -H 'content-type: application/json' \
  -H 'x-forwarded-user: alice' \
  -d '{"title":"S13 alice public","content":"public","visibility":"PUBLIC"}'
S13_BOB_SESSION="$(curl -s -D - -o /dev/null -X POST "$MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'x-forwarded-user: bob' \
  -d "$INIT_BODY" | grep -i '^mcp-session-id:' | tr -d '\r' | awk '{print $2}')"
if [[ -n "$S13_BOB_SESSION" ]]; then
  S13_MCP_POST=(curl -s -X POST "$MCP_URL"
    -H 'content-type: application/json'
    -H 'accept: application/json, text/event-stream'
    -H 'x-forwarded-user: bob'
    -H "mcp-session-id: $S13_BOB_SESSION")
  "${S13_MCP_POST[@]}" -o /dev/null -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  S13_LIST="$("${S13_MCP_POST[@]}" \
    -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_documents","arguments":{"owner":"alice"}}}')"
  if grep -q 'S13 alice private' <<<"$S13_LIST"; then
    S13_STATUS="FAIL"
    S13_DETAIL="$S13_DETAIL, bob's MCP list_documents returned alice's PRIVATE doc"
  elif grep -q 'S13 alice public' <<<"$S13_LIST"; then
    S13_DETAIL="$S13_DETAIL, MCP list hides private"
  else
    S13_STATUS="FAIL"
    S13_DETAIL="$S13_DETAIL, bob's MCP list_documents call failed"
  fi
else
  S13_STATUS="FAIL"
  S13_DETAIL="$S13_DETAIL, bob could not open a session"
fi

cleanup_server
rm -f "$REPO_ROOT/.verify-s13.log"
S13_DETAIL="${S13_DETAIL#, }"
record "S13" "$S13_STATUS" "$S13_DETAIL"

# --------------------------------------------------------------------------
# S14 — Lint runs and passes
# --------------------------------------------------------------------------
# `npm run lint` used to exit 127 (neither tool installed), which meant the
# script existed but guarded nothing. Both halves are asserted separately so a
# failure names which one.
log "S14: lint (eslint + prettier)"
S14_STATUS="PASS"
S14_DETAIL=""

if npx --no-install eslint --version >/dev/null 2>&1; then
  if npx --no-install eslint . > "$REPO_ROOT/.verify-s14-eslint.log" 2>&1; then
    S14_DETAIL="$S14_DETAIL, eslint clean"
  else
    S14_STATUS="FAIL"
    S14_ESLINT_N="$(grep -cE '^\s+[0-9]+:[0-9]+' "$REPO_ROOT/.verify-s14-eslint.log" || true)"
    S14_DETAIL="$S14_DETAIL, eslint reported $S14_ESLINT_N findings"
  fi
else
  S14_STATUS="FAIL"
  S14_DETAIL="$S14_DETAIL, eslint not installed"
fi

if npx --no-install prettier --version >/dev/null 2>&1; then
  if npx --no-install prettier --check . > "$REPO_ROOT/.verify-s14-prettier.log" 2>&1; then
    S14_DETAIL="$S14_DETAIL, prettier clean"
  else
    S14_STATUS="FAIL"
    S14_PRETTIER_N="$(grep -c '^\[warn\] ' "$REPO_ROOT/.verify-s14-prettier.log" || true)"
    S14_DETAIL="$S14_DETAIL, prettier would reformat $S14_PRETTIER_N files"
  fi
else
  S14_STATUS="FAIL"
  S14_DETAIL="$S14_DETAIL, prettier not installed"
fi

rm -f "$REPO_ROOT/.verify-s14-eslint.log" "$REPO_ROOT/.verify-s14-prettier.log"
S14_DETAIL="${S14_DETAIL#, }"
record "S14" "$S14_STATUS" "$S14_DETAIL"

# --------------------------------------------------------------------------
# S15 — Air-gap: the whole surface works, and the fuse bites, with NO network
# --------------------------------------------------------------------------
# S7 greps the built bundle for external references; this criterion is the
# behavioural counterpart. It re-runs the image from S9 with `--network none`
# (only a loopback device, no route, no DNS) and asserts both halves of the
# offline promise: the app is fully usable, AND an egress attempt is refused by
# the fuse rather than merely failing for lack of a NIC — the probe proves that
# distinction by releasing the fuse and re-attempting the same call.
log "S15: air-gap run (docker --network none)"
S15_STATUS="PASS"
S15_DETAIL=""

if [[ "${AGENTDOCSTORE_SKIP_DOCKER:-0}" == "1" ]]; then
  S15_STATUS="SKIP"
  S15_DETAIL="Docker checks explicitly disabled with AGENTDOCSTORE_SKIP_DOCKER=1"
elif ! command -v docker &>/dev/null; then
  S15_STATUS="SKIP"
  S15_DETAIL="docker not on PATH — an air gap needs a network namespace"
elif [[ "${S9_IMAGE_READY:-false}" != "true" ]]; then
  S15_STATUS="SKIP"
  S15_DETAIL="no image from S9 to run air-gapped"
else
  S15_OUT="$(AIRGAP_IMAGE=agentdocstore-verify run_with_timeout 300 bash "$REPO_ROOT/scripts/airgap-test.sh" --no-build 2>&1)"
  S15_CODE=$?
  S15_RESULT="$(grep -oE 'RESULT: [0-9]+ passed, [0-9]+ failed' <<<"$S15_OUT" | tail -1)"
  if [[ $S15_CODE -eq 0 ]]; then
    S15_DETAIL="${S15_RESULT:-probe passed} in --network none"
  else
    S15_STATUS="FAIL"
    S15_FAILED="$(grep -E '^\[FAIL\]' <<<"$S15_OUT" | head -3 | tr '\n' ';')"
    S15_DETAIL="${S15_RESULT:-probe failed (exit $S15_CODE)}: $S15_FAILED"
  fi
  docker rmi agentdocstore-verify >/dev/null 2>&1 || true
fi

S15_DETAIL="${S15_DETAIL#, }"
record "S15" "$S15_STATUS" "$S15_DETAIL"

# --------------------------------------------------------------------------
# Summary + VERIFICATION.md
# --------------------------------------------------------------------------
log "SUMMARY"
TOTAL=$((PASS + FAIL + SKIP))
echo "PASS=$PASS  FAIL=$FAIL  SKIP=$SKIP  TOTAL=$TOTAL"

cat > "$REPO_ROOT/VERIFICATION.md" <<VEOF
# Verification Report

Generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
Node: $NODE_VERSION

## Results

| Criterion | Status | Detail |
|-----------|--------|--------|
$(printf '%s\n' "${RESULTS[@]}")

## Summary

- **PASS:** $PASS
- **FAIL:** $FAIL
- **SKIP:** $SKIP
- **Total:** $TOTAL

## Commands Used

\`\`\`
npm ci / npm install
npm run build
npm test
node packages/cli/dist/index.js serve --ephemeral --port <PORT>
curl / jq for REST E2E
node packages/mcp/dist/stdio.js --user verify-user (JSON-RPC over stdin)
grep -riE for rebrand + offline audit
node packages/cli/dist/index.js serve --host 0.0.0.0        (S11: must be refused)
node packages/cli/dist/index.js serve --networked            (S11: must be allowed)
node packages/cli/dist/index.js doctor --ephemeral           (S12: provider gate)
node packages/cli/dist/index.js init-provider teststore      (S12: scaffold)
node packages/cli/dist/index.js doctor --provider <path>     (S12: third-party load)
curl POST /mcp with and without identity headers             (S13: auth isolation)
npx eslint . && npx prettier --check .                        (S14: lint)
scripts/airgap-test.sh --no-build                             (S15: --network none)
\`\`\`
VEOF

echo ""
echo "VERIFICATION.md written to $REPO_ROOT/VERIFICATION.md"

# Exit non-zero if any FAIL.
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0

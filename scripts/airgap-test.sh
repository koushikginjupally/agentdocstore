#!/usr/bin/env bash
# Air-gap test: run AgentDocStore in a container with NO network interface.
#
# Why a container: the claim "works with networking fully disabled" cannot be
# tested by unplugging the developer's machine, and `unshare -rn` is unavailable
# in many sandboxes. `docker run --network none` gives a namespace whose only
# interface is loopback — no route, no DNS, nothing to leak to — which is the
# closest thing to an air gap that a test can create on demand.
#
# The image is BUILT with network (npm ci needs the registry) and RUN without
# it. That split mirrors the real deployment story: install once, then run
# isolated forever.
#
# Usage:
#   scripts/airgap-test.sh              # build the image if needed, then test
#   scripts/airgap-test.sh --no-build   # reuse the existing image
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

IMAGE="${AIRGAP_IMAGE:-agentdocstore:airgap}"
BUILD=true
[[ "${1:-}" == "--no-build" ]] && BUILD=false

if ! command -v docker &>/dev/null; then
  echo "SKIP: docker is not installed — the air-gap test needs a network namespace."
  exit 2
fi
if ! docker info &>/dev/null; then
  echo "SKIP: docker is installed but the daemon is not reachable."
  exit 2
fi

if $BUILD; then
  if ! docker image inspect "$IMAGE" &>/dev/null; then
    echo "=== Building $IMAGE (needs network; the test run will not have any) ==="
    if ! docker build -t "$IMAGE" . > "$REPO_ROOT/.airgap-build.log" 2>&1; then
      echo "FAIL: docker build failed. Tail of .airgap-build.log:"
      tail -20 "$REPO_ROOT/.airgap-build.log"
      exit 1
    fi
    rm -f "$REPO_ROOT/.airgap-build.log"
  else
    echo "=== Reusing existing image $IMAGE ==="
  fi
fi

if ! docker image inspect "$IMAGE" &>/dev/null; then
  echo "FAIL: image $IMAGE not found. Run without --no-build."
  exit 1
fi

echo "=== Running probe with --network none ==="
# --network none is the whole point: the container gets its own netns with only
# a loopback device. The probe is mounted read-only; nothing else is shared.
docker run --rm \
  --network none \
  --entrypoint node \
  -v "$REPO_ROOT/scripts/airgap-probe.mjs:/probe.mjs:ro" \
  "$IMAGE" /probe.mjs
STATUS=$?

echo ""
if [[ $STATUS -eq 0 ]]; then
  echo "AIR-GAP TEST: PASS"
else
  echo "AIR-GAP TEST: FAIL (exit $STATUS)"
fi
exit $STATUS

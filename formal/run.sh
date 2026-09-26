#!/bin/sh
# Runs the Lean model inside Docker; nothing is installed on the host.
#   formal/run.sh build     build the image, fetch mathlib's cache, lake build
#   formal/run.sh vectors   also regenerate the Go golden vectors
#   formal/run.sh shell     a shell in the container
#   formal/run.sh clean     remove the image and the volumes
set -eu

IMAGE=mhj2-lean
VOLUMES="mhj2-lean-elan mhj2-lean-lake mhj2-lean-cache"
repo=$(cd "$(dirname "$0")/.." && pwd)

run() {
	# shellcheck disable=SC2086
	docker run --rm ${TTY:-} \
		-v "$repo":/work \
		-v mhj2-lean-elan:/root/.elan \
		-v mhj2-lean-lake:/work/formal/.lake \
		-v mhj2-lean-cache:/root/.cache \
		-w /work/formal "$IMAGE" sh -c "$1"
}

image() { docker build -q -t "$IMAGE" "$repo/formal" >/dev/null; }

# Fetch the prebuilt mathlib files for only the modules the model imports
# (and their imports), not all of mathlib: that keeps the volumes small.
CACHE='mods=$(grep -hs "^import Mathlib" *.lean Mhj2/*.lean | sed "s/^import //" | sort -u)
if [ -n "$mods" ]; then lake exe cache get $mods; fi'

case "${1:-build}" in
build)
	image
	run "$CACHE && lake build"
	;;
vectors)
	image
	run "$CACHE && lake build && lake exe gen-vectors /work"
	;;
shell)
	image
	TTY=-it run bash
	;;
clean)
	docker image rm -f "$IMAGE" || true
	# shellcheck disable=SC2086
	docker volume rm $VOLUMES || true
	;;
*)
	echo "usage: $0 [build|vectors|shell|clean]" >&2
	exit 2
	;;
esac

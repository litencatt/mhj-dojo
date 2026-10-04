#!/bin/sh
# Runs the Lean model inside Docker; nothing is installed on the host.
#   formal/run.sh build     build the image, fetch mathlib's cache, lake build
#   formal/run.sh vectors   also regenerate the Go golden vectors
#   formal/run.sh shell     a shell in the container
#   formal/run.sh clean     remove the image and the volumes
set -eu

IMAGE=mhj-dojo-lean
VOLUMES="mhj-dojo-lean-elan mhj-dojo-lean-lake mhj-dojo-lean-cache"
repo=$(cd "$(dirname "$0")/.." && pwd)

# run [-it] CMD runs CMD in the container. It runs as root, which owns the
# volumes; files it writes into the repository (the vectors) are handed back
# to the calling user, which matters on Linux.
run() {
	interactive=
	if [ "$1" = -it ]; then
		interactive=-it
		shift
	fi
	# shellcheck disable=SC2086
	docker run --rm $interactive \
		-v "$repo":/work \
		-v mhj-dojo-lean-elan:/root/.elan \
		-v mhj-dojo-lean-lake:/work/formal/.lake \
		-v mhj-dojo-lean-cache:/root/.cache \
		-w /work/formal "$IMAGE" sh -c "$1"
}

image() { docker build -q -t "$IMAGE" "$repo/formal" >/dev/null; }

# Fetch the prebuilt mathlib files for only the modules the model imports
# (and their imports), not all of mathlib: that keeps the volumes small.
CACHE='mods=$(grep -hs "^import Mathlib" *.lean MhjDojo/*.lean | sed "s/^import //" | sort -u)
if [ -n "$mods" ]; then lake exe cache get $mods; fi'

case "${1:-build}" in
build)
	image
	run "$CACHE && lake build"
	;;
vectors)
	image
	run "$CACHE && lake build && lake exe gen-vectors /work &&
		chown $(id -u):$(id -g) /work/internal/score/testdata/lean_*.json /work/internal/game/testdata/lean_*.json \
			/work/internal/yaku/testdata/lean_*.json"
	;;
shell)
	image
	run -it bash
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

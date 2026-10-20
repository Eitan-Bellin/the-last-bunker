#!/usr/bin/env bash
# [phase4b] Agent D: after-sims on a snapshot of HEAD + D's files. Usage: bash D-run.sh <tag> [modes...]
set -e
cd "$(dirname "$0")/../../.."
TAG=${1:-after}; shift || true
MODES=${*:-engaged casual neglect}
bash store/playthrough/phase4b/D-mksrc.sh > /dev/null
rm -rf "store/playthrough/phase4b/D-src-$TAG" && cp -r store/playthrough/phase4b/D-src-mine "store/playthrough/phase4b/D-src-$TAG"
for m in $MODES; do
  node tools/sim/run.mjs --mode "$m" --days 14 --seeds 1-3 --jobs 3 --src "store/playthrough/phase4b/D-src-$TAG" --json "store/playthrough/phase4b/D-$TAG-$m.json" --quiet
done
echo "done $TAG"

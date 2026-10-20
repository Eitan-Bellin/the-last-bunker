#!/usr/bin/env bash
# [phase4b] Agent D: a src snapshot of HEAD plus only Agent D's files (to measure D's effect apart from Agent O's work in progress).
set -e
cd "$(dirname "$0")/../../.."
OUT=store/playthrough/phase4b/D-src-mine
rm -rf "$OUT" && mkdir -p "$OUT"
git archive HEAD src | tar -x -C "$OUT" --strip-components=1
for f in src/systems/EventSystem.ts src/systems/ThreatSystem.ts src/systems/AwayDanger.ts src/systems/ForemanSystem.ts \
  src/systems/IncidentSystem.ts src/systems/DeathSystem.ts src/data/incidents.ts src/data/difficulty.ts src/ui/controllers/danger.ts \
  src/ui/HUD.ts src/styles/hud.css src/styles/p4b-d.css src/ui/components/ExposureGauge.ts src/ui/components/ExposureSheet.ts \
  src/ui/components/ExposureForeman.ts; do
  [ -f "$f" ] && mkdir -p "$OUT/$(dirname "${f#src/}")" && cp "$f" "$OUT/${f#src/}"
done
cp -r src/core/. "$OUT/core/"
echo "snapshot in $OUT"

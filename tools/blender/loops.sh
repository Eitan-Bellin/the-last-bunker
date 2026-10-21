#!/bin/sh
# Renders the motion loop of every room (or the ones given) and packs it into public/art/v2/<room>/
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOMS=${*:-"farm hydroponics seedLab componentsPlant alloyFoundry dataCenter reactor"}
for r in $ROOMS; do
  script=tools/blender/room_$r.py; [ "$r" = surface ] && script=tools/blender/surface.py
  rm -f art-src/v2/$r/f_*.png
  echo "== $r $(date +%T)"; "$B" -b -P $script -- "$(pwd)/art-src/v2/$r" --frames 16 2>&1 | grep -E "Error|Traceback" | head -5
  python tools/v2pack.py art-src/v2/$r public/art/v2/$r
done
echo "ALL DONE $(date +%T)"

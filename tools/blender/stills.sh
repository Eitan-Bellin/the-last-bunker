#!/bin/sh
# Test still of every room (or the ones given): art-src/v2/<room>/still.png
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOMS=${*:-"farm hydroponics seedLab componentsPlant alloyFoundry dataCenter reactor"}
for r in $ROOMS; do echo "== $r"; "$B" -b -P tools/blender/room_$r.py -- "$(pwd)/art-src/v2/$r" --still 2>&1 | grep -E "Error|Traceback|line [0-9]+|Saved" | head -6; done

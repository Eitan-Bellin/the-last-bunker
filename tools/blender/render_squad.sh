#!/bin/sh
# Renders the battle looks (squad v4 v5, raiders v6 v7) into art-src/v2/people/<variant>/ and repacks every look
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
for v in 4 5 6 7; do "$B" -b -P tools/blender/worker.py -- "$(pwd)/art-src/v2/people" --variant $v 2>&1 | grep -E "DONE|Error|Traceback"; done
python tools/v2people.py

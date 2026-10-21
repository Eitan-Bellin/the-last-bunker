#!/bin/sh
# Renders every worker variant (all animations) into art-src/v2/people/<variant>/
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
for v in 0 1 2 3; do "$B" -b -P tools/blender/worker.py -- "$(pwd)/art-src/v2/people" --variant $v 2>&1 | grep -E "DONE|Error|Traceback"; done

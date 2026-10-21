# v2 floor 7: the data center. Rows of server racks with blinking status LEDs, a big cooling fan spinning in the back
# wall, tape-drive reels turning, an operator desk with live monitors, cable trays and the drop crate.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

out, FR, still = args()
sc = reset()
shell(wall=(0.16, 0.18, 0.21), floor=(0.13, 0.14, 0.16))
rackm = mat('rack', (0.08, 0.09, 0.10), metal=0.6, rough=0.45, grime=0.3)
steel = mat('steel', (0.4, 0.42, 0.45), metal=0.9, rough=0.3, grime=0.3)
dark = mat('dark', (0.03, 0.03, 0.035), metal=0.4, rough=0.5)
# racks on both sides, each with unit faces and LEDs
for side, xs in (('L', (0.45, 1.25, 2.05)), ('R', (7.1, 7.9, 8.7))):
    for i, rx in enumerate(xs):
        box(f'rack{side}{i}', (rx, 2.5, 1.25), (0.75, 0.9, 2.5), rackm, 0.02)
        for u in range(10):
            box(f'unit{side}{i}{u}', (rx, 2.04, 0.3 + u * 0.21), (0.66, 0.02, 0.17), mat('unit', (0.15, 0.16, 0.17), metal=0.5, rough=0.4, grime=0.2), 0.005)
        leds(f'led{side}{i}', rx - 0.28, rx + 0.28, 0.25, 2.3, 2.02, 40, FR)
        point((rx, 1.6, 1.3), 6, (0.3, 1.0, 0.5), 0.5)
# big cooling fan in the back wall (frosted vent around it)
box('vent_frame', (4.6, 3.05, 3.0), (1.6, 0.1, 1.6), steel, 0.03)
fan('coolfan', (4.6, 2.95, 3.0), 0.68, FR, turns=0.8, blades=5)
frost = mat('frost', (0.75, 0.85, 0.95), rough=0.6, emit=(0.4, 0.55, 0.7), emit_strength=0.4)
for i in range(16):
    sphere(f'ice{i}', (3.85 + random.random() * 1.5, 2.98, 2.22 + random.random() * 0.06), 0.025, frost, scale=(1, 0.5, 2.4))
# tape drive with two turning reels
box('tape_cab', (3.1, 2.6, 1.05), (0.9, 0.7, 2.1), mat('tape_cab', (0.45, 0.45, 0.42), rough=0.5, grime=0.3), 0.02)
for k, rz in enumerate((1.55, 1.0)):
    reel = empty(f'reel{k}', (3.1, 2.24, rz))
    cyl(f'reel_d{k}', (0, 0, 0), 0.2, 0.03, steel, rot=(math.pi / 2, 0, 0), parent=reel)
    cyl(f'reel_t{k}', (0, 0, 0), 0.14, 0.035, mat('tape', (0.12, 0.08, 0.05), rough=0.4), rot=(math.pi / 2, 0, 0), parent=reel)
    for s_ in range(3):
        a = s_ * 2 * math.pi / 3
        box(f'reel_s{k}{s_}', (math.cos(a) * 0.1, -0.02, math.sin(a) * 0.1), (0.13, 0.01, 0.03), dark, 0, rot=(0, -a, 0), parent=reel)
    spin(reel, 'y', (1 if k == 0 else -1) * (2 / 3), FR)
# operator desk with monitors
box('desk', (5.0, 1.9, 0.78), (2.0, 0.8, 0.06), mat('desk', (0.25, 0.25, 0.26), metal=0.3, rough=0.5), 0.01)
for k in (-1, 1):
    box(f'desk_leg{k}', (5.0 + k * 0.9, 1.9, 0.38), (0.06, 0.7, 0.76), steel, 0.01)
screen('mon1', (4.6, 2.2, 1.15), (0.6, 0.38), (0.25, 0.85, 1.0), FR)
screen('mon2', (5.4, 2.2, 1.15), (0.6, 0.38), (0.35, 1.0, 0.55), FR)
box('chair', (5.0, 1.35, 0.5), (0.5, 0.5, 0.08), dark, 0.03)
# cable trays overhead
box('tray', (4.6, 2.0, 3.9), (9.4, 0.4, 0.06), steel, 0.01)
for i in range(6):
    pipe(f'cab{i}', [(0, 1.88 + i * 0.05, 3.95), (9.8, 1.88 + i * 0.05, 3.95)], 0.02, mat(f'cab_c{i % 3}', [(0.1, 0.3, 0.7), (0.7, 0.5, 0.1), (0.1, 0.1, 0.1)][i % 3], rough=0.5))
box('crate', (9.25, 0.75, 0.35), (0.9, 0.7, 0.7), mat('crate_w', (0.45, 0.32, 0.18), rough=0.75, grime=0.4, scale=12), 0.03)
for lx in (2.0, 5.0, 8.0):
    lamp_fixture(lx, 4.0, y=0.9, energy=240, color=(0.8, 0.9, 1.0))
area((5, -2, 3.5), 50, 6, (0.45, 0.6, 0.9), rot=(math.radians(70), 0, 0))
post()
camera()
render(out, FR, still)

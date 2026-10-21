# v2 floor 2: the potato farm. Soil beds under grow lights, an irrigation gantry that travels along its rail spraying,
# swaying plants, spinning ventilation fans, a dripping water line and the drop crate by the shaft door.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

out, FR, still = args()
sc = reset()
shell(wall=(0.25, 0.27, 0.22), floor=(0.17, 0.15, 0.12))
soil = mat('soil', (0.16, 0.10, 0.06), rough=0.95, grime=0.5, scale=25, bump=0.6)
wood = mat('wood', (0.38, 0.25, 0.13), rough=0.8, grime=0.5, scale=10, bump=0.2)
leaf = mat('leaf', (0.16, 0.38, 0.10), rough=0.55, grime=0.35, scale=8)
leaf2 = mat('leaf2', (0.24, 0.45, 0.12), rough=0.55, grime=0.35, scale=8)
steel = mat('steel', (0.35, 0.36, 0.37), metal=0.9, rough=0.35, grime=0.35)
white = mat('white_pipe', (0.75, 0.74, 0.7), rough=0.4, grime=0.3)
potato = mat('potato', (0.55, 0.40, 0.22), rough=0.8, grime=0.4, scale=20, bump=0.3)
# two rows of raised beds (back and middle)
for row, (y, z) in enumerate(((2.45, 0.85), (1.45, 0.35))):
    box(f'bed{row}', (4.4, y, z / 2), (8.2, 0.75, z), wood, 0.02)
    box(f'soil{row}', (4.4, y, z + 0.01), (8.0, 0.68, 0.06), soil, 0)
    for i in range(26):
        plant(f'p{row}_{i}', (0.5 + i * 0.31 + random.random() * 0.06, y + (random.random() - 0.5) * 0.3, z), 1.0 + random.random() * 0.5,
              random.choice((leaf, leaf2)), FR, sway=0.0, phase=random.random())
# grow lights: emissive bars with a faint magenta glow
for row, y in enumerate((2.4, 1.45)):
    for i in range(4):
        gx = 1.2 + i * 2.1
        m, s = emissive(f'grow{row}{i}', (1.0, 0.7, 0.9), 9)
        box(f'growbar{row}{i}', (gx, y, 3.1 + row * 0.25), (1.6, 0.12, 0.05), m, 0.01)
        cyl(f'growwire{row}{i}', (gx, y, 3.6 + row * 0.12), 0.006, 1.0, steel)
        area((gx, y, 3.0 + row * 0.25), 28, 1.2, (1.0, 0.72, 0.9), rot=(0, 0, 0))
# irrigation gantry: a rail across the room and a sprayer carriage gliding back and forth
box('rail', (4.4, 1.9, 3.45), (8.6, 0.12, 0.1), steel, 0.01)
carriage = empty('carriage', (4.4, 1.9, 3.35))
box('car_body', (0, 0, 0), (0.45, 0.35, 0.22), mat('car_paint', (0.62, 0.48, 0.1), metal=0.3, rough=0.45, grime=0.4), 0.02, parent=carriage)
cyl('spray_pipe', (0, 0, -0.55), 0.03, 1.0, white, parent=carriage)
box('spray_bar', (0, 0, -1.05), (0.08, 1.6, 0.06), white, 0.01, parent=carriage)
wm = mat('spray', (0.6, 0.8, 1.0), rough=0.05, emit=(0.5, 0.7, 1), emit_strength=0.8)
for j in range(5):
    for k in range(3):
        d = sphere(f'spr{j}{k}', (0, -0.7 + j * 0.35, -1.1), 0.018, wm, parent=carriage)
        key_linear(d, 'location[2]', [(f, -1.1 - 1.4 * (((f - 1) / FR + k / 3) % 1) ** 2) for f in range(1, FR + 2)])
wobble(carriage, 'location[0]', 4.4, 3.2, FR, cycles=1)
# fans in the back wall
fan('fanA', (1.0, 3.05, 2.4), 0.45, FR, turns=1)
fan('fanB', (7.9, 3.05, 2.4), 0.45, FR, turns=1)
# dripping water line
pipe('waterline', [(0, 2.95, 3.0), (9.8, 2.95, 3.0)], 0.05, white)
for x in (2.9, 5.6):
    drops(f'drip{x}', x, 2.9, 2.95, 0.5, FR, n=2)
# harvest: sacks and a potato pile near the crate
for i in range(30):
    sphere(f'pot{i}', (8.6 + random.random() * 0.5, 0.9 + random.random() * 0.4, 0.06 + random.random() * 0.15), 0.06, potato, scale=(1.3, 1, 0.9))
for i in range(3):
    sphere(f'sack{i}', (7.9 + i * 0.35, 2.85, 0.3), 0.28, mat('sack', (0.55, 0.45, 0.30), rough=0.95, grime=0.4, scale=30, bump=0.4), scale=(0.9, 0.8, 1.2))
box('crate', (9.25, 0.75, 0.35), (0.9, 0.7, 0.7), wood, 0.03)
for lx in (1.4, 5.0, 8.6):
    lamp_fixture(lx, 4.0, y=0.9, energy=500)
area((5, -2, 3.5), 60, 6, (0.55, 0.65, 0.85), rot=(math.radians(70), 0, 0))
post()
camera()
render(out, FR, still)

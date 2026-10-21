# v2 floor 3: hydroponics. White racks of leafy greens in PVC channels, nutrient water running through clear tubes
# (moving bubbles), a pump with a spinning flywheel, an aerated tank, LED strips and the drop crate.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

out, FR, still = args()
sc = reset()
shell(wall=(0.55, 0.57, 0.55), floor=(0.36, 0.37, 0.36))
pvc = mat('pvc', (0.85, 0.86, 0.84), rough=0.35, grime=0.25, scale=6)
steel = mat('steel', (0.55, 0.56, 0.57), metal=0.9, rough=0.3, grime=0.2)
leaf = mat('leaf', (0.22, 0.52, 0.14), rough=0.5, grime=0.3, scale=8)
leaf2 = mat('leaf2', (0.35, 0.58, 0.16), rough=0.5, grime=0.3, scale=8)
red = mat('redleaf', (0.42, 0.12, 0.14), rough=0.5, grime=0.3, scale=8)
glass = glass_mat()
for r, x in enumerate((2.2, 5.6)):
    rack_shelf(f'rack{r}', x, 2.3, 3.0, 0.6, 3, 0.85, steel)
    for lv in range(3):
        z = 0.42 + lv * 0.85
        cyl(f'chan{r}{lv}', (x, 2.3, z + 0.06), 0.08, 2.9, pvc, rot=(0, math.pi / 2, 0))
        for i in range(10):
            rosette(f'g{r}{lv}{i}', (x - 1.35 + i * 0.3, 2.3, z + 0.1), 1.25 + random.random() * 0.3,
                  random.choice((leaf, leaf2, leaf, red)), FR, sway=0.0, phase=random.random())
        m, s = emissive(f'led{r}{lv}', (0.92, 0.95, 1.0), 7)
        box(f'ledbar{r}{lv}', (x, 2.25, z + 0.72), (2.8, 0.06, 0.03), m, 0.005)
    area((x, 2.0, 3.0), 120, 2.5, (0.9, 0.95, 1.0))
# clear return tube with flowing bubbles along the front of the racks
tube_y = 1.85
pipe('tube', [(0.4, tube_y, 0.25), (7.4, tube_y, 0.25)], 0.06, glass)
bm = mat('bubble', (0.9, 1, 1), rough=0.05, emit=(0.6, 0.85, 1), emit_strength=0.8)
SP = 0.35
for i in range(20):
    o = sphere(f'flow{i}', (0, tube_y, 0.25), 0.025, bm)
    key_linear(o, 'location[0]', [(f, 0.4 + ((i * SP + 2 * SP * (f - 1) / FR) % (7.0))) for f in range(1, FR + 2)])
# pump with a spinning flywheel and the nutrient tank with rising bubbles
box('pump', (8.0, 1.6, 0.35), (0.8, 0.6, 0.7), mat('pump_paint', (0.2, 0.42, 0.6), metal=0.4, rough=0.4, grime=0.3), 0.04)
fw = empty('flywheel', (8.0, 1.27, 0.45))
cyl('fw_disk', (0, 0, 0), 0.26, 0.05, steel, rot=(math.pi / 2, 0, 0), parent=fw)
for k in range(5):
    a = k * 2 * math.pi / 5
    box(f'fw_sp{k}', (math.cos(a) * 0.13, -0.03, math.sin(a) * 0.13), (0.26, 0.02, 0.035), mat('fw_dark', (0.1, 0.1, 0.1)), 0, rot=(0, -a, 0), parent=fw)
spin(fw, 'y', 1, FR)
cyl('tank', (8.4, 2.6, 0.75), 0.45, 1.5, glass)
cyl('tank_water', (8.4, 2.6, 0.65), 0.42, 1.25, mat('nutrient', (0.35, 0.6, 0.35), rough=0.1, emit=(0.2, 0.5, 0.3), emit_strength=0.3))
bubbles('tb', 8.15, 8.65, 2.18, 0.1, 1.25, FR, n=12)
pipe('feed', [(8.0, 1.6, 0.7), (8.0, 1.6, 3.6), (0.4, 1.6, 3.6), (0.4, 1.9, 0.25)], 0.04, pvc)
box('crate', (9.25, 0.75, 0.35), (0.9, 0.7, 0.7), mat('crate_w', (0.5, 0.36, 0.2), rough=0.75, grime=0.4, scale=12), 0.03)
for lx in (1.4, 5.0, 8.6):
    lamp_fixture(lx, 4.0, y=0.9, energy=320, color=(0.95, 0.97, 1.0))
area((5, -2, 3.5), 80, 6, (0.7, 0.8, 0.95), rot=(math.radians(70), 0, 0))
post()
camera()
render(out, FR, still)

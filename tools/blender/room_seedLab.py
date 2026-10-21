# v2 floor 4: the seed lab. Glowing seed fridges, a spinning centrifuge, a robotic arm moving a sample tray, monitors with
# live graphs, terrarium domes with seedlings, a cryo tank venting vapour and the drop crate.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

out, FR, still = args()
sc = reset()
shell(wall=(0.30, 0.36, 0.36), floor=(0.22, 0.25, 0.25))
steel = mat('steel', (0.55, 0.57, 0.58), metal=0.9, rough=0.28, grime=0.2)
white = mat('lab_white', (0.78, 0.8, 0.8), rough=0.35, grime=0.2, scale=5)
dark = mat('dark', (0.06, 0.07, 0.07), metal=0.4, rough=0.5)
orange = mat('arm_o', (0.85, 0.45, 0.1), metal=0.3, rough=0.4)
glass = glass_mat()
leaf = mat('leaf', (0.25, 0.55, 0.18), rough=0.5)
jar_cols = [mat('jar_a', (0.7, 0.55, 0.2), rough=0.4), mat('jar_b', (0.4, 0.6, 0.25), rough=0.4), mat('jar_c', (0.6, 0.3, 0.2), rough=0.4)]

# seed fridges with glowing shelves of jars
for k, fx in enumerate((0.75, 1.85)):
    box(f'fridge{k}', (fx, 2.55, 1.15), (1.0, 0.7, 2.3), white, 0.03)
    m, s = emissive(f'fglow{k}', (0.45, 0.95, 1.0), 2.5)
    anim_value(s, FR, lambda t, k=k: 2.5 + 0.4 * math.sin(2 * math.pi * (t + k * 0.3)))
    box(f'fwin{k}', (fx, 2.19, 1.2), (0.8, 0.02, 1.9), m, 0)
    for r in range(5):
        for c in range(5):
            cyl(f'jar{k}{r}{c}', (fx - 0.3 + c * 0.15, 2.15, 0.45 + r * 0.38), 0.045, 0.14, jar_cols[(r + c) % 3])
    point((fx, 1.9, 1.2), 40, (0.5, 0.95, 1.0), 0.3)

# lab bench: centrifuge, monitors, robot arm
box('bench', (5.2, 2.2, 0.9), (3.6, 0.9, 0.08), white, 0.01)
box('bench_base', (5.2, 2.2, 0.43), (3.5, 0.85, 0.86), mat('cab', (0.55, 0.6, 0.6), rough=0.5, grime=0.3), 0.02)
cyl('centri_base', (3.9, 2.1, 1.05), 0.28, 0.22, white)
rot_ = empty('centri_rot', (3.9, 2.1, 1.2))
vial_m = mat('vial', (0.9, 0.4, 0.2), rough=0.2, emit=(0.8, 0.3, 0.1), emit_strength=0.6)
for k in range(6):
    a = k * math.pi / 3
    o = cyl(f'vial{k}', (math.cos(a) * 0.18, math.sin(a) * 0.18, 0.02), 0.03, 0.12, vial_m, parent=rot_)
    o.rotation_euler = (0.4 * math.sin(a), -0.4 * math.cos(a), 0)
cyl('rotor', (0, 0, 0), 0.22, 0.04, steel, parent=rot_)
spin(rot_, 'z', 2, FR)
screen('monA', (4.8, 2.6, 1.45), (0.7, 0.42), (0.3, 1.0, 0.6), FR)
screen('monB', (5.6, 2.6, 1.45), (0.7, 0.42), (0.4, 0.8, 1.0), FR)
cyl('arm_base', (6.6, 2.1, 1.0), 0.15, 0.12, dark)
sh = empty('arm_sh', (6.6, 2.1, 1.08))
sh.scale = (2.0, 2.0, 2.0)
box('arm_up', (0, 0, 0.25), (0.08, 0.08, 0.5), orange, 0.02, parent=sh)
el = empty('arm_el', (0, 0, 0.5), sh)
box('arm_fo', (0.2, 0, 0), (0.4, 0.07, 0.07), orange, 0.02, parent=el)
box('arm_tray', (0.42, 0, -0.05), (0.18, 0.14, 0.03), steel, 0.005, parent=el)
wobble(sh, 'rotation_euler[2]', 0, 0.9, FR, cycles=1)
wobble(sh, 'rotation_euler[1]', 0.25, 0.2, FR, cycles=2)
wobble(el, 'rotation_euler[1]', 0.3, 0.35, FR, cycles=2, phase=0.25)

# terrarium domes with seedlings
for i, dx in enumerate((7.6, 8.3)):
    cyl(f'dome_base{i}', (dx, 2.3, 0.95), 0.28, 0.06, dark)
    sphere(f'dome{i}', (dx, 2.3, 0.98), 0.27, glass, scale=(1, 1, 1.1))
    plant(f'seedl{i}', (dx, 2.3, 0.98), 0.45, leaf, FR, sway=0.05, phase=i * 0.4)
    point((dx, 2.1, 1.25), 25, (0.6, 1.0, 0.7), 0.1)

# cryo tank venting vapour puffs
cyl('cryo', (9.2, 2.6, 0.75), 0.35, 1.5, steel)
vap = smoke_mat('vapour', (0.85, 0.93, 1.0), 0.2, 0.3)
for k in range(8):
    o = sphere(f'vap{k}', (9.2, 2.3, 1.55), 0.06, vap)
    for f in range(1, FR + 2):
        t = ((f - 1) / FR + k / 8) % 1
        o.location = (9.2, 2.3, 1.55 + 0.9 * t)
        o.scale = (0.5 + 2.5 * t, 0.5 + 2.5 * t, 0.5 + 2 * t)
        o.keyframe_insert('location', frame=f)
        o.keyframe_insert('scale', frame=f)

dress_wall(2.6, 9.6, seed=5)
# microscope and beakers on the bench
cyl('scope_base', (4.5, 2.0, 0.97), 0.1, 0.05, dark)
box('scope_arm', (4.5, 2.05, 1.15), (0.05, 0.05, 0.35), dark, 0.01, rot=(0.3, 0, 0))
cyl('scope_tube', (4.5, 1.98, 1.3), 0.03, 0.2, steel, rot=(0.5, 0, 0))
for i in range(5):
    cyl(f'beaker{i}', (6.0 + i * 0.12, 1.95, 1.0), 0.04, 0.12, glass)
    cyl(f'liquid{i}', (6.0 + i * 0.12, 1.95, 0.98), 0.036, 0.07, mat(f'liq{i}', [(0.2, 0.7, 0.3), (0.7, 0.3, 0.1), (0.2, 0.4, 0.8)][i % 3], rough=0.1, emit=[(0.1, 0.5, 0.2), (0.5, 0.2, 0.05), (0.1, 0.2, 0.5)][i % 3], emit_strength=0.6))
box('crate', (9.25, 0.75, 0.35), (0.9, 0.7, 0.7), mat('crate_w', (0.5, 0.36, 0.2), rough=0.75, grime=0.4, scale=12), 0.03)
for lx in (1.4, 5.0, 8.6):
    lamp_fixture(lx, 4.0, y=0.9, energy=330, color=(0.85, 0.95, 1.0))
area((5, -2, 3.5), 70, 6, (0.6, 0.75, 0.9), rot=(math.radians(70), 0, 0))
post()
camera()
render(out, FR, still)

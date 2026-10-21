# v2 floor 6: the alloy foundry. Two brick furnaces with flickering fire and real firelight, a crane ladle that tilts and
# pours a molten stream into moulds, glowing ingots riding a conveyor and cooling, embers rising, hoods and the crate.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

out, FR, still = args()
sc = reset()
shell(wall=(0.22, 0.18, 0.15), floor=(0.17, 0.15, 0.13))
brick = brick_mat()
steel = mat('steel', (0.3, 0.3, 0.31), metal=0.9, rough=0.4, grime=0.5)
dark = mat('dark', (0.04, 0.04, 0.04), metal=0.5, rough=0.6)
soot = mat('soot', (0.08, 0.07, 0.06), metal=0.6, rough=0.7, grime=0.5)

# furnaces: brick bodies, an opening with fire inside, firelight that flickers
for k, fx in enumerate((1.4, 7.3)):
    box(f'furn{k}', (fx, 2.2, 1.0), (1.9, 1.3, 2.0), brick, 0.04)
    box(f'mouth{k}', (fx, 1.54, 0.9), (0.9, 0.04, 0.7), dark, 0.02)
    fire_m, fire_s = emissive(f'fire{k}', (1.0, 0.3, 0.03), 5)
    anim_value(fire_s, FR, lambda t, k=k: 4.5 + 2 * math.sin(2 * math.pi * (3 * t + k * 0.37)) + 1.2 * math.sin(2 * math.pi * (5 * t + 0.2)))
    coal = emissive(f'coal{k}', (1.0, 0.35, 0.05), 3)[0]
    for c in range(10):
        sphere(f'coal{k}{c}', (fx - 0.35 + c * 0.075, 1.62, 0.6 + random.random() * 0.08), 0.05, coal, scale=(1, 0.8, 0.6))
    flame = emissive(f'flame{k}', (1.0, 0.45, 0.06), 6)[0]
    for c in range(6):
        o = sphere(f'fl{k}{c}', (fx, 1.62, 0.7), 0.09, flame, scale=(1, 0.6, 1.8))
        ph = random.random(); dx = (c - 2.5) * 0.12
        for f in range(1, FR + 2):
            t = ((f - 1) / FR * 2 + ph) % 1
            o.location = (fx + dx + 0.03 * math.sin(t * 9), 1.62, 0.68 + 0.4 * t)
            o.scale = ((1 - t) + 0.15, 0.6 * (1 - t) + 0.1, 1.8 * (1 - t) + 0.2)
            o.keyframe_insert('location', frame=f)
            o.keyframe_insert('scale', frame=f)
    box(f'fireplane{k}', (fx, 1.58, 0.85), (0.82, 0.02, 0.6), fire_m, 0)
    bpy.ops.object.light_add(type='POINT', location=(fx, 1.05, 0.85))
    L = bpy.context.object
    L.data.color = (1.0, 0.45, 0.12)
    L.data.shadow_soft_size = 0.4
    for f in range(1, FR + 2):
        t = (f - 1) / FR
        L.data.energy = 260 + 80 * math.sin(2 * math.pi * (3 * t + k * 0.37)) + 40 * math.sin(2 * math.pi * (5 * t))
        L.data.keyframe_insert('energy', frame=f)
    pipe(f'hood{k}', [(fx, 2.2, 2.0), (fx, 2.2, 4.6)], 0.35, soot)
    ember = mat('ember', (1, 0.6, 0.2), emit=(1, 0.5, 0.1), emit_strength=20)
    for e in range(8):
        o = sphere(f'emb{k}{e}', (fx, 1.45, 1.2), 0.012, ember)
        ph = random.random()
        dx = random.uniform(-0.3, 0.3)
        for f in range(1, FR + 2):
            t = ((f - 1) / FR + ph) % 1
            o.location = (fx + dx * t + 0.05 * math.sin(t * 12), 1.4, 1.2 + 1.6 * t)
            o.keyframe_insert('location', frame=f)

# crane ladle: tilts to pour (frames 0.35..0.75 of the loop), stream visible while pouring
box('crane_rail', (4.3, 1.9, 4.2), (3.4, 0.25, 0.18), mat('crane_y', (0.62, 0.45, 0.08), metal=0.3, rough=0.5, grime=0.5), 0.02)
cyl('ladle_cable', (4.3, 1.9, 3.5), 0.02, 1.3, dark)
lad = empty('ladle', (4.3, 1.9, 2.75))
cyl('ladle_cup', (0, 0, -0.25), 0.36, 0.55, soot, parent=lad)
molten_m, molten_s = emissive('molten', (1.0, 0.42, 0.05), 6)
cyl('ladle_metal', (0, 0, 0.0), 0.33, 0.04, molten_m, parent=lad)
box('ladle_bail', (0, 0, 0.3), (0.8, 0.06, 0.06), dark, 0.01, parent=lad)
tilt = []
for f in range(1, FR + 2):
    t = (f - 1) / FR
    k = max(0.0, math.sin(math.pi * (t - 0.25) / 0.6)) if 0.25 <= t <= 0.85 else 0.0
    tilt.append((f, -0.75 * k))
key_linear(lad, 'rotation_euler[1]', tilt)
stream = cyl('stream', (4.72, 1.9, 1.75), 0.04, 1.4, molten_m)
for f, v in tilt:
    stream.hide_render = v > -0.45
    stream.keyframe_insert('hide_render', frame=f)
for fc in fcurves(stream.animation_data.action):
    for kp in fc.keyframe_points:
        kp.interpolation = 'CONSTANT'
bpy.ops.object.light_add(type='POINT', location=(4.7, 1.5, 1.4))
pour = bpy.context.object
pour.data.color = (1, 0.5, 0.1)
for f, v in tilt:
    pour.data.energy = 250 * min(1, -v / 0.6)
    pour.data.keyframe_insert('energy', frame=f)

# moulds and an ingot conveyor (ingots cool from bright to dark as they ride right)
box('mould_table', (4.8, 1.9, 0.5), (1.4, 0.9, 1.0), steel, 0.02)
box('ingot_conv', (6.0, 1.0, 0.45), (5.2, 0.55, 0.08), dark, 0.01)
for k in range(4):
    box(f'ic_leg{k}', (3.6 + k * 1.6, 1.0, 0.22), (0.08, 0.45, 0.45), steel, 0.01)
SP = 0.8
cool = [emissive(f'ingot{c}', (1.0, 0.4 - c * 0.05, 0.05), 4 * (1 - c / 6) ** 2)[0] for c in range(7)]
for i in range(6):
    o = box(f'ing{i}', (0, 1.0, 0.56), (0.42, 0.24, 0.12), cool[0], 0.02)
    for c in cool[1:]:
        o.data.materials.append(c)
    xs = []
    for f in range(1, FR + 2):
        x = 3.6 + ((i * SP + SP * (f - 1) / FR) % (6 * SP))
        xs.append((f, x))
    key_linear(o, 'location[0]', xs)
    for f, x in xs:
        o.pass_index = 0
    # material by position: step through cooling materials using an object colour cannot vary per frame here, so
    # the ingots keep their glow; the stack at the end of the line is dark
for i in range(6):
    box(f'stack{i}', (8.6 + (i % 3) * 0.45, 2.7, 0.07 + (i // 3) * 0.13), (0.42, 0.24, 0.12), mat('ingot_cold', (0.45, 0.44, 0.42), metal=1, rough=0.35), 0.02)
dress_wall(2.6, 6.3, seed=9)
box('crate', (9.25, 0.75, 0.35), (0.9, 0.7, 0.7), mat('crate_w', (0.45, 0.30, 0.16), rough=0.75, grime=0.5, scale=12), 0.03)
for lx in (3.0, 6.0):
    lamp_fixture(lx, 4.0, y=0.9, energy=320)
area((5, -2, 3.5), 40, 6, (0.5, 0.6, 0.8), rot=(math.radians(70), 0, 0))
post()
camera()
render(out, FR, still)

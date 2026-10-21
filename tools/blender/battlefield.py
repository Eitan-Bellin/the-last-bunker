# v2 battlefield: a raider camp on open ground, rendered in separate transparent layers so the game can swap states:
#   ground (dirt, ruts, rubble, our sandbags on the right), camp (tents, crates, barrels, a fire pit),
#   tower / tower_broken (the raiders' watchtower), wall / wall_broken (their scrap barricade).
# 720 x 360 game units (13.33 x 6.67 m at 54 u/m), 2 px per unit; the camera matches the 3D rooms (7 degrees down).
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from lib import *
import lib

out, FR, still = args()
sc = reset()
W_M, H_M = 720 / 54, 360 / 54
sc.render.resolution_x, sc.render.resolution_y = 1440, 720
sc.render.film_transparent = True
lib.ROOM_W = W_M
lib.BAND_ASPECT = 2.0
lib.FLOOR_FROM_BOTTOM = 1.2
sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.5, 0.4, 1)
sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.9

layers = {}


def layer(name):
    col = bpy.data.collections.new(name)
    sc.collection.children.link(col)
    layers[name] = col
    lc = bpy.context.view_layer.layer_collection.children[name]
    bpy.context.view_layer.active_layer_collection = lc
    return col


dirt = mat('dirt', (0.20, 0.16, 0.10), rough=0.95, grime=0.55, scale=3, bump=0.7)
rubble = mat('rubble', (0.33, 0.30, 0.26), rough=0.9, grime=0.5, scale=8, bump=0.4)
rust = mat('rust', (0.27, 0.16, 0.09), metal=0.6, rough=0.7, grime=0.55, scale=8, bump=0.35)
steel = mat('steel', (0.3, 0.3, 0.29), metal=0.85, rough=0.45, grime=0.5)
wood = mat('wood', (0.26, 0.17, 0.09), rough=0.85, grime=0.55, scale=10, bump=0.3)
canvas = mat('canvas', (0.30, 0.26, 0.17), rough=0.95, grime=0.5, scale=12, bump=0.3)
sand = mat('sandbag', (0.36, 0.31, 0.21), rough=0.95, grime=0.4, scale=20, bump=0.4)
dark = mat('dark', (0.05, 0.05, 0.05), rough=0.6)

# ---- ground ----
layer('ground')
box('ground', (W_M / 2, 4, -0.1), (40, 12, 0.2), dirt, 0)
for i in range(60):
    scrap_piece(f'rb{i}', (random.uniform(-1, W_M + 1), random.uniform(0.0, 9), 0.03), random.uniform(0.06, 0.22), rubble, kind='lump')
for k in range(3):  # tyre ruts
    box(f'rut{k}', (W_M / 2, 1.0 + k * 0.5, 0.004), (W_M + 4, 0.12, 0.01), mat('rut', (0.14, 0.11, 0.07), rough=1.0), 0)
# our sandbag line on the right
for r in range(2):
    for i in range(6):
        sphere(f'sb{r}{i}', (11.0 + i * 0.36 + r * 0.18, 1.4, 0.16 + r * 0.26), 0.2, sand, scale=(1.0, 0.75, 0.6))

# ---- camp decor (static) ----
layer('camp')
for k, (tx, ty) in enumerate(((1.0, 4.5), (3.6, 5.2))):
    # a ridge tent: a square prism turned 45 degrees and half sunk into the ground
    t = cyl(f'tent{k}', (tx, ty, 0.55), 1.1, 2.4, canvas, rot=(math.pi / 2, -math.pi / 2, 0), verts=3)
    for f in t.data.polygons:
        f.use_smooth = False
    pipe(f'tentpole{k}', [(tx - 1.15, ty, 0), (tx - 1.15, ty, 1.0)], 0.03, wood)
for i in range(5):
    box(f'cr{i}', (2.2 + i * 0.55, 3.2 + (i % 2) * 0.4, 0.25), (0.5, 0.5, 0.5), wood, 0.02)
for i in range(4):
    cyl(f'bar{i}', (5.6 + i * 0.6, 3.6, 0.45), 0.28, 0.9, rust)
cyl('firepit', (4.6, 2.2, 0.08), 0.45, 0.16, rubble)
fm, fs = emissive('fire', (1, 0.4, 0.05), 5)
for k in range(4):
    sphere(f'flame{k}', (4.6 + (k - 1.5) * 0.12, 2.2, 0.3 + (k % 2) * 0.1), 0.14, fm, scale=(1, 1, 1.8))
point((4.6, 1.9, 0.6), 150, (1, 0.5, 0.15), 0.3)
pipe('flagpole', [(0.4, 2.6, 0), (0.4, 2.6, 4.5)], 0.035, steel)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0.85, 2.6, 4.15), rotation=(math.pi / 2, 0, 0))
fl = bpy.context.object
fl.scale = (0.9, 0.55, 1)
fl.data.materials.append(mat('flag', (0.45, 0.06, 0.04), rough=0.8))

# ---- watchtower (intact / broken) ----
def tower(broken):
    tx = 1.6
    legs = [(tx - 0.8, 2.0), (tx + 0.8, 2.0), (tx - 0.8, 3.0), (tx + 0.8, 3.0)]
    H = 4.2
    for i, (lx, ly) in enumerate(legs):
        tilt = (0.35 if i % 2 else -0.12) if broken else 0
        box(f'tl{i}', (lx, ly, H / 2), (0.14, 0.14, H), wood, 0.01, rot=(0, tilt, 0))
    for z in (1.2, 2.4):
        box('tb', (tx, 2.0, z), (1.7, 0.08, 0.1), wood, 0.005, rot=(0, 0.2 if broken else 0, 0))
        box('tx', (tx, 2.0, z + 0.6), (0.08, 0.08, 1.5), wood, 0.005, rot=(0, 0.9, 0))
    if broken:
        box('deck_b', (tx + 0.9, 2.5, 0.25), (2.0, 1.4, 0.12), wood, 0.01, rot=(0.2, 0.5, 0.3))
        for i in range(14):
            box(f'plank{i}', (tx + random.uniform(-1.2, 2.4), random.uniform(1.6, 3.2), 0.05), (random.uniform(0.4, 1.0), 0.12, 0.05), wood, 0, rot=(0, 0, random.uniform(0, 3)))
        smoke = smoke_mat('smk', (0.25, 0.24, 0.23), 0.5, 0.05)
        for i in range(6):
            sphere(f'sm{i}', (tx + random.uniform(-0.6, 1.4), 2.4, 0.6 + i * 0.5), 0.35 + i * 0.12, smoke)
    else:
        box('deck', (tx, 2.5, H), (2.0, 1.4, 0.12), wood, 0.01)
        for s_ in (-1, 1):
            box('rail', (tx + s_ * 0.95, 2.5, H + 0.45), (0.06, 1.4, 0.8), rust, 0.005)
        box('rail_f', (tx, 1.82, H + 0.45), (2.0, 0.06, 0.8), rust, 0.005)
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.45, depth=0.8, location=(tx, 2.5, H + 1.35), rotation=(0, 0, math.pi / 4))
        bpy.context.object.data.materials.append(rust)
        lm, _ = emissive('tower_lamp', (1, 0.75, 0.4), 8)
        sphere('tlamp', (tx, 1.9, H + 0.9), 0.07, lm)
        point((tx, 1.6, H + 0.8), 60, (1, 0.7, 0.4), 0.1)


layer('tower')
tower(False)
layer('tower_broken')
tower(True)

# ---- barricade (intact / broken) ----
def wall(broken):
    wx = 5.2
    for i in range(7):
        h = random.uniform(0.9, 1.4) * (0.35 if broken and i % 2 else 1)
        rot_ = (random.uniform(-0.15, 0.15), random.uniform(-0.25, 0.25) + (0.6 if broken and i % 3 == 0 else 0), random.uniform(-0.2, 0.2))
        box(f'sheet{i}', (wx + (i - 3) * 0.32, 1.9 + random.uniform(-0.1, 0.1), h / 2), (0.36, 0.05, h), random.choice((rust, steel)), 0.01, rot=rot_)
    for i in range(3):
        for k in range(2 if not broken else 1):
            bpy.ops.mesh.primitive_torus_add(major_radius=0.28, minor_radius=0.1, location=(wx - 1.0 + i * 1.0, 1.7, 0.1 + k * 0.2))
            bpy.context.object.data.materials.append(dark)
    if broken:
        for i in range(12):
            scrap_piece(f'wd{i}', (wx + random.uniform(-1.4, 1.6), random.uniform(1.2, 2.4), 0.05), random.uniform(0.1, 0.2), random.choice((rust, steel)))


random.seed(5)
layer('wall')
wall(False)
random.seed(5)
layer('wall_broken')
wall(True)

bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), math.radians(-30), math.radians(-25)))
sun = bpy.context.object
sun.data.energy = 1.3
sun.data.color = (1, 0.8, 0.6)
area((W_M / 2, -4, 6), 150, 10, (0.6, 0.7, 0.9), rot=(math.radians(60), 0, 0))
camera()
os.makedirs(out, exist_ok=True)
lights = [o for o in sc.objects if o.type == 'LIGHT']
for name, col in layers.items():
    for n2, c2 in layers.items():
        c2.hide_render = n2 != name
    sc.render.filepath = os.path.join(out, f'{name}.png')
    bpy.ops.render.render(write_still=True)
print('DONE battlefield')

# v2 surface: the mine headframe (lattice tower with a spinning sheave wheel) over the shaft, the winding house with its
# gate (the depot), a market of three stalls with flapping awnings and a fire barrel; the painted ruined city behind.
# 13.33 m across (720 game units at 54 u/m), 8.7 m tall (470 units); ground line 0.15 m above the bottom edge.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from lib import *
import lib

out, FR, still = args()
sc = reset()
SW, SH = 720 / 54, 470 / 54
sc.render.resolution_x, sc.render.resolution_y = 1440, 940
lib.ROOM_W = SW
lib.BAND_ASPECT = 720 / 470
lib.FLOOR_FROM_BOTTOM = 0.15
sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.45, 0.35, 1)
sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.8

# painted backdrop far behind (emission so the scene lights do not touch it)
backdrop = os.path.abspath('public/art/backdrops/surface-1.webp')
img = bpy.data.images.load(backdrop)
bm = bpy.data.materials.new('backdrop')
bm.use_nodes = True
nt = bm.node_tree
for n in list(nt.nodes):
    if n.type == 'BSDF_PRINCIPLED':
        nt.nodes.remove(n)
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = img
em = nt.nodes.new('ShaderNodeEmission')
em.inputs['Strength'].default_value = 0.85
nt.links.new(tex.outputs['Color'], em.inputs['Color'])
nt.links.new(em.outputs['Emission'], nt.nodes['Material Output'].inputs['Surface'])
bpy.ops.mesh.primitive_plane_add(size=1, location=(SW / 2 - 1.5, 30, 6.5), rotation=(math.pi / 2, 0, 0))
bp = bpy.context.object
bp.scale = (34, 17.2, 1)
bp.data.materials.append(bm)

ground = mat('dirt', (0.30, 0.24, 0.17), rough=0.95, grime=0.5, scale=4, bump=0.5)
box('ground', (SW / 2, 10, -0.1), (60, 24, 0.2), ground, 0)
rock = mat('rubble', (0.35, 0.32, 0.28), rough=0.9, grime=0.5, scale=8, bump=0.4)
for i in range(40):
    scrap_piece(f'rub{i}', (random.uniform(-1, SW + 1), random.uniform(1.5, 8), 0.05), random.uniform(0.08, 0.3), rock, kind='lump')

steel = mat('steel', (0.32, 0.31, 0.29), metal=0.85, rough=0.45, grime=0.5)
rustm = mat('rust', (0.40, 0.22, 0.12), metal=0.6, rough=0.7, grime=0.5, scale=8, bump=0.3)
concrete = mat('concrete', (0.42, 0.40, 0.36), rough=0.9, grime=0.5, scale=3, bump=0.3)
dark = mat('dark', (0.05, 0.05, 0.05), metal=0.4, rough=0.6)

# ---- headframe: four legs, braces, top deck, sheave wheel ----
TX, TD = 11.85, 2.2   # tower centre x, depth (y)
legs = [(TX - 1.1, TD - 0.8), (TX + 1.1, TD - 0.8), (TX - 1.1, TD + 0.8), (TX + 1.1, TD + 0.8)]
H = 5.5
for i, (lx, ly) in enumerate(legs):
    box(f'leg{i}', (lx + (TX - lx) * 0.12, ly, H / 2), (0.16, 0.16, H), rustm, 0.01, rot=(0, math.atan2(TX - lx, H) * 0.24, 0))
for z in (1.4, 2.8, 4.2):
    for (ax, ay), (bx, by) in ((legs[0], legs[1]), (legs[2], legs[3]), (legs[0], legs[2]), (legs[1], legs[3])):
        box('brace', ((ax + bx) / 2, (ay + by) / 2, z), (abs(bx - ax) * 0.95 + 0.1, abs(by - ay) * 0.95 + 0.1, 0.1), steel, 0.005)
    # diagonals on the front face
    box('diag', (TX, TD - 0.8, z + 0.7), (0.08, 0.08, 2.2), steel, 0.005, rot=(0, 0.8, 0))
    box('diag2', (TX, TD - 0.8, z + 0.7), (0.08, 0.08, 2.2), steel, 0.005, rot=(0, -0.8, 0))
box('deck', (TX, TD, H), (2.6, 2.0, 0.15), steel, 0.01)
for k in (-1, 1):
    box(f'rail{k}', (TX, TD + k * 0.95, H + 0.5), (2.6, 0.05, 0.05), steel, 0)
wheel = empty('sheave', (TX, TD - 0.4, H + 1.1))
R = 1.0
cyl('rim', (0, 0, 0), R, 0.12, dark, rot=(math.pi / 2, 0, 0), verts=48)
bpy.context.object.parent = wheel
bpy.context.object.location = (0, 0, 0)
cyl('rim_in', (0, 0, 0), R * 0.86, 0.14, mat('hole', (0.02, 0.02, 0.02)), rot=(math.pi / 2, 0, 0), verts=48, parent=wheel)
for k in range(8):
    a = k * math.pi / 4
    box(f'spoke{k}', (math.cos(a) * R * 0.45, -0.08, math.sin(a) * R * 0.45), (R * 0.9, 0.05, 0.07), rustm, 0.005, rot=(0, -a, 0), parent=wheel)
cyl('hub', (0, -0.1, 0), 0.14, 0.18, steel, rot=(math.pi / 2, 0, 0), parent=wheel)
spin(wheel, 'y', -1 / 8, FR)   # one spoke step per loop: seamless
box('axle_post', (TX, TD - 0.2, H + 0.55), (0.2, 0.2, 1.1), steel, 0.01)
pipe('cable2', [(TX - R * 0.95, TD - 0.4, H + 1.1), (TX - 3.2, TD - 0.4, 2.4)], 0.025, dark)
# shaft collar at the ground
box('collar', (TX, TD - 0.6, 0.1), (2.8, 1.6, 0.2), concrete, 0.02)

# ---- winding house (the depot) with its gate ----
HX = 9.0
box('house', (HX, 2.6, 1.6), (3.2, 2.4, 3.2), concrete, 0.04)
box('roof', (HX, 2.6, 3.3), (3.5, 2.7, 0.2), rustm, 0.02)
box('gate', (HX + 0.3, 1.39, 1.15), (1.8, 0.05, 2.2), mat('gate', (0.38, 0.30, 0.22), metal=0.4, rough=0.6, grime=0.6, scale=6, bump=0.2), 0.01)
for k in (-1, 1):
    box(f'gate_x{k}', (HX + 0.3, 1.36, 1.15), (0.08, 0.03, 2.6), steel, 0, rot=(0, 0.7 * k, 0))
pipe('chimney', [(HX - 1.1, 2.9, 3.2), (HX - 1.1, 2.9, 4.6)], 0.16, rustm)
smoke = smoke_mat('smoke', (0.3, 0.29, 0.28), 0.35, 0.05)
for k in range(5):
    o = sphere(f'smk{k}', (HX - 1.1, 2.9, 4.7), 0.15, smoke)
    for f in range(1, FR + 2):
        t = ((f - 1) / FR + k / 5) % 1
        o.location = (HX - 1.1 + 0.9 * t, 2.9, 4.7 + 1.6 * t)
        o.scale = (0.6 + 2.6 * t,) * 3
        o.keyframe_insert('location', frame=f)
        o.keyframe_insert('scale', frame=f)
lamp_m, _ = emissive('gate_lamp', (1, 0.75, 0.4), 12)
sphere('gate_lamp', (HX + 0.3, 1.3, 2.55), 0.08, lamp_m)
point((HX + 0.3, 1.0, 2.4), 120, (1, 0.7, 0.4), 0.2)

# ---- market: three stalls with flapping awnings, goods, a fire barrel ----
cloths = [mat('cloth_r', (0.55, 0.16, 0.10), rough=0.9, grime=0.4, scale=20, bump=0.2), mat('cloth_y', (0.70, 0.52, 0.18), rough=0.9, grime=0.4, scale=20, bump=0.2), mat('cloth_b', (0.18, 0.30, 0.45), rough=0.9, grime=0.4, scale=20, bump=0.2)]
wood = mat('wood', (0.40, 0.27, 0.15), rough=0.8, grime=0.5, scale=10, bump=0.2)
for k, sx in enumerate((1.4, 3.5, 5.6)):
    for px in (sx - 0.85, sx + 0.85):
        for py in (1.6, 2.6):
            box('pole', (px, py, 1.1), (0.08, 0.08, 2.2), wood, 0.005)
    box(f'table{k}', (sx, 1.8, 0.75), (1.8, 0.7, 0.08), wood, 0.01)
    box(f'tbase{k}', (sx, 1.8, 0.37), (1.7, 0.6, 0.72), wood, 0.01)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(sx, 2.1, 2.3))
    aw = bpy.context.object
    aw.scale = (1.0, 0.65, 1)
    aw.rotation_euler = (0.25, 0, 0)
    sub_ = aw.modifiers.new('sub', 'SUBSURF'); sub_.levels = 3; sub_.subdivision_type = 'SIMPLE'
    wav = aw.modifiers.new('wave', 'WAVE')
    wav.height = 0.06
    wav.width = 0.6
    wav.speed = 0.6 / (FR / 1.0)
    wav.use_normal = False
    wav.time_offset = 0
    wav.narrowness = 1.5
    aw.data.materials.append(cloths[k])
    so = aw.modifiers.new('thick', 'SOLIDIFY'); so.thickness = 0.02
    for i in range(8):
        it = random.choice(('crate', 'sack', 'jar'))
        ix = sx - 0.7 + i * 0.2
        if it == 'crate':
            box('goods', (ix, 1.75, 0.88), (0.18, 0.2, 0.16), wood, 0.01)
        elif it == 'sack':
            sphere('goods', (ix, 1.75, 0.9), 0.1, mat('sack', (0.55, 0.45, 0.3), rough=0.95), scale=(1, 1, 1.2))
        else:
            cyl('goods', (ix, 1.75, 0.9), 0.05, 0.16, mat('jar', (0.5, 0.6, 0.3), rough=0.3))
    lm, _ = emissive(f'stall_lamp{k}', (1, 0.8, 0.5), 10)
    sphere(f'slamp{k}', (sx, 1.7, 2.05), 0.06, lm)
    point((sx, 1.4, 1.9), 60, (1, 0.75, 0.45), 0.15)
for i in range(4):
    cyl(f'barrel{i}', (0.4 + i * 0.25 * (i % 2) + 6.6 + (i // 2) * 0.6, 2.3 + (i % 2) * 0.5, 0.45), 0.28, 0.9, rustm)
cyl('firebarrel', (7.1, 1.3, 0.45), 0.3, 0.9, rustm)
fm, fs = emissive('fire', (1, 0.45, 0.08), 20)
anim_value(fs, FR, lambda t: 18 + 8 * math.sin(2 * math.pi * 3 * t) + 4 * math.sin(2 * math.pi * 5 * t + 1))
for k in range(5):
    o = sphere(f'flame{k}', (7.1, 1.3, 0.95), 0.12, fm, scale=(1, 1, 1.6))
    for f in range(1, FR + 2):
        t = ((f - 1) / FR + k / 5) % 1
        o.location = (7.1 + 0.06 * math.sin(2 * math.pi * (t + k / 5)), 1.3, 0.92 + 0.45 * t)
        o.scale = ((1 - t) * 1.0 + 0.1,) * 2 + ((1 - t) * 1.6 + 0.1,)
        o.keyframe_insert('location', frame=f)
        o.keyframe_insert('scale', frame=f)
bpy.ops.object.light_add(type='POINT', location=(7.1, 1.0, 1.3))
fl = bpy.context.object
fl.data.color = (1, 0.5, 0.15)
for f in range(1, FR + 2):
    t = (f - 1) / FR
    fl.data.energy = 220 + 70 * math.sin(2 * math.pi * 3 * t) + 40 * math.sin(2 * math.pi * 5 * t + 1)
    fl.data.keyframe_insert('energy', frame=f)

# evening sun from the left, sky fill
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(55), math.radians(-35), math.radians(-20)))
sun = bpy.context.object
sun.data.energy = 3.2
sun.data.color = (1, 0.78, 0.55)
sun.data.angle = math.radians(4)
area((SW / 2, -4, 6), 300, 10, (0.6, 0.7, 0.9), rot=(math.radians(60), 0, 0))
post()
camera()
render(out, FR, still)

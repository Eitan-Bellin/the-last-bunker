# v2 workers: one continuous body mesh (skin modifier over a skeleton graph), a real armature with automatic weights,
# clothing by region, a modelled head with hair/hat, held props; poses set by code per frame; 3/4 profile renders with
# transparent background:
#   blender -b -P tools/blender/worker.py -- <out_dir> [--variant 0..3] [--anims walk,idle] [--still] [--big]
import sys, os, math, json
sys.path.insert(0, os.path.dirname(__file__))
from lib import *
from mathutils import Matrix, Quaternion
from bpy_extras.object_utils import world_to_camera_view

a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = a[0] if a else os.path.abspath('art-src/v2/people')
VAR = int(a[a.index('--variant') + 1]) if '--variant' in a else 0
ONLY = a[a.index('--anims') + 1].split(',') if '--anims' in a else None
STILL = '--still' in a
FR = 12
RES = (384, 480) if '--big' in a else (128, 160)

VARIANTS = [
    dict(name='v0', shirt=(0.30, 0.28, 0.26), pants=(0.13, 0.15, 0.19), skin=(0.72, 0.50, 0.38), hat='hard', hat_c=(0.80, 0.55, 0.05), hair=(0.10, 0.07, 0.05), w=1.0, beard=False, vest=True),
    dict(name='v1', shirt=(0.16, 0.26, 0.40), pants=(0.16, 0.25, 0.38), skin=(0.55, 0.36, 0.25), hat='cap', hat_c=(0.50, 0.10, 0.08), hair=(0.05, 0.035, 0.03), w=0.88, beard=False, vest=False, bun=True),
    dict(name='v2', shirt=(0.22, 0.28, 0.17), pants=(0.24, 0.20, 0.15), skin=(0.80, 0.60, 0.47), hat='hard', hat_c=(0.82, 0.82, 0.78), hair=(0.32, 0.20, 0.10), w=1.07, beard=True, vest=False),
    dict(name='v3', shirt=(0.40, 0.36, 0.32), pants=(0.15, 0.14, 0.13), skin=(0.36, 0.24, 0.17), hat=None, hat_c=(0, 0, 0), hair=(0.55, 0.53, 0.50), w=0.97, beard=True, vest=True),
    # battle: the squad (v4, v5) and the raiders (v6, v7)
    dict(name='v4', shirt=(0.22, 0.25, 0.15), pants=(0.19, 0.21, 0.14), skin=(0.70, 0.50, 0.38), hat='helmet', hat_c=(0.20, 0.23, 0.14), hair=(0.1, 0.07, 0.05), w=1.05, beard=False, vest=True, vest_c=(0.16, 0.17, 0.12), battle=True),
    dict(name='v5', shirt=(0.36, 0.31, 0.21), pants=(0.27, 0.24, 0.17), skin=(0.48, 0.32, 0.22), hat='helmet', hat_c=(0.30, 0.27, 0.18), hair=(0.05, 0.04, 0.03), w=1.0, beard=False, vest=True, vest_c=(0.22, 0.2, 0.14), mask='gas', battle=True),
    dict(name='v6', shirt=(0.42, 0.10, 0.07), pants=(0.20, 0.14, 0.10), skin=(0.78, 0.58, 0.45), hat='band', hat_c=(0.6, 0.08, 0.05), hair=(0.12, 0.08, 0.05), w=1.02, beard=True, vest=False, spikes=True, battle=True),
    dict(name='v7', shirt=(0.16, 0.15, 0.15), pants=(0.12, 0.11, 0.10), skin=(0.60, 0.42, 0.30), hat='hood', hat_c=(0.16, 0.15, 0.15), hair=(0.05, 0.05, 0.05), w=0.98, beard=False, vest=False, mask='skull', spikes=True, battle=True),
]
V = VARIANTS[VAR]
W = V['w']

sc = reset()
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.film_transparent = True
try:
    sc.view_settings.look = 'AgX - Punchy'
    sc.view_settings.exposure = 0.0
except Exception:
    pass
sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.3

cloth = lambda n, c: mat(n, c, rough=0.9, grime=0.3, scale=60, bump=0.2)
SHIRT, PANTS = cloth('shirt', V['shirt']), cloth('pants', V['pants'])
SKIN = mat('skin', V['skin'], rough=0.5)
try:
    p = SKIN.node_tree.nodes['Principled BSDF']
    p.inputs['Subsurface Weight'].default_value = 0.2
    p.inputs['Subsurface Radius'].default_value = (0.9, 0.35, 0.2)
    p.inputs['Subsurface Scale'].default_value = 0.01
except Exception:
    pass
BOOT = mat('boot', (0.09, 0.07, 0.05), rough=0.55, grime=0.3, scale=30)
GLOVE = mat('glove', (0.30, 0.22, 0.13), rough=0.85, grime=0.3, scale=40)
HAIR = mat('hair', V['hair'], rough=0.65, grime=0.4, scale=200, bump=0.4)
HAT = mat('hat', V['hat_c'], metal=0.05, rough=0.3, grime=0.25, scale=8)
EYE = mat('eye', (0.02, 0.02, 0.02), rough=0.2)
VEST = mat('vest', V.get('vest_c', (0.90, 0.42, 0.04)), rough=0.7, grime=0.25, scale=40)
STRIPE = mat('reflect', (0.85, 0.85, 0.82), metal=0.7, rough=0.25)
BELT = mat('belt', (0.07, 0.06, 0.05), rough=0.45)
TOOL = mat('tool', (0.45, 0.46, 0.48), metal=0.9, rough=0.3)
WOOD = mat('handle', (0.42, 0.28, 0.15), rough=0.7)
CRATE = mat('crate_w', (0.48, 0.32, 0.17), rough=0.75, grime=0.45, scale=15, bump=0.25)

# ---- the body: skeleton graph -> skin modifier -> smooth mesh ----
# (name, position, radius depth/width) ; the character faces +x, y is to its left, z up
P = {
    'pelvis': ((0, 0, 0.95), (0.125, 0.175 * W)),
    'waist': ((0.005, 0, 1.08), (0.125, 0.165 * W)),
    'chest': ((0.01, 0, 1.27), (0.14, 0.2 * W)),
    'upper': ((0.0, 0, 1.40), (0.13, 0.21 * W)),
    'neck': ((0.01, 0, 1.50), (0.055, 0.055)),
    'neckTop': ((0.015, 0, 1.56), (0.05, 0.05)),
}
for s, sy in (('L', 1), ('R', -1)):
    P.update({
        f'sh{s}': ((0, sy * 0.2 * W, 1.405), (0.072, 0.072)),
        f'el{s}': ((0, sy * 0.23 * W, 1.12), (0.056, 0.056)),
        f'wr{s}': ((0.01, sy * 0.235 * W, 0.88), (0.04, 0.044)),
        f'fi{s}': ((0.02, sy * 0.235 * W, 0.79), (0.03, 0.046)),
        f'hp{s}': ((0, sy * 0.1 * W, 0.93), (0.1, 0.1)),
        f'kn{s}': ((0.01, sy * 0.095 * W, 0.50), (0.07, 0.072)),
        f'an{s}': ((-0.01, sy * 0.09 * W, 0.09), (0.052, 0.052)),
        f'to{s}': ((0.18, sy * 0.09 * W, 0.045), (0.045, 0.06)),
    })
E = [('pelvis', 'waist'), ('waist', 'chest'), ('chest', 'upper'), ('upper', 'neck'), ('neck', 'neckTop')]
for s in 'LR':
    E += [('upper', f'sh{s}'), (f'sh{s}', f'el{s}'), (f'el{s}', f'wr{s}'), (f'wr{s}', f'fi{s}'),
          ('pelvis', f'hp{s}'), (f'hp{s}', f'kn{s}'), (f'kn{s}', f'an{s}'), (f'an{s}', f'to{s}')]
names = list(P)
me = bpy.data.meshes.new('body')
me.from_pydata([P[n][0] for n in names], [(names.index(x), names.index(y)) for x, y in E], [])
body = bpy.data.objects.new('body', me)
bpy.context.collection.objects.link(body)
bpy.context.view_layer.objects.active = body
body.select_set(True)
skin = body.modifiers.new('skin', 'SKIN')
for i, n in enumerate(names):
    me.skin_vertices[0].data[i].radius = P[n][1]
me.skin_vertices[0].data[names.index('pelvis')].use_root = True
sub = body.modifiers.new('sub', 'SUBSURF')
sub.levels = sub.render_levels = 2
bpy.ops.object.modifier_apply(modifier='skin')
bpy.ops.object.modifier_apply(modifier='sub')
for f in me.polygons:
    f.use_smooth = True

# clothing by region
for m_ in (SHIRT, PANTS, SKIN, BOOT, GLOVE, VEST, STRIPE, BELT):
    me.materials.append(m_)
MI = {m_.name: i for i, m_ in enumerate(me.materials)}
for f in me.polygons:
    c = body.matrix_world @ f.center
    side = abs(c.y)
    if c.z < 0.16:
        f.material_index = MI['boot']
    elif c.z < 0.97 and side < 0.2 * W:
        f.material_index = MI['belt'] if 0.93 < c.z < 0.99 else MI['pants']
    elif c.z < 0.93 and side > 0.205 * W:
        f.material_index = MI['glove']
    elif c.z > 1.47:
        f.material_index = MI['skin']
    elif V['vest'] and side < 0.17 * W and 0.99 < c.z < 1.44:
        f.material_index = MI['reflect'] if (not V.get('battle') and (1.15 < c.z < 1.19 or 1.32 < c.z < 1.36)) else MI['vest']
    else:
        f.material_index = MI['shirt']

# ---- armature ----
arm_d = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('rig', arm_d)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
B = {}


def bone(name, h, t, parent=None):
    eb = arm_d.edit_bones.new(name)
    eb.head, eb.tail = Vector(h), Vector(t)
    eb.roll = 0
    if parent:
        eb.parent = arm_d.edit_bones[parent]
        eb.use_connect = False
    return eb


bone('hips', P['pelvis'][0], P['waist'][0])
bone('spine', P['waist'][0], P['chest'][0], 'hips')
bone('chest', P['chest'][0], P['upper'][0], 'spine')
bone('neck', P['upper'][0], P['neckTop'][0], 'chest')
bone('head', P['neckTop'][0], (0.015, 0, 1.80), 'neck')
for s in 'LR':
    bone(f'sh{s}', P['upper'][0], P[f'sh{s}'][0], 'chest')
    bone(f'uarm{s}', P[f'sh{s}'][0], P[f'el{s}'][0], f'sh{s}')
    bone(f'farm{s}', P[f'el{s}'][0], P[f'wr{s}'][0], f'uarm{s}')
    bone(f'hand{s}', P[f'wr{s}'][0], P[f'fi{s}'][0], f'farm{s}')
    bone(f'thigh{s}', P[f'hp{s}'][0], P[f'kn{s}'][0], 'hips')
    bone(f'shin{s}', P[f'kn{s}'][0], P[f'an{s}'][0], f'thigh{s}')
    bone(f'foot{s}', P[f'an{s}'][0], P[f'to{s}'][0], f'shin{s}')
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')


def attach(o, bone_name):
    """Rigidly attaches a mesh to a bone (keeps its world placement)."""
    mw = o.matrix_world.copy()
    o.parent = rig
    o.parent_type = 'BONE'
    o.parent_bone = bone_name
    bpy.context.view_layer.update()
    o.matrix_world = mw
    return o


# ---- head ----
HZ = 1.66
skull = sphere('skull', (0.02, 0, HZ), 0.1, SKIN, scale=(1.05, 0.88, 1.16))
jaw = sphere('jaw', (0.05, 0, HZ - 0.06), 0.065, SKIN, scale=(1.0, 1.05, 0.8))
nose = sphere('nose', (0.122, 0, HZ - 0.005), 0.02, SKIN, scale=(1.2, 0.8, 1.3))
parts = [skull, jaw, nose]
for s_ in (-1, 1):
    parts.append(sphere('eye', (0.1, s_ * 0.034, HZ + 0.025), 0.012, EYE))
    parts.append(sphere('brow', (0.106, s_ * 0.036, HZ + 0.05), 0.016, HAIR, scale=(0.6, 1.4, 0.4)))
    parts.append(sphere('ear', (0.0, s_ * 0.088, HZ + 0.0), 0.026, SKIN, scale=(0.55, 0.4, 1.0)))
if V['beard']:
    parts.append(sphere('beard', (0.075, 0, HZ - 0.07), 0.062, HAIR, scale=(0.95, 1.15, 0.85)))
parts.append(sphere('hair', (0.0, 0, HZ + 0.035), 0.104, HAIR, scale=(1.06, 0.92, 1.05)))
if V.get('bun'):
    parts.append(sphere('bun', (-0.1, 0, HZ + 0.07), 0.042, HAIR))
if V['hat'] == 'hard':
    parts.append(sphere('hardhat', (0.01, 0, HZ + 0.075), 0.118, HAT, scale=(1.08, 1.0, 0.78)))
    parts.append(cyl('brim', (0.03, 0, HZ + 0.045), 0.14, 0.012, HAT))
    parts.append(box('ridge', (0.01, 0, HZ + 0.16), (0.2, 0.02, 0.02), HAT, 0.008))
elif V['hat'] == 'helmet':
    parts.append(sphere('helmet', (0.0, 0, HZ + 0.06), 0.125, HAT, scale=(1.1, 1.05, 0.82)))
    parts.append(cyl('helm_rim', (0.0, 0, HZ + 0.02), 0.135, 0.02, HAT))
elif V['hat'] == 'band':
    parts.append(cyl('bandana', (0.0, 0, HZ + 0.07), 0.108, 0.04, HAT))
    parts.append(box('band_tail', (-0.12, 0, HZ + 0.04), (0.04, 0.03, 0.12), HAT, 0.005, rot=(0, 0.4, 0)))
elif V['hat'] == 'hood':
    parts.append(sphere('hood', (-0.015, 0, HZ + 0.02), 0.13, HAT, scale=(1.1, 1.0, 1.15)))
if V.get('mask') == 'gas':
    gm = mat('gasmask', (0.08, 0.08, 0.08), rough=0.5)
    parts.append(sphere('gasmask', (0.08, 0, HZ - 0.02), 0.07, gm, scale=(0.9, 1.0, 1.0)))
    parts.append(cyl('filter', (0.14, 0, HZ - 0.05), 0.03, 0.06, mat('filter', (0.3, 0.3, 0.28), metal=0.6, rough=0.4), rot=(0, math.pi / 2, 0)))
    parts.append(sphere('goggle', (0.1, 0.035, HZ + 0.025), 0.022, mat('lens', (0.1, 0.15, 0.12), metal=0.5, rough=0.1)))
    parts.append(sphere('goggle2', (0.1, -0.035, HZ + 0.025), 0.022, mat('lens', (0.1, 0.15, 0.12), metal=0.5, rough=0.1)))
elif V.get('mask') == 'skull':
    parts.append(sphere('skullmask', (0.075, 0, HZ + 0.0), 0.08, mat('skullm', (0.85, 0.82, 0.74), rough=0.5), scale=(0.8, 1.0, 1.15)))
    for s_ in (-1, 1):
        parts.append(sphere('socket', (0.13, s_ * 0.032, HZ + 0.02), 0.018, EYE))
elif V['hat'] == 'cap':
    parts.append(sphere('cap', (0.0, 0, HZ + 0.07), 0.108, HAT, scale=(1.05, 0.96, 0.7)))
    parts.append(box('peak', (0.12, 0, HZ + 0.06), (0.1, 0.15, 0.012), HAT, 0.005))
for o in parts:
    attach(o, 'head')

# ---- props ----
props = {}


def prop(name, objs, bone_name):
    for o in objs:
        attach(o, bone_name)
    props[name] = objs


wrR = P['wrR'][0]
prop('hammer', [cyl('h_handle', (wrR[0] + 0.02, wrR[1], wrR[2] - 0.07), 0.013, 0.34, WOOD, rot=(0, math.pi / 2, 0)),
                box('h_head', (wrR[0] + 0.2, wrR[1], wrR[2] - 0.07), (0.05, 0.05, 0.14), TOOL, 0.006)], 'handR')
prop('wrench', [box('w_bar', (wrR[0] + 0.1, wrR[1], wrR[2] - 0.07), (0.24, 0.02, 0.035), TOOL, 0.005)], 'handR')
prop('can', [cyl('can_b', (wrR[0] + 0.05, wrR[1], wrR[2] - 0.14), 0.065, 0.15, mat('can_m', (0.25, 0.4, 0.28), metal=0.6, rough=0.4)),
             cyl('spout', (wrR[0] + 0.16, wrR[1], wrR[2] - 0.12), 0.012, 0.16, mat('can_m2', (0.25, 0.4, 0.28), metal=0.6, rough=0.4), rot=(0, 1.0, 0))], 'handR')
wrL = P['wrL'][0]
prop('clip', [box('cb', (wrL[0] + 0.06, wrL[1], wrL[2] - 0.06), (0.02, 0.17, 0.24), mat('cb_m', (0.85, 0.82, 0.72), rough=0.6), 0.004)], 'handL')
GUNM = mat('gun', (0.07, 0.07, 0.07), metal=0.7, rough=0.4)
prop('rifle', [box('r_body', (wrR[0] + 0.0, wrR[1], wrR[2] - 0.12), (0.06, 0.04, 0.42), GUNM, 0.006),
               box('r_stock', (wrR[0] - 0.02, wrR[1], wrR[2] + 0.12), (0.07, 0.04, 0.2), mat('stock', (0.3, 0.2, 0.1), rough=0.6), 0.006),
               cyl('r_barrel', (wrR[0] + 0.01, wrR[1], wrR[2] - 0.46), 0.012, 0.3, GUNM),
               box('r_mag', (wrR[0] + 0.05, wrR[1], wrR[2] - 0.1), (0.07, 0.03, 0.05), GUNM, 0.004)], 'handR')
if V.get('spikes'):
    for s_ in (-1, 1):
        for k in range(3):
            o = bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.025, depth=0.09, location=(-0.02 + k * 0.03, s_ * 0.2 * W, 1.47))
            attach(bpy.context.object, f'sh{"L" if s_ > 0 else "R"}')
            bpy.context.object.data.materials.append(mat('spike', (0.5, 0.48, 0.45), metal=0.9, rough=0.3))
crate_o = box('c_box', (0.33, 0, 1.08), (0.34, 0.36, 0.27), CRATE, 0.015)
props['crate'] = [crate_o]

rig.rotation_euler = (0, 0, math.radians(-28))  # 3/4: a profile turned toward the camera
for o in [crate_o]:
    o.parent = rig

# ---- posing: rotations about the body's lateral axis (+ = swing back), plus abduction and twist ----
D = math.radians
pb = rig.pose.bones
for p_ in pb:
    p_.rotation_mode = 'QUATERNION'


def rot(name, y=0.0, x=0.0, z=0.0):
    """Rotation given in armature axes (y = lateral swing, x = sideways, z = twist), expressed in the bone's rest frame."""
    bn = arm_d.bones[name]
    m = bn.matrix_local.to_3x3()
    r = Matrix.Rotation(z, 3, 'Z') @ Matrix.Rotation(y, 3, 'Y') @ Matrix.Rotation(x, 3, 'X')
    pb[name].rotation_quaternion = (m.inverted() @ r @ m).to_quaternion()


def pose_reset():
    for p_ in pb:
        p_.rotation_quaternion = Quaternion()
        p_.location = (0, 0, 0)
    crate_o.location = (0.33, 0, 1.08)


def drop(dz):
    pb['hips'].location = (0, 0, 0)
    # hips bone points up (+z), so its local y is world z
    pb['hips'].location = (0, dz, 0)


def legs_walk(ph):
    for side in 'LR':
        p = ph if side == 'L' else ph + math.pi
        sw = math.sin(p)
        knee = max(0.0, math.sin(p + math.pi / 2)) ** 2
        rot(f'thigh{side}', y=-D(25) * sw)
        rot(f'shin{side}', y=D(6) + D(55) * knee)
        rot(f'foot{side}', y=-D(12) * sw)


def walk(t, carry=False):
    ph = 2 * math.pi * t
    legs_walk(ph)
    for side, s in (('L', 1), ('R', -1)):
        p = ph + (math.pi if side == 'L' else 0)
        if carry:
            rot(f'uarm{side}', y=-D(55), x=s * D(-10))
            rot(f'farm{side}', y=-D(60))
        else:
            sw = math.sin(p)
            rot(f'uarm{side}', y=D(20) * sw, x=s * D(-6))
            rot(f'farm{side}', y=-D(15) - D(12) * max(0, sw))
    drop(-0.03 + 0.03 * abs(math.cos(ph)))
    rot('hips', z=D(5) * math.sin(ph))
    rot('spine', y=D(3 if not carry else -3))
    rot('chest', z=-D(7) * math.sin(ph))
    if carry:
        crate_o.location = (0.36, 0, 1.06 - 0.03 + 0.03 * abs(math.cos(ph)))


def stand(t, lean=0.0):
    br = math.sin(2 * math.pi * t)
    drop(0.004 * br)
    rot('spine', y=D(lean))
    rot('chest', y=D(1.5) * br)
    for side, s in (('L', 1), ('R', -1)):
        rot(f'uarm{side}', x=s * D(-4))
        rot(f'farm{side}', y=-D(10))


def anim_idle(t):
    stand(t)
    rot('head', z=D(14) * math.sin(2 * math.pi * t))
    rot('uarmL', y=D(3) * math.sin(2 * math.pi * t), x=-D(5))


def anim_hammer(t):
    stand(t, 10)
    if t < 0.6:
        a = -D(140) * (0.5 - 0.5 * math.cos(math.pi * t / 0.6))
    elif t < 0.75:
        k = (t - 0.6) / 0.15
        a = -D(140) + D(150) * k * k
    else:
        a = D(10) * (1 - (t - 0.75) / 0.25)
    rot('uarmR', y=a - D(25), x=D(8))
    rot('farmR', y=-D(35) - D(30) * (1 - abs(a) / D(140)))
    rot('handR', y=-D(20))
    rot('uarmL', y=-D(45), x=-D(12))
    rot('farmL', y=-D(60))
    rot('chest', y=D(6) + (D(10) if 0.6 <= t < 0.8 else 0))


def anim_lift(t):
    k = 0.5 - 0.5 * math.cos(2 * math.pi * t)
    drop(-0.26 * k)
    for side, s in (('L', 1), ('R', -1)):
        rot(f'thigh{side}', y=-D(75) * k)
        rot(f'shin{side}', y=D(105) * k)
        rot(f'foot{side}', y=-D(30) * k)
        rot(f'uarm{side}', y=-D(35) - D(30) * k, x=s * D(-8))
        rot(f'farm{side}', y=-D(25))
    rot('spine', y=D(30) * k)
    rot('chest', y=D(12) * k)


def anim_tend(t):
    stand(t)
    drop(-0.07)
    rot('spine', y=D(38))
    rot('chest', y=D(18))
    rot('head', y=-D(15))
    for side, s in (('L', 1), ('R', -1)):
        rot(f'thigh{side}', y=-D(22))
        rot(f'shin{side}', y=D(32))
        rot(f'uarm{side}', y=-D(40) + D(12) * math.sin(2 * math.pi * t + (0 if s > 0 else math.pi)), x=s * D(-8))
        rot(f'farm{side}', y=-D(25))


def anim_type(t):
    stand(t, 4)
    for side, s in (('L', 1), ('R', -1)):
        rot(f'uarm{side}', y=-D(30), x=s * D(-10))
        rot(f'farm{side}', y=-D(75) + D(6) * math.sin(8 * math.pi * t + (0 if s > 0 else 1.7)))
        rot(f'hand{side}', y=D(15))
    rot('head', y=D(10))


def anim_wrench(t):
    stand(t, 8)
    w = math.sin(2 * math.pi * t)
    rot('uarmR', y=-D(55) + D(14) * w, x=D(10))
    rot('farmR', y=-D(45) - D(25) * w)
    rot('uarmL', y=-D(50), x=-D(12))
    rot('farmL', y=-D(55))
    rot('chest', z=D(6) * w)


def anim_inspect(t):
    stand(t, 2)
    rot('uarmL', y=-D(45), x=-D(10))
    rot('farmL', y=-D(70))
    rot('uarmR', y=-D(15) + D(8) * math.sin(2 * math.pi * t), x=D(6))
    rot('farmR', y=-D(95))
    rot('head', y=D(18) + D(4) * math.sin(2 * math.pi * t), z=D(10) * math.sin(2 * math.pi * t))


def anim_run(t):
    ph = 2 * math.pi * t
    for side in 'LR':
        p = ph if side == 'L' else ph + math.pi
        sw = math.sin(p)
        knee = max(0.0, math.sin(p + math.pi / 2)) ** 2
        rot(f'thigh{side}', y=-D(38) * sw - D(8))
        rot(f'shin{side}', y=D(15) + D(85) * knee)
        rot(f'foot{side}', y=-D(15) * sw)
    # rifle carried at port arms
    rot('uarmR', y=-D(30), x=D(6))
    rot('farmR', y=-D(80))
    rot('uarmL', y=-D(45), x=-D(18))
    rot('farmL', y=-D(70))
    drop(-0.05 + 0.05 * abs(math.cos(ph)))
    rot('spine', y=D(10))
    rot('chest', z=-D(5) * math.sin(ph))


def anim_aim(t):
    stand(t, 6)
    k = max(0.0, 1 - t * 3)  # recoil at the start of the loop
    for side in 'LR':
        rot(f'thigh{side}', y=D(-12 if side == 'L' else 10))
        rot(f'shin{side}', y=D(16))
    rot('uarmR', y=-D(78) + D(6) * k, x=D(12))
    rot('farmR', y=-D(20) - D(4) * k)
    rot('handR', y=D(10))
    rot('uarmL', y=-D(85) + D(4) * k, x=-D(22))
    rot('farmL', y=-D(25))
    rot('chest', y=-D(4) * k)
    rot('head', y=D(6))


def anim_die(t):
    k = min(1.0, t * 1.5)
    rig.rotation_euler = (0, -D(85) * k * k, math.radians(-28))
    rig.location = (0.85 * k * k, 0, 0)
    rot('uarmR', y=-D(60) * k, x=D(30) * k)
    rot('uarmL', y=-D(90) * k, x=-D(30) * k)
    rot('thighL', y=-D(30) * k)
    rot('shinL', y=D(50) * k)
    rot('head', y=-D(20) * k)


ANIMS = {
    'idle': (anim_idle, []), 'walk': (lambda t: walk(t), []), 'walkCarry': (lambda t: walk(t, True), ['crate']),
    'hammer': (anim_hammer, ['hammer']), 'lift': (anim_lift, []), 'tend': (anim_tend, ['can']),
    'type': (anim_type, []), 'wrench': (anim_wrench, ['wrench']), 'inspect': (anim_inspect, ['clip']),
}
if V.get('battle'):
    ANIMS = {'idle': (lambda t: (anim_aim(0.9)), ['rifle']), 'run': (anim_run, ['rifle']), 'aim': (anim_aim, ['rifle']), 'die': (anim_die, ['rifle'])}
FRAMES = {'aim': 6, 'die': 8, **({'idle': 1} if V.get('battle') else {})}

# ---- camera and lights (match the rooms: 7 degrees down, warm key from above, cool fill, rim) ----
bpy.ops.object.camera_add()
cam = bpy.context.object
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 2.05
tilt = math.radians(7)
cam.location = (0, -20 * math.cos(tilt), 0.95 + 20 * math.sin(tilt))
cam.rotation_euler = (math.pi / 2 - tilt, 0, 0)
sc.camera = cam
area((0.9, -2.2, 3.2), 300, 1.4, (1, 0.86, 0.68), rot=(math.radians(42), math.radians(15), 0))
area((-2.5, -1.5, 1.4), 60, 2, (0.55, 0.65, 0.9), rot=(math.radians(80), 0, math.radians(-60)))
area((-0.6, 2.4, 2.3), 220, 0.8, (1, 0.92, 0.8), rot=(math.radians(-60), 0, 0))
sc.eevee.taa_render_samples = 32

os.makedirs(os.path.join(OUT, V['name']), exist_ok=True)
foot = world_to_camera_view(sc, cam, Vector((0, 0, 0)))
meta = {'variant': V['name'], 'res': list(RES), 'fps': 12, 'foot': [foot.x, 1 - foot.y], 'metresTall': cam.data.ortho_scale * RES[1] / max(RES), 'anims': {}}
for name, (fn, shown) in ANIMS.items():
    if ONLY and name not in ONLY:
        continue
    for pn, objs in props.items():
        for o in objs:
            o.hide_render = pn not in shown
    n = 1 if STILL else FRAMES.get(name, FR)
    for i in range(n):
        pose_reset()
        rig.rotation_euler = (0, 0, math.radians(-28))
        rig.location = (0, 0, 0)
        fn((i + (3 if STILL else 0)) / n if not STILL else 3 / FR)
        bpy.context.view_layer.update()
        sc.render.filepath = os.path.join(OUT, V['name'], f'{name}_{i:02d}.png')
        bpy.ops.render.render(write_still=True)
    meta['anims'][name] = n
json.dump(meta, open(os.path.join(OUT, V['name'], 'meta.json'), 'w'))
print('DONE', V['name'], list(meta['anims']))

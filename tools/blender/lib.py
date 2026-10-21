# v2 Blender toolkit: materials, primitives, lights and the room camera shared by every room/character script.
# Run scripts headless:  blender -b -P tools/blender/<room>.py -- <out_dir> [--frames N] [--still]
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Euler

ROOM_W = 10.0          # metres across the visible room band (= 540 game units)
BAND_ASPECT = 540 / 268
RES_X, RES_Y = 1080, 536
FLOOR_FROM_BOTTOM = 0.30   # metres of floor visible below the feet line


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = a[0] if a else os.path.abspath('art-src/v2/out')
    frames = int(a[a.index('--frames') + 1]) if '--frames' in a else 16
    return out, frames, '--still' in a


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    random.seed(7)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    try:
        sc.eevee.taa_render_samples = 48
        sc.eevee.use_shadows = True
    except Exception:
        pass
    for attr, val in (('use_raytracing', True), ('use_gtao', True)):
        try:
            setattr(sc.eevee, attr, val)
        except Exception:
            pass
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
        sc.view_settings.exposure = 0.2
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = RES_X, RES_Y
    sc.render.image_settings.file_format = 'PNG'
    sc.render.fps = 12
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.02, 0.022, 0.025, 1)
    bg.inputs[1].default_value = 0.6
    sc.world = world
    return sc


# ---------- materials ----------
_mats = {}


def mat(name, color, metal=0.0, rough=0.6, emit=None, emit_strength=0.0, grime=0.0, scale=4.0, bump=0.0):
    """Principled material; `grime` mixes a darker noise for wear, `bump` adds surface relief."""
    color = tuple(color)
    key = (name, color, metal, rough, emit, emit_strength, grime, scale, bump)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    base = (*color, 1)
    if grime > 0:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = scale
        nz.inputs['Detail'].default_value = 8
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.45
        ramp.color_ramp.elements[1].position = 0.75
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.inputs[6].default_value = base
        dark = tuple(c * (1 - grime) for c in color)
        mix.inputs[7].default_value = (*dark, 1)
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], mix.inputs['Factor'])
        nt.links.new(mix.outputs[2], p.inputs['Base Color'])
        rr = nt.nodes.new('ShaderNodeMapRange')
        rr.inputs['To Min'].default_value = rough * 0.8
        rr.inputs['To Max'].default_value = min(1, rough * 1.25)
        nt.links.new(nz.outputs['Fac'], rr.inputs['Value'])
        nt.links.new(rr.outputs['Result'], p.inputs['Roughness'])
        if bump > 0:
            b = nt.nodes.new('ShaderNodeBump')
            b.inputs['Strength'].default_value = bump
            nt.links.new(nz.outputs['Fac'], b.inputs['Height'])
            nt.links.new(b.outputs['Normal'], p.inputs['Normal'])
    else:
        p.inputs['Base Color'].default_value = base
    if emit is not None:
        p.inputs['Emission Color'].default_value = (*emit, 1)
        p.inputs['Emission Strength'].default_value = emit_strength
    _mats[key] = m
    return m


def stripes_mat(name, a, b, scale=6.0):
    """Hazard stripes (a/b alternating diagonally)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_profile = 'SAW'
    wave.bands_direction = 'DIAGONAL'
    wave.inputs['Scale'].default_value = scale
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements[0].color = (*a, 1)
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = (*b, 1)
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
    nt.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.55
    return m


# ---------- primitives ----------
def _finish(o, m, bevel=0.0, smooth=False, parent=None):
    if m is not None:
        o.data.materials.append(m)
    if bevel > 0:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = 'ANGLE'
    if smooth:
        for f in o.data.polygons:
            f.use_smooth = True
    if parent is not None:
        o.parent = parent
    return o


def box(name, loc, size, m=None, bevel=0.02, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, m, bevel, parent=parent)


def cyl(name, loc, r, depth, m=None, rot=(0, 0, 0), verts=32, bevel=0.0, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object
    o.name = name
    return _finish(o, m, bevel, smooth=True, parent=parent)


def sphere(name, loc, r, m=None, parent=None, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=24, ring_count=12)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    return _finish(o, m, smooth=True, parent=parent)


def pipe(name, pts, r, m=None):
    """A pipe through points (a curve with a round bevel)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 4
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    if m is not None:
        o.data.materials.append(m)
    return o


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    bpy.context.collection.objects.link(o)
    if parent is not None:
        o.parent = parent
    return o


def scrap_piece(name, loc, s, m, parent=None, kind=None):
    """A piece of scrap: a bent sheet, a rod, a can or a battered lump (random unless `kind`)."""
    kind = kind or random.choice(('sheet', 'sheet', 'rod', 'can', 'lump', 'lump'))
    if kind == 'sheet':
        bpy.ops.mesh.primitive_plane_add(size=s * 2.2, location=loc)
        o = bpy.context.object
        mod = o.modifiers.new('sub', 'SUBSURF'); mod.levels = 2; mod.subdivision_type = 'SIMPLE'
        bpy.ops.object.modifier_apply(modifier='sub')
        for v in o.data.vertices:
            v.co.z += (math.sin(v.co.x * 9 + random.random()) + math.cos(v.co.y * 7)) * s * 0.12
        so = o.modifiers.new('thick', 'SOLIDIFY'); so.thickness = s * 0.08
    elif kind == 'rod':
        bpy.ops.mesh.primitive_cylinder_add(radius=s * 0.12, depth=s * 3, location=loc, vertices=8)
        o = bpy.context.object
        bd = o.modifiers.new('bend', 'SIMPLE_DEFORM'); bd.deform_method = 'BEND'; bd.angle = random.uniform(-0.9, 0.9)
    elif kind == 'can':
        bpy.ops.mesh.primitive_cylinder_add(radius=s * 0.45, depth=s * 1.1, location=loc, vertices=14)
        o = bpy.context.object
        for v in o.data.vertices:
            v.co.x *= 1 + (random.random() - 0.5) * 0.35
    else:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=s, location=loc)
        o = bpy.context.object
        for v in o.data.vertices:
            v.co *= 0.6 + random.random() * 0.7
        o.scale = (1.3, 0.8, 0.5)
        o.modifiers.new('sub', 'SUBSURF').levels = 1
    o.name = name
    o.rotation_euler = (random.random() * 6, random.random() * 6, random.random() * 6)
    _finish(o, m, parent=parent)
    if kind in ('lump', 'can'):
        for f in o.data.polygons:
            f.use_smooth = kind == 'can'
    return o


def bale(name, loc, size, mats, strap):
    """A compressed scrap cube: crushed metal surface (strong bump, mixed metals) with two straps."""
    o = box(name, loc, size, random.choice(mats), 0.04)
    sub = o.modifiers.new('sub', 'SUBSURF'); sub.levels = 4; sub.render_levels = 4; sub.subdivision_type = 'SIMPLE'
    disp = o.modifiers.new('crush', 'DISPLACE')
    tex = bpy.data.textures.new(name + '_t', 'VORONOI'); tex.noise_scale = 0.1
    disp.texture = tex; disp.strength = 0.13; disp.texture_coords = 'GLOBAL'
    for k in (-0.25, 0.25):
        box(name + f'_s{k}', (loc[0] + k * size[0], loc[1] - size[1] / 2 - 0.01, loc[2]), (0.05, 0.02, size[2] + 0.02), strap, 0)
    return o


# ---------- animation helpers ----------
def key_linear(obj, path, frames_values):
    for f, v in frames_values:
        setattr_path(obj, path, v)
        obj.keyframe_insert(data_path=path.split('[')[0], index=int(path.split('[')[1][:-1]) if '[' in path else -1, frame=f)
    ad = obj.animation_data
    if ad and ad.action:
        for fc in fcurves(ad.action):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'


def fcurves(action):
    # Blender 5 layered actions keep curves in channelbags; older ones on action.fcurves
    try:
        return list(action.fcurves)
    except AttributeError:
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out.extend(bag.fcurves)
        return out


def setattr_path(obj, path, v):
    if '[' in path:
        name, idx = path.split('[')
        getattr(obj, name)[int(idx[:-1])] = v
    else:
        setattr(obj, path, v)


def spin(obj, axis, turns, frames):
    """Rotates `turns` full turns over the loop (frames 1..frames+1 = same pose, seamless)."""
    i = 'xyz'.index(axis)
    key_linear(obj, f'rotation_euler[{i}]', [(1, obj.rotation_euler[i]), (frames + 1, obj.rotation_euler[i] + turns * 2 * math.pi)])


def wobble(obj, path, base, amp, frames, cycles=1, phase=0.0):
    """Sine motion that loops exactly over the loop length."""
    vals = []
    for f in range(1, frames + 2):
        t = (f - 1) / frames
        vals.append((f, base + amp * math.sin(2 * math.pi * (cycles * t + phase))))
    key_linear(obj, path, vals)


# ---------- lights, shell, camera ----------
def point(loc, energy, color=(1, 0.85, 0.65), radius=0.15):
    bpy.ops.object.light_add(type='POINT', location=loc)
    L = bpy.context.object
    L.data.energy = energy
    L.data.color = color
    L.data.shadow_soft_size = radius
    return L


def area(loc, energy, size, color=(1, 0.9, 0.8), rot=(0, 0, 0)):
    bpy.ops.object.light_add(type='AREA', location=loc, rotation=rot)
    L = bpy.context.object
    L.data.energy = energy
    L.data.size = size
    L.data.color = color
    return L


def lamp_fixture(x, z, y=1.2, energy=180, color=(1, 0.82, 0.55)):
    """A caged ceiling lamp: housing, glowing bulb, a real light."""
    metal = mat('lamp_metal', (0.12, 0.12, 0.11), metal=0.8, rough=0.4)
    glow = mat('bulb', (1, 0.9, 0.7), emit=color, emit_strength=12)
    cyl('lamp_stem', (x, y, z + 0.25), 0.015, 0.5, metal)
    cyl('lamp_hood', (x, y, z), 0.22, 0.12, metal, verts=24)
    sphere('lamp_bulb', (x, y, z - 0.1), 0.08, glow)
    bpy.ops.object.light_add(type='SPOT', location=(x, y, z - 0.12))
    L = bpy.context.object
    L.data.energy = energy * 2.6
    L.data.color = color
    L.data.spot_size = math.radians(115)
    L.data.spot_blend = 0.7
    L.data.shadow_soft_size = 0.12
    point((x, y - 0.2, z - 0.15), energy * 0.12, color, 0.1)


def shell(wall=(0.42, 0.40, 0.36), floor=(0.30, 0.29, 0.27), depth=3.2, height=4.6):
    """Back wall with panels, floor slab, side walls and ceiling pipes; room spans x 0..ROOM_W."""
    concrete = mat('wall', wall, rough=0.85, grime=0.45, scale=3, bump=0.25)
    floor_m = mat('floor', floor, rough=0.7, grime=0.5, scale=6, bump=0.2)
    trim = mat('trim', (0.18, 0.18, 0.17), metal=0.7, rough=0.45, grime=0.3)
    box('back', (ROOM_W / 2, depth, height / 2), (ROOM_W + 2, 0.2, height + 1), concrete, 0)
    box('floor', (ROOM_W / 2, depth / 2, -0.1), (ROOM_W + 2, depth + 2, 0.2), floor_m, 0)
    box('ceil', (ROOM_W / 2, depth / 2, height + 0.1), (ROOM_W + 2, depth + 2, 0.2), concrete, 0)
    box('side_l', (-0.6, depth / 2, height / 2), (0.2, depth, height), concrete, 0)
    box('side_r', (ROOM_W + 0.6, depth / 2, height / 2), (0.2, depth, height), concrete, 0)
    # wall panels and a skirting band
    for i in range(6):
        box(f'panel{i}', (0.9 + i * 1.65, depth - 0.11, 2.2), (1.5, 0.04, 2.6), mat('panel', [c * 0.92 for c in wall], rough=0.75, grime=0.5, scale=5, bump=0.2), 0.01)
    box('skirt', (ROOM_W / 2, depth - 0.12, 0.25), (ROOM_W + 2, 0.06, 0.5), trim, 0.01)
    # ceiling pipes
    pm = mat('pipe', (0.32, 0.30, 0.26), metal=0.85, rough=0.35, grime=0.4)
    pipe('pipe_a', [(-1, depth - 0.3, height - 0.25), (ROOM_W + 1, depth - 0.3, height - 0.25)], 0.09, pm)
    pipe('pipe_b', [(-1, depth - 0.55, height - 0.45), (ROOM_W + 1, depth - 0.55, height - 0.45)], 0.06, mat('pipe_red', (0.45, 0.12, 0.08), metal=0.5, rough=0.5, grime=0.3))
    return concrete, floor_m, trim


def post(glare=0.5, vignette=True):
    """Compositor: soft glow around bright lamps."""
    sc = bpy.context.scene
    try:
        sc.use_nodes = True
        nt = sc.node_tree
    except Exception:
        return
    rl = nt.nodes.get('Render Layers') or nt.nodes.new('CompositorNodeRLayers')
    comp = nt.nodes.get('Composite') or nt.nodes.new('CompositorNodeComposite')
    try:
        g = nt.nodes.new('CompositorNodeGlare')
        g.glare_type = 'FOG_GLOW'
        g.quality = 'HIGH'
        try:
            g.mix = glare - 1
        except Exception:
            pass
        try:
            g.threshold = 1.0
        except Exception:
            pass
        nt.links.new(rl.outputs['Image'], g.inputs['Image'])
        nt.links.new(g.outputs['Image'], comp.inputs['Image'])
    except Exception as e:
        print('glare skipped', e)


def camera():
    sc = bpy.context.scene
    view_h = ROOM_W / BAND_ASPECT
    bpy.ops.object.camera_add()
    cam = bpy.context.object
    cam.data.type = 'PERSP'
    cam.data.lens = 85
    cam.data.sensor_fit = 'HORIZONTAL'
    dist = 30.0
    # horizontal field of view covers ROOM_W at the front plane (y = 0)
    cam.data.sensor_width = 36
    fov = 2 * math.atan(18 / 85)
    dist = (ROOM_W / 2) / math.tan(fov / 2)
    tilt = math.radians(7)
    cz = view_h / 2 - FLOOR_FROM_BOTTOM
    cam.location = (ROOM_W / 2, -dist * math.cos(tilt), cz + dist * math.sin(tilt))
    cam.rotation_euler = (math.pi / 2 - tilt, 0, 0)
    sc.camera = cam
    return cam


def render(out_dir, frames, still):
    sc = bpy.context.scene
    os.makedirs(out_dir, exist_ok=True)
    if still:
        sc.frame_set(1)
        sc.render.filepath = os.path.join(out_dir, 'still.png')
        bpy.ops.render.render(write_still=True)
        return
    sc.frame_start, sc.frame_end = 1, frames
    sc.render.filepath = os.path.join(out_dir, 'f_')
    bpy.ops.render.render(animation=True)


# ---------- shared machine parts (rooms 2-8) ----------
def anim_value(socket, frames, fn):
    """Keyframes a node socket's default_value with fn(t in 0..1) over the loop (seamless)."""
    for f in range(1, frames + 2):
        socket.default_value = fn((f - 1) / frames)
        socket.keyframe_insert('default_value', frame=f)


def emissive(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Emission Color'].default_value = (*color, 1)
    p.inputs['Emission Strength'].default_value = strength
    return m, p.inputs['Emission Strength']


def fan(name, loc, r, frames, turns=1, m=None, axis='y', blades=5):
    """A caged fan whose blades spin `turns` per loop (multiples of 1/blades loop seamlessly)."""
    m = m or mat('fan_m', (0.2, 0.2, 0.21), metal=0.7, rough=0.4)
    rot = (math.pi / 2, 0, 0) if axis == 'y' else (0, 0, 0)
    bpy.ops.mesh.primitive_torus_add(major_radius=r * 1.05, minor_radius=r * 0.06, location=loc, rotation=rot)
    ring = bpy.context.object
    ring.data.materials.append(m)
    back = (loc[0], loc[1] + 0.08, loc[2]) if axis == 'y' else (loc[0], loc[1], loc[2] - 0.08)
    cyl(name + '_back', back, r * 1.0, 0.02, mat('fan_hole', (0.015, 0.015, 0.015), rough=0.9), rot=rot, verts=32)
    for g in range(-2, 3):
        box(f'{name}_grill{g}', (loc[0] + g * r * 0.4, loc[1] - 0.05, loc[2]) if axis == 'y' else (loc[0] + g * r * 0.4, loc[1], loc[2] + 0.05),
            (0.012, 0.012, r * 2 * math.sqrt(max(0.05, 1 - (g * 0.4) ** 2))) if axis == 'y' else (0.012, r * 2 * math.sqrt(max(0.05, 1 - (g * 0.4) ** 2)), 0.012), m, 0)
    piv = empty(name + '_piv', loc)
    for b in range(blades):
        a = b * 2 * math.pi / blades
        bl = box(f'{name}_b{b}', (math.cos(a) * r * 0.5, 0, math.sin(a) * r * 0.5) if axis == 'y' else (math.cos(a) * r * 0.5, math.sin(a) * r * 0.5, 0),
                 (r * 0.9, 0.01, r * 0.3) if axis == 'y' else (r * 0.9, r * 0.3, 0.01), m, 0.005, parent=piv)
        bl.rotation_euler = (0.35, -a, 0) if axis == 'y' else (0.35, 0, a)
    sphere(name + '_hub', (0, 0, 0), r * 0.15, m, parent=piv)
    spin(piv, 'y' if axis == 'y' else 'z', turns, frames)
    return piv


def piston(name, base_loc, w, stroke, frames, m_body, m_rod, phase=0.0, cycles=1, sharp=True):
    """A hydraulic press: a head that drops by `stroke` and returns (fast strike when sharp)."""
    head = box(name + '_head', base_loc, (w, w * 0.9, 0.25), m_body, 0.02)
    cyl(name + '_rod', (0, 0, 0.5), w * 0.12, 1.0, m_rod, parent=head)
    vals = []
    for f in range(1, frames + 2):
        t = ((f - 1) / frames * cycles + phase) % 1
        k = (math.sin(math.pi * t) ** (6 if sharp else 1)) if sharp else 0.5 - 0.5 * math.cos(2 * math.pi * t)
        vals.append((f, base_loc[2] - stroke * k))
    key_linear(head, 'location[2]', vals)
    return head


def leds(name, x0, x1, z0, z1, y, n, frames, colors=((0.1, 1, 0.3), (1, 0.6, 0.1), (1, 0.1, 0.05))):
    """Blinking status LEDs in a few groups, each group on its own rhythm."""
    groups = []
    for g, c in enumerate(colors * 2):
        m, s = emissive(f'{name}_g{g}', c, 6)
        k = random.randint(1, 4)
        ph = random.random()
        anim_value(s, frames, lambda t, k=k, ph=ph: 6.0 if math.sin(2 * math.pi * (k * t + ph)) > -0.2 else 0.3)
        groups.append(m)
    for i in range(n):
        box(f'{name}{i}', (x0 + random.random() * (x1 - x0), y, z0 + random.random() * (z1 - z0)), (0.025, 0.01, 0.02), random.choice(groups), 0)


def screen(name, loc, size, color, frames, rot=(0, 0, 0)):
    """A monitor whose picture scrolls (a wave pattern moving across) and flickers a little."""
    frame_m = mat('monitor', (0.08, 0.08, 0.09), metal=0.4, rough=0.5)
    box(name + '_case', (loc[0], loc[1] + 0.03, loc[2]), (size[0] + 0.05, 0.06, size[1] + 0.05), frame_m, 0.01, rot=rot)
    m = bpy.data.materials.new(name + '_scr')
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.inputs['Scale'].default_value = 3
    wave.inputs['Distortion'].default_value = 4
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*[c * 0.08 for c in color], 1)
    ramp.color_ramp.elements[1].position = 0.8
    ramp.color_ramp.elements[1].color = (*color, 1)
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], wave.inputs['Vector'])
    nt.links.new(wave.outputs['Color'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], p.inputs['Emission Color'])
    p.inputs['Base Color'].default_value = (0, 0, 0, 1)
    p.inputs['Emission Strength'].default_value = 1.4
    for f in range(1, frames + 2):
        mp.inputs['Location'].default_value[0] = (f - 1) / frames * (1 / 3)
        mp.inputs['Location'].keyframe_insert('default_value', frame=f)
    scr = box(name, loc, (size[0], 0.01, size[1]), m, 0, rot=rot)
    return scr


_leaf_shades = {}


def plant(name, loc, s, m_leaf, frames, sway=0.06, phase=0.0):
    """A bushy plant: thin stems with many small leaves in a few shades of the given colour; it sways."""
    piv = empty(name, loc)
    base = m_leaf.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value
    key = m_leaf.name
    if key not in _leaf_shades:
        _leaf_shades[key] = [mat(f'{key}_s{k}', tuple(c * f for c in base[:3]), rough=0.55, grime=0.3, scale=30) for k, f in enumerate((0.6, 0.85, 1.1))]
    stem_m = mat('stem', (0.18, 0.28, 0.1), rough=0.7)
    for st in range(4):
        a0 = st * 1.6 + random.random()
        h = (0.25 + random.random() * 0.25) * s
        sx, sy = math.cos(a0) * 0.06 * s, math.sin(a0) * 0.06 * s
        cyl(f'{name}_st{st}', (sx, sy, h / 2), 0.006, h, stem_m, parent=piv, verts=6)
        for i in range(6):
            a = a0 + i * 1.05
            z = h * (0.35 + 0.65 * i / 5)
            lf = sphere(f'{name}_l{st}{i}', (sx + math.cos(a) * 0.07 * s, sy + math.sin(a) * 0.07 * s, z), 0.055 * s,
                        random.choice(_leaf_shades[key]), parent=piv, scale=(1.7, 0.75, 0.18))
            lf.rotation_euler = (random.uniform(-0.6, 0.6), random.uniform(-0.7, 0.2), a)
    wobble(piv, 'rotation_euler[0]', 0, sway, frames, cycles=1, phase=phase)
    return piv


def rack_shelf(name, x, y, w, d, levels, h, m):
    for i in range(levels):
        box(f'{name}_s{i}', (x, y, 0.35 + i * h), (w, d, 0.04), m, 0.005)
    for cx in (x - w / 2 + 0.03, x + w / 2 - 0.03):
        for cy in (y - d / 2 + 0.03, y + d / 2 - 0.03):
            box(f'{name}_p', (cx, cy, (levels * h) / 2 + 0.2), (0.04, 0.04, levels * h + 0.4), m, 0.004)


def drops(name, x, y, z_top, z_bottom, frames, n=3, m=None, size=0.02):
    """Falling drops, evenly spaced in time so the stream loops."""
    m = m or mat('water', (0.5, 0.7, 0.9), metal=0.0, rough=0.05)
    for i in range(n):
        d = sphere(f'{name}{i}', (x, y, z_top), size, m)
        vals = []
        for f in range(1, frames + 2):
            t = ((f - 1) / frames + i / n) % 1
            vals.append((f, z_top - (z_top - z_bottom) * t * t))
        key_linear(d, 'location[2]', vals)


def bubbles(name, x0, x1, y, z0, z1, frames, n=10, m=None):
    m = m or mat('bubble', (0.85, 0.95, 1.0), rough=0.05, emit=(0.6, 0.8, 1), emit_strength=0.6)
    for i in range(n):
        bx = x0 + random.random() * (x1 - x0)
        o = sphere(f'{name}{i}', (bx, y, z0), 0.015 + random.random() * 0.015, m)
        ph = random.random()
        key_linear(o, 'location[2]', [(f, z0 + (z1 - z0) * (((f - 1) / frames + ph) % 1)) for f in range(1, frames + 2)])
        for fc in fcurves(o.animation_data.action):
            pass


def glass_mat(name='glass', tint=(0.8, 0.92, 1.0), alpha=0.22):
    """See-through glass that EEVEE renders without refraction (alpha blended, glossy)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*tint, 1)
    p.inputs['Roughness'].default_value = 0.04
    p.inputs['Alpha'].default_value = alpha
    for attr, val in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
        try:
            setattr(m, attr, val)
        except Exception:
            pass
    return m


def rosette(name, loc, s, m_leaf, frames, sway=0.04, phase=0.0):
    """A lettuce-like head: cupped leaves radiating from the centre in two rings; it sways a little."""
    piv = empty(name, loc)
    base = m_leaf.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value
    key = m_leaf.name
    if key not in _leaf_shades:
        _leaf_shades[key] = [mat(f'{key}_s{k}', tuple(c * f for c in base[:3]), rough=0.5, grime=0.3, scale=30) for k, f in enumerate((0.65, 0.9, 1.15))]
    for ring, (n, rad, tilt, sz) in enumerate(((9, 0.09, 1.0, 0.085), (6, 0.04, 0.45, 0.07))):
        for i in range(n):
            a = i * 2 * math.pi / n + ring * 0.3 + random.random() * 0.2
            lf = sphere(f'{name}_r{ring}{i}', (math.cos(a) * rad * s, math.sin(a) * rad * s, (0.05 + ring * 0.04) * s), sz * s,
                        random.choice(_leaf_shades[key]), parent=piv, scale=(1.5, 1.0, 0.35))
            lf.rotation_euler = (0, -tilt, a)
    wobble(piv, 'rotation_euler[0]', 0, sway, frames, cycles=1, phase=phase)
    return piv


def smoke_mat(name='smoke', color=(0.85, 0.85, 0.85), alpha=0.18, glow=0.15):
    """Soft see-through vapour for steam/smoke puffs."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = 1.0
    p.inputs['Alpha'].default_value = alpha
    p.inputs['Emission Color'].default_value = (*color, 1)
    p.inputs['Emission Strength'].default_value = glow
    for attr, val in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
        try:
            setattr(m, attr, val)
        except Exception:
            pass
    return m


def dress_wall(x0, x1, y=3.0, seed=3, shelves=True):
    """Clutter for a back wall between x0 and x1: shelves of boxes and jars, a cable run, a sign, a vent grille."""
    rnd = random.Random(seed)
    steel = mat('dress_steel', (0.32, 0.33, 0.34), metal=0.85, rough=0.4, grime=0.4)
    box_ms = [mat('dress_card', (0.45, 0.35, 0.22), rough=0.9, grime=0.4, scale=12), mat('dress_green', (0.22, 0.3, 0.2), rough=0.6, grime=0.4),
              mat('dress_grey', (0.35, 0.35, 0.36), metal=0.4, rough=0.5, grime=0.4), mat('dress_red', (0.45, 0.12, 0.08), rough=0.6, grime=0.4)]
    x = x0
    while x < x1 - 0.8:
        w = rnd.uniform(0.9, 1.5)
        if shelves:
            z = rnd.choice((2.1, 2.5))
            box('dress_shelf', (x + w / 2, y - 0.15, z), (w, 0.3, 0.035), steel, 0.004)
            for k in (0.1, w - 0.1):
                box('dress_br', (x + k, y - 0.08, z - 0.12), (0.03, 0.16, 0.22), steel, 0)
            cx = x + 0.08
            while cx < x + w - 0.15:
                bw = rnd.uniform(0.12, 0.3)
                bh = rnd.uniform(0.1, 0.3)
                box('dress_item', (cx + bw / 2, y - 0.15, z + 0.02 + bh / 2), (bw, rnd.uniform(0.15, 0.25), bh), rnd.choice(box_ms), 0.008)
                cx += bw + rnd.uniform(0.02, 0.08)
        x += w + rnd.uniform(0.4, 1.0)
    pipe('dress_cable', [(x0, y - 0.05, 3.5), (x1, y - 0.05, 3.45)], 0.02, mat('dress_dark', (0.04, 0.04, 0.04), rough=0.6))
    sx = rnd.uniform(x0 + 0.5, x1 - 0.5)
    box('dress_sign', (sx, y - 0.03, 1.6), (0.45, 0.02, 0.3), stripes_mat('dress_hz', (0.8, 0.6, 0.05), (0.05, 0.05, 0.05), 6), 0.005)


def brick_mat(name='brick', c1=(0.36, 0.16, 0.09), c2=(0.26, 0.11, 0.06), mortar=(0.12, 0.11, 0.10), scale=6.0):
    """Brick wall texture (with bump on the mortar lines)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    br = nt.nodes.new('ShaderNodeTexBrick')
    br.inputs['Color1'].default_value = (*c1, 1)
    br.inputs['Color2'].default_value = (*c2, 1)
    br.inputs['Mortar'].default_value = (*mortar, 1)
    br.inputs['Scale'].default_value = scale
    br.inputs['Mortar Size'].default_value = 0.025
    nt.links.new(tc.outputs['Object'], br.inputs['Vector'])
    nt.links.new(br.outputs['Color'], p.inputs['Base Color'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.4
    nt.links.new(br.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    p.inputs['Roughness'].default_value = 0.9
    return m

"""Build the acupuncture clinic set in Blender and export it as glTF binary.

Run headless:   blender -b -P blender/build_clinic.py -- models/clinic.glb [models/clinic.blend]
Open the .blend in Blender to edit by hand, then re-export (File > Export > glTF 2.0, +Y up, Apply Modifiers).

Coordinates below are written in the renderer's Three.js space (x right, y up, z toward camera) and converted with
T(): Blender (x, y, z) = (x, -z, y). Object names the renderer looks for:
  ClockHour, ClockMin (pivot = clock centre), SharpsLid (glows), Station_<name> empties (where the character stands).
"""
import math
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "clinic.glb"
BLEND = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = scene.collection


def T(x, y, z):
    return Vector((x, -z, y))


MATS = {}


def mat(name, color, rough=0.6, metal=0.0, emit=None, alpha=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    r, g, bl = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    b.inputs["Base Color"].default_value = (lin(r), lin(g), lin(bl), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (lin(r), lin(g), lin(bl), 1)
        b.inputs["Emission Strength"].default_value = emit
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND"
    MATS[name] = m
    return m


def finish(o, m, bevel=0.0, smooth=False, parent=None):
    o.data.materials.append(m)
    if bevel:
        mod = o.modifiers.new("bevel", "BEVEL")
        mod.width, mod.segments, mod.limit_method = bevel, 3, "ANGLE"
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    if parent:
        o.parent = parent
    return o


def box(name, w, h, d, m, x, y, z, bevel=0.01, rot=(0, 0, 0)):
    """w along x, h along y (up), d along z (depth) — all in three.js space."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=T(x, y, z))
    o = bpy.context.object
    o.name = name
    o.scale = (w, d, h)
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, m, bevel)


def cyl(name, r, h, m, x, y, z, axis="y", verts=24, r2=None, bevel=0.0):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h, location=T(x, y, z))
    o = bpy.context.object
    o.name = name
    if axis == "x":
        o.rotation_euler = (0, math.pi / 2, 0)
    elif axis == "z":
        o.rotation_euler = (math.pi / 2, 0, 0)
    return finish(o, m, bevel, smooth=True)


def sphere(name, r, m, x, y, z, scale=(1, 1, 1), seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=T(x, y, z))
    o = bpy.context.object
    o.name = name
    o.scale = (scale[0], scale[2], scale[1])
    return finish(o, m, smooth=True)


def capsule(name, r, length, m, x, y, z, axis="x", sx=1.0, sz=1.0):
    """Rounded limb/torso: a cylinder with sphere caps (joined)."""
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=r, depth=length, location=(0, 0, 0)); parts.append(bpy.context.object)
    for s in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=r, location=(0, 0, s * length / 2)); parts.append(bpy.context.object)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    o.location = T(x, y, z)
    if axis == "x":
        o.rotation_euler = (0, math.pi / 2, 0)
    elif axis == "z":
        o.rotation_euler = (math.pi / 2, 0, 0)
    o.scale = (sx, sz, 1) if axis == "x" else (1, 1, 1)
    return finish(o, m, smooth=True)


def empty(name, x, y, z):
    o = bpy.data.objects.new(name, None)
    o.location = T(x, y, z)
    coll.objects.link(o)
    return o


# ---------------- palette ----------------
WALL = mat("Wall", "#e9eef0", 0.9)
WALL2 = mat("WallLeft", "#dde8ea", 0.9)
TRIM = mat("Trim", "#f6f3ee", 0.7)
WOOD = mat("Wood", "#c9a77a", 0.55)
WOOD_D = mat("WoodDark", "#8f775a", 0.6)
FLOOR_A = mat("FloorA", "#d9c4a2", 0.7)
FLOOR_B = mat("FloorB", "#cfb994", 0.7)
STEEL = mat("Steel", "#c3ccd3", 0.3, 0.8)
STEEL_D = mat("SteelDark", "#7d8891", 0.35, 0.7)
WHITE = mat("White", "#fbfbf9", 0.4)
MINT = mat("Mattress", "#bfe4df", 0.55)
BLUE = mat("ChairBlue", "#4a6b82", 0.6)
NAVY = mat("Navy", "#2c3e50", 0.5)
SKIN = mat("Skin", "#e2b28e", 0.55)
HAIR = mat("Hair", "#2b1d14", 0.7)
TOWEL = mat("Towel", "#f0d9a8", 0.9)
YELLOW = mat("SharpsYellow", "#f2c230", 0.45)
RED = mat("SharpsRed", "#d64040", 0.45)
GLASS = mat("Glass", "#bfe3ff", 0.1, 0, emit=0.6)
CURTAIN = mat("Curtain", "#8fc9c1", 0.85)
LEAF = mat("Leaf", "#4f9a62", 0.6)
POT = mat("Pot", "#c6704b", 0.7)
BLACK = mat("Black", "#22282e", 0.5)
CLOCKF = mat("ClockFace", "#ffffff", 0.4)
ACCENT = mat("Accent", "#e05a47", 0.5)

# ---------------- shell ----------------
for i in range(10):  # wood planks
    box(f"Plank{i}", 7.4, 0.04, 0.66, FLOOR_A if i % 2 else FLOOR_B, 0, -0.02, -3.0 + 0.33 + i * 0.66, bevel=0.004)
box("WallBack", 7.6, 3.1, 0.18, WALL, 0, 1.55, -3.09, bevel=0)
box("WallLeft", 0.18, 3.1, 6.8, WALL2, -3.79, 1.55, 0.3, bevel=0)
box("CutBack", 7.6, 0.07, 0.22, TRIM, 0, 3.12, -3.09, bevel=0.01)
box("CutLeft", 0.22, 0.07, 6.8, TRIM, -3.79, 3.12, 0.3, bevel=0.01)
box("SlabEdge", 7.6, 0.18, 0.18, TRIM, 0, -0.09, 3.6, bevel=0.01)
box("BaseBack", 7.4, 0.12, 0.03, mat("Base", "#b9c6cc"), 0, 0.06, -2.985)
box("BaseLeft", 0.03, 0.12, 6.6, MATS["Base"], -3.685, 0.06, 0.3)
box("Wainscot", 7.4, 0.9, 0.02, mat("Wainscot", "#d6e4e2", 0.8), 0, 0.57, -2.99, bevel=0)
box("Rail", 7.4, 0.04, 0.04, WOOD, 0, 1.04, -2.97)

# window with sill, frame, curtains
box("WinGlass", 1.5, 1.0, 0.02, GLASS, 2.2, 1.9, -2.99, bevel=0)
for nm, w, h, x, y in (("WinTop", 1.62, .07, 2.2, 2.43), ("WinBot", 1.62, .07, 2.2, 1.37), ("WinL", .07, 1.1, 1.42, 1.9), ("WinR", .07, 1.1, 2.98, 1.9), ("WinMid", .05, 1.0, 2.2, 1.9)):
    box(nm, w, h, 0.07, WHITE, x, y, -2.96)
box("Sill", 1.8, 0.05, 0.22, WHITE, 2.2, 1.33, -2.88)
for side, x0 in (("L", 1.25), ("R", 2.85)):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=24, y_subdivisions=2, size=1, location=T(x0, 1.85, -2.86))
    c = bpy.context.object; c.name = f"Curtain{side}"
    c.scale = (0.45, 1.25, 1); c.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.transform_apply(rotation=True, scale=True)
    for v in c.data.vertices:  # folds
        v.co.y += 0.035 * math.sin((v.co.x - x0) * 40)
    sol = c.modifiers.new("thick", "SOLIDIFY"); sol.thickness = 0.01
    finish(c, CURTAIN, smooth=True)
box("CurtainRod", 2.2, 0.03, 0.03, STEEL, 2.05, 2.52, -2.85)

# ---------------- consult desk ----------------
box("DeskTop", 1.3, 0.05, 0.7, WOOD, -2.2, 0.76, -2.2, bevel=0.012)
for i, (x, z) in enumerate(((-2.8, -2.5), (-1.6, -2.5), (-2.8, -1.9), (-1.6, -1.9))):
    box(f"DeskLeg{i}", 0.05, 0.74, 0.05, WOOD_D, x, 0.37, z)
box("Drawers", 0.42, 0.5, 0.6, WOOD, -1.85, 0.47, -2.2, bevel=0.01)
for i in range(2):
    box(f"DrawerHandle{i}", 0.14, 0.02, 0.02, STEEL, -1.85, 0.35 + i * 0.22, -1.89)
box("Laptop", 0.42, 0.02, 0.3, NAVY, -2.45, 0.8, -2.25, bevel=0.006)
box("LaptopLid", 0.42, 0.28, 0.02, NAVY, -2.45, 0.94, -2.41, bevel=0.006, rot=(-0.25, 0, 0))
box("Clipboard", 0.24, 0.015, 0.32, mat("Paper", "#f4efe3", 0.8), -1.85, 0.79, -2.1, bevel=0.004)
cyl("PenCup", 0.04, 0.1, NAVY, -2.75, 0.83, -2.0)
# chair
box("ChairSeat", 0.46, 0.06, 0.46, BLUE, -2.2, 0.48, -1.62, bevel=0.03)
box("ChairBack", 0.46, 0.42, 0.05, BLUE, -2.2, 0.76, -1.4, bevel=0.03)
cyl("ChairPost", 0.025, 0.4, STEEL_D, -2.2, 0.26, -1.62)
for k in range(5):
    a = k * 2 * math.pi / 5
    box(f"ChairFoot{k}", 0.3, 0.025, 0.04, STEEL_D, -2.2 + math.cos(a) * 0.15, 0.04, -1.62 + math.sin(a) * 0.15, rot=(0, 0, a))

# ---------------- hand-wash station ----------------
box("SinkCabinet", 0.62, 0.85, 0.52, WHITE, -3.38, 0.425, 0.2, bevel=0.012)
box("SinkDoorGap", 0.005, 0.7, 0.01, STEEL_D, -3.38, 0.42, 0.465, bevel=0)
box("Countertop", 0.7, 0.04, 0.6, mat("Counter", "#e8ecee", 0.35), -3.38, 0.87, 0.2, bevel=0.01)
bpy.ops.mesh.primitive_cube_add(size=1, location=T(-3.36, 0.86, 0.2))
basin = bpy.context.object; basin.name = "Basin"; basin.scale = (0.44, 0.34, 0.08)
bpy.ops.object.transform_apply(scale=True)
bm = bmesh.new(); bm.from_mesh(basin.data)
top = [f for f in bm.faces if f.normal.z > 0.9]
bmesh.ops.inset_region(bm, faces=top, thickness=0.03)
bmesh.ops.translate(bm, verts=[v for f in top for v in f.verts], vec=(0, 0, -0.07))
bm.to_mesh(basin.data); bm.free()
finish(basin, WHITE, bevel=0.01)
cyl("FaucetPost", 0.018, 0.28, STEEL, -3.58, 1.02, 0.2)
cyl("FaucetSpout", 0.016, 0.22, STEEL, -3.48, 1.15, 0.2, axis="x")
box("Soap", 0.07, 0.16, 0.07, mat("Soap", "#78c2e8", 0.3), -3.58, 0.97, -0.02, bevel=0.01)
box("Mirror", 0.02, 0.6, 0.5, mat("Mirror", "#cfe3ee", 0.15, 0.0), -3.69, 1.55, 0.2, bevel=0.005)
box("TowelDispenser", 0.1, 0.32, 0.26, WHITE, -3.64, 1.4, 0.75, bevel=0.015)
box("WallCabinet", 0.32, 0.55, 0.9, WHITE, -3.53, 2.1, -0.9, bevel=0.012)

# ---------------- treatment bed + patient ----------------
box("BedBase", 1.9, 0.08, 0.72, STEEL_D, 0.6, 0.42, -1.6, bevel=0.01)
for i, (x, z) in enumerate(((-0.25, -1.88), (1.45, -1.88), (-0.25, -1.32), (1.45, -1.32))):
    box(f"BedLeg{i}", 0.06, 0.4, 0.06, STEEL, x, 0.2, z)
    sphere(f"Wheel{i}", 0.045, BLACK, x, 0.045, z)
box("Mattress", 2.0, 0.14, 0.8, MINT, 0.6, 0.53, -1.6, bevel=0.05)
bpy.ops.mesh.primitive_torus_add(major_radius=0.12, minor_radius=0.05, location=T(1.75, 0.62, -1.6))
fc = bpy.context.object; fc.name = "FaceCradle"; finish(fc, MINT, smooth=True)
box("PaperRoll", 2.0, 0.005, 0.5, mat("BedPaper", "#ffffff", 0.9), 0.6, 0.605, -1.6, bevel=0)
torso = sphere("PatientTorso", 0.2, SKIN, 0.95, 0.78, -1.6, scale=(2.0, 0.75, 1.15))
sphere("PatientHead", 0.14, SKIN, 1.55, 0.76, -1.6)
sphere("PatientHair", 0.145, HAIR, 1.6, 0.79, -1.6, scale=(0.75, 0.9, 1.0))
for s in (-1, 1):
    capsule(f"PatientArm{s}", 0.055, 0.45, SKIN, 1.0, 0.68, -1.6 + s * 0.3)
capsule("PatientLegs", 0.15, 0.75, SKIN, 0.05, 0.72, -1.6, sx=1.0, sz=0.8)
box("Towel", 1.05, 0.12, 0.78, TOWEL, 0.02, 0.8, -1.6, bevel=0.05)
box("StepStool", 0.4, 0.22, 0.3, STEEL_D, -0.3, 0.11, -0.95, bevel=0.02)

# ---------------- instrument trolley ----------------
box("TrolleyTop", 0.7, 0.03, 0.5, STEEL, -0.55, 0.82, -1.15, bevel=0.008)
box("TrolleyShelf", 0.7, 0.03, 0.5, STEEL, -0.55, 0.3, -1.15, bevel=0.008)
for i, (x, z) in enumerate(((-0.87, -1.37), (-0.23, -1.37), (-0.87, -0.93), (-0.23, -0.93))):
    cyl(f"TrolleyPost{i}", 0.014, 0.82, STEEL_D, x, 0.41, z)
box("Tray", 0.4, 0.02, 0.28, mat("TrayBlue", "#bcd7ea", 0.4), -0.7, 0.845, -1.1, bevel=0.01)
box("EStimUnit", 0.18, 0.1, 0.14, NAVY, -0.4, 0.89, -1.3, bevel=0.01)
box("CottonJar", 0.1, 0.12, 0.1, mat("JarGlass", "#e8f4ff", 0.1), -0.32, 0.38, -1.1, bevel=0.02)

# ---------------- sharps bin ----------------
box("SharpsStand", 0.3, 0.7, 0.3, STEEL_D, 2.55, 0.35, -0.55, bevel=0.01)
box("SharpsBin", 0.34, 0.36, 0.3, YELLOW, 2.55, 0.88, -0.55, bevel=0.02)
box("SharpsLid", 0.36, 0.05, 0.32, RED, 2.55, 1.085, -0.55, bevel=0.015)
box("SharpsLabel", 0.2, 0.12, 0.005, WHITE, 2.55, 0.9, -0.398, bevel=0)

# ---------------- wall clock (hands pivot at centre) ----------------
cyl("ClockFace", 0.24, 0.03, CLOCKF, -0.9, 2.45, -2.98, axis="z", verts=48)
bpy.ops.mesh.primitive_torus_add(major_radius=0.24, minor_radius=0.018, location=T(-0.9, 2.45, -2.965), rotation=(math.pi / 2, 0, 0))
rim = bpy.context.object; rim.name = "ClockRim"; finish(rim, NAVY, smooth=True)
for k in range(12):
    a = k * math.pi / 6
    box(f"Tick{k}", 0.012, 0.035, 0.005, NAVY, -0.9 + math.sin(a) * 0.2, 2.45 + math.cos(a) * 0.2, -2.962, bevel=0, rot=(0, -a, 0))
for nm, length, wdt, m in (("ClockHour", 0.13, 0.02, NAVY), ("ClockMin", 0.19, 0.012, ACCENT)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    h = bpy.context.object; h.name = nm; h.scale = (wdt, 0.008, length)
    bpy.ops.object.transform_apply(scale=True)
    for v in h.data.vertices:
        v.co.z += length / 2  # pivot at one end
    h.location = T(-0.9, 2.45, -2.955)
    finish(h, m)

# ---------------- decor ----------------
cyl("PlantPot", 0.17, 0.4, POT, 3.1, 0.2, -2.55, r2=0.14)
for i in range(9):
    sphere(f"Leaf{i}", 0.17, LEAF, 3.1 + math.sin(i * 2.1) * 0.15, 0.55 + i * 0.065, -2.55 + math.cos(i * 2.1) * 0.15, scale=(1, 0.8, 1))
box("Shelf", 1.3, 0.05, 0.3, WOOD, -1.4, 2.05, -2.85)
for i, (c, x) in enumerate((("#5fb3d9", -1.85), ("#f2c35b", -1.62), ("#e57373", -1.4))):
    box(f"Binder{i}", 0.16, 0.3, 0.22, mat(f"Binder{i}", c, 0.6), x, 2.23, -2.85)
box("PosterFrame", 0.86, 1.11, 0.03, WOOD_D, -0.6, 1.75, -2.985, bevel=0.005)
box("CalendarBoard", 0.66, 0.56, 0.02, WOOD_D, -2.6, 1.6, -2.985, bevel=0.005)
box("Screen0", 0.04, 1.6, 0.7, mat("ScreenFrame", "#a9b9c2", 0.5), 1.95, 0.85, -2.55, bevel=0.01)
box("ScreenFabric", 0.02, 1.4, 0.6, CURTAIN, 1.95, 0.9, -2.55, bevel=0)

# ---------------- stations (where the character stands; three.js coords) ----------------
for name, (x, z) in {"desk": (-1.55, -1.6), "sink": (-2.45, 0.35), "bed": (0.55, -2.45), "bedClose": (0.55, -2.45),
                     "sharps": (2.05, -0.25), "center": (0.3, 0.75), "overview": (0.3, 0.7)}.items():
    empty(f"Station_{name}", x, 0, z)

if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True,
                          export_extras=False, export_cameras=False, export_lights=False)
print("exported", OUT, "objects:", len(bpy.data.objects))

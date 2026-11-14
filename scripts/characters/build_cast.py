"""
Build the OpenPodium / 体态镜 character set in headless Blender.

Source: MakeHuman plugin for Blender (MPFB) CC0 basemesh + macros.
Our modifications (沉思波 · 体态镜): proportions, skin tones, school uniforms
and business-casual clothes, mesh hair, and classroom animations.

Usage (from the repo, after Blender + MPFB are installed):

  export BLENDER_USER_RESOURCES=/workspace/tools/blender-user
  /workspace/tools/blender -b -P scripts/characters/build_cast.py -- /path/to/out
"""
from __future__ import annotations

import os
import sys
import importlib
import math
from mathutils import Vector, Euler, Matrix

import bpy
import bmesh

# ---------------------------------------------------------------------------
# MPFB
# ---------------------------------------------------------------------------

def dynamic_import(absolute_package_str, key):
    for amod in sys.modules:
        if amod.endswith(absolute_package_str):
            mod = importlib.import_module(amod)
            if not hasattr(mod, key):
                raise AttributeError(f"{amod} has no {key}")
            return getattr(mod, key)
    raise ValueError(f"No module ending in {absolute_package_str}")


def ensure_mpfb():
    mods = [a.module for a in bpy.context.preferences.addons]
    if not any("mpfb" in m for m in mods):
        bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")


# ---------------------------------------------------------------------------
# Character cards (our 二改)
# ---------------------------------------------------------------------------

# age: baby=0, child=0.1875, young=0.5, old=1
# gender: 0 female, 1 male

STUDENTS = [
    dict(id="s1", name="LinQiu", label="林秋", role="student",
         gender=0.15, age=0.32, height=0.42, weight=0.45, muscle=0.35,
         asian=0.85, african=0.05, caucasian=0.10,
         skin=(0.83, 0.66, 0.52), hair=(0.08, 0.06, 0.05), hair_style="bob",
         sweater=(0.15, 0.28, 0.38), pants=(0.12, 0.16, 0.22), skirt=True,
         raise_hand="l"),
    dict(id="s2", name="ZhouNan", label="周南", role="student",
         gender=0.85, age=0.34, height=0.55, weight=0.48, muscle=0.5,
         asian=0.8, african=0.05, caucasian=0.15,
         skin=(0.72, 0.54, 0.40), hair=(0.07, 0.05, 0.04), hair_style="short",
         sweater=(0.18, 0.32, 0.30), pants=(0.14, 0.16, 0.20), skirt=False,
         raise_hand="r"),
    dict(id="s3", name="ChenHe", label="陈禾", role="student",
         gender=0.4, age=0.30, height=0.46, weight=0.42, muscle=0.38,
         asian=0.7, african=0.12, caucasian=0.18,
         skin=(0.62, 0.44, 0.32), hair=(0.12, 0.07, 0.04), hair_style="ponytail",
         sweater=(0.22, 0.18, 0.28), pants=(0.13, 0.14, 0.18), skirt=False,
         raise_hand="r"),
    dict(id="s4", name="MaYan", label="马言", role="student",
         gender=0.9, age=0.36, height=0.62, weight=0.58, muscle=0.55,
         asian=0.75, african=0.08, caucasian=0.17,
         skin=(0.78, 0.60, 0.46), hair=(0.10, 0.07, 0.05), hair_style="short",
         sweater=(0.16, 0.22, 0.36), pants=(0.12, 0.14, 0.18), skirt=False,
         raise_hand="l"),
    dict(id="s5", name="XuQing", label="许青", role="student",
         gender=0.12, age=0.31, height=0.48, weight=0.40, muscle=0.32,
         asian=0.88, african=0.04, caucasian=0.08,
         skin=(0.86, 0.70, 0.56), hair=(0.09, 0.06, 0.05), hair_style="bun",
         sweater=(0.28, 0.16, 0.16), pants=(0.14, 0.12, 0.16), skirt=True,
         raise_hand="r"),
]

GUESTS = [
    dict(id="g1", name="ChenJudge", label="陈评委", role="guest",
         gender=0.9, age=0.62, height=0.62, weight=0.55, muscle=0.5,
         asian=0.8, african=0.05, caucasian=0.15,
         skin=(0.74, 0.56, 0.42), hair=(0.12, 0.10, 0.09), hair_style="short",
         jacket=(0.18, 0.18, 0.18), shirt=(0.92, 0.90, 0.86), pants=(0.14, 0.14, 0.15),
         skirt=False, raise_hand="r"),
    dict(id="g2", name="WangTeacher", label="王老师", role="guest",
         gender=0.2, age=0.58, height=0.52, weight=0.50, muscle=0.4,
         asian=0.82, african=0.05, caucasian=0.13,
         skin=(0.80, 0.64, 0.50), hair=(0.16, 0.10, 0.07), hair_style="bob",
         jacket=(0.22, 0.28, 0.24), shirt=(0.93, 0.91, 0.86), pants=(0.16, 0.16, 0.16),
         skirt=False, raise_hand="l"),
    dict(id="g3", name="ZhaoGuest", label="赵嘉宾", role="guest",
         gender=0.7, age=0.48, height=0.58, weight=0.48, muscle=0.48,
         asian=0.7, african=0.1, caucasian=0.2,
         skin=(0.68, 0.50, 0.38), hair=(0.07, 0.05, 0.04), hair_style="short",
         jacket=(0.32, 0.18, 0.16), shirt=(0.90, 0.88, 0.82), pants=(0.15, 0.14, 0.14),
         skirt=False, raise_hand="r"),
]

TEACHER = dict(
    id="teacher", name="Presenter", label="试讲老师", role="teacher",
    gender=0.55, age=0.46, height=0.58, weight=0.50, muscle=0.48,
    asian=0.78, african=0.06, caucasian=0.16,
    skin=(0.79, 0.62, 0.48), hair=(0.09, 0.07, 0.05), hair_style="short",
    jacket=(0.16, 0.24, 0.28), shirt=(0.93, 0.90, 0.84), pants=(0.13, 0.13, 0.14),
    skirt=False, raise_hand="r",
)

FPS = 24


def out_dir():
    args = sys.argv
    rest = args[args.index("--") + 1:] if "--" in args else args[1:]
    if "--out" in rest:
        i = rest.index("--out")
        if i + 1 < len(rest):
            return os.path.abspath(rest[i + 1])
    # a bare path (not a flag) after --
    for tok in rest:
        if not tok.startswith("-"):
            return os.path.abspath(tok)
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "../../assets/characters"))


# ---------------------------------------------------------------------------
# Mesh helpers
# ---------------------------------------------------------------------------

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    if bpy.data.objects:
        bpy.ops.object.delete()
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for x in list(block):
            if x.users == 0:
                block.remove(x)


def mat(name, color, roughness=0.55, specular=0.2):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    principled = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    principled.inputs["Base Color"].default_value = (*color, 1)
    principled.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in principled.inputs:
        principled.inputs["Specular IOR Level"].default_value = specular
    m.diffuse_color = (*color, 1)
    return m


def clear_shape_keys(obj):
    """Macros already baked into the basis; drop keys so modifiers can apply."""
    if obj.data.shape_keys:
        obj.shape_key_clear()


def select_only(obj):
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def delete_groups(obj, names_or_prefixes):
    """Delete vertices belonging to named groups / prefixes (helpers, joint cubes)."""
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.select_mode(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    groups = []
    for g in obj.vertex_groups:
        if any(g.name == n or g.name.startswith(n) for n in names_or_prefixes):
            groups.append(g)
    if not groups:
        return
    for v in obj.data.vertices:
        v.select = False
    for v in obj.data.vertices:
        for vg in v.groups:
            if any(vg.group == g.index and vg.weight > 0.01 for g in groups):
                v.select = True
                break
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")


def world_co(obj, v):
    return obj.matrix_world @ v.co


def verts_by_height(obj, zmin, zmax, also=None):
    """Return vertex indices whose world-space Z is in [zmin, zmax]."""
    idxs = []
    for v in obj.data.vertices:
        w = world_co(obj, v)
        if zmin <= w.z <= zmax:
            # "also" is evaluated in character-local space so side filters
            # still work when the rig has been moved along X.
            if also and not also(v.co):
                continue
            idxs.append(v.index)
    return idxs


def duplicate_as(obj, name):
    select_only(obj)
    bpy.ops.object.duplicate()
    dup = bpy.context.active_object
    dup.name = name
    if dup.data:
        dup.data = dup.data.copy()
        dup.data.name = name
    return dup


def keep_only_indices(obj, indices):
    select_only(obj)
    keep = set(indices)
    for v in obj.data.vertices:
        v.select = v.index not in keep
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0001)
    bpy.ops.object.mode_set(mode="OBJECT")


def inflate(obj, amount):
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.transform.shrink_fatten(value=amount)
    bpy.ops.object.mode_set(mode="OBJECT")
    # thin solidify so garments have thickness
    mod = obj.modifiers.new("solid", "SOLIDIFY")
    mod.thickness = max(0.004, amount * 0.6)
    mod.offset = 1
    bpy.ops.object.modifier_apply(modifier=mod.name)


def bind_to_armature(mesh, arm, copy_from=None):
    # parent
    mesh.parent = arm
    if copy_from is not None:
        # data transfer of vertex groups + add armature modifier
        for g in copy_from.vertex_groups:
            if g.name not in mesh.vertex_groups:
                mesh.vertex_groups.new(name=g.name)
        dt = mesh.modifiers.new("xfer", "DATA_TRANSFER")
        dt.object = copy_from
        dt.use_vert_data = True
        dt.data_types_verts = {"VGROUP_WEIGHTS"}
        dt.vert_mapping = "POLYINTERP_NEAREST"
        dt.use_max_distance = False
        select_only(mesh)
        bpy.ops.object.modifier_apply(modifier=dt.name)
    else:
        select_only(mesh)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        mesh.parent = arm
    # ensure armature modifier
    if not any(m.type == "ARMATURE" for m in mesh.modifiers):
        am = mesh.modifiers.new("arm", "ARMATURE")
        am.object = arm
    else:
        for m in mesh.modifiers:
            if m.type == "ARMATURE":
                m.object = arm


def decimate(obj, ratio=0.4, min_faces=800):
    faces = len(obj.data.polygons)
    if faces <= min_faces:
        return
    target_ratio = max(ratio, min_faces / max(1, faces))
    select_only(obj)
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.ratio = target_ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)


def shade_smooth(obj):
    select_only(obj)
    bpy.ops.object.shade_smooth()
    if hasattr(obj.data, "use_auto_smooth"):
        obj.data.use_auto_smooth = True
        obj.data.auto_smooth_angle = math.radians(45)


# ---------------------------------------------------------------------------
# Clothes & hair (our meshes)
# ---------------------------------------------------------------------------

def make_garment(body, name, zmin, zmax, inflate_amt, material, also=None):
    idxs = verts_by_height(body, zmin, zmax, also=also)
    if len(idxs) < 20:
        return None
    g = duplicate_as(body, name)
    clear_shape_keys(g)
    # drop leftover modifiers from body (armature etc.) so we start clean
    for m in list(g.modifiers):
        g.modifiers.remove(m)
    keep_only_indices(g, idxs)
    inflate(g, inflate_amt)
    g.data.materials.clear()
    g.data.materials.append(material)
    return g


def make_hair(body, style, material, arm):
    """Simple mesh hair from the scalp, parented to the head bone."""
    scalp = body.vertex_groups.get("scalp")
    idxs = []
    if scalp:
        for v in body.data.vertices:
            for vg in v.groups:
                if vg.group == scalp.index and vg.weight > 0.2:
                    idxs.append(v.index)
                    break
    if len(idxs) < 10:
        idxs = verts_by_height(body, 1.18, 2.0, also=lambda c: c.z > 1.18)
    if len(idxs) < 8:
        return None
    hair = duplicate_as(body, body.name + "_hair")
    for m in list(hair.modifiers):
        hair.modifiers.remove(m)
    keep_only_indices(hair, idxs)
    inflate(hair, 0.018 if style != "short" else 0.012)
    # extra volume / tails
    if style in ("bob", "ponytail", "bun"):
        # inflate back of head a bit more
        select_only(hair)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.extrude_region_move(TRANSFORM_OT_translate={"value": (0, 0.01, 0.008 if style != "bob" else 0.0)})
        bpy.ops.object.mode_set(mode="OBJECT")
    if style == "ponytail":
        # a small tail behind the head
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.045, location=(0, 0.07, 1.22))
        tail = bpy.context.active_object
        tail.name = body.name + "_tail"
        bpy.ops.transform.resize(value=(0.55, 1.6, 0.55))
        tail.data.materials.append(material)
        bind_to_head(tail, arm)
    if style == "bun":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.055, location=(0, 0.09, 1.32))
        bun = bpy.context.active_object
        bun.name = body.name + "_bun"
        bun.data.materials.append(material)
        bind_to_head(bun, arm)
    hair.data.materials.clear()
    hair.data.materials.append(material)
    bind_to_armature(hair, arm, copy_from=body)
    shade_smooth(hair)
    return hair


def bind_to_head(obj, arm):
    """Parent a small accessory to the head bone."""
    obj.parent = arm
    obj.parent_type = "BONE"
    if "head" in arm.data.bones:
        obj.parent_bone = "head"
        # convert world loc to head-bone space roughly: keep world, Blender will
        # treat location as bone-local after parenting — fix by clearing.
        # Safer: use armature modifier with all weight on head.
        obj.parent_type = "OBJECT"
        obj.parent = arm
        vg = obj.vertex_groups.new(name="head")
        vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        am = obj.modifiers.new("arm", "ARMATURE")
        am.object = arm



def voxel_remesh(obj, size=0.022):
    """Turn the body-hugging shell into a puffy, hole-free garment before binding."""
    select_only(obj)
    mod = obj.modifiers.new("voxel_rm", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = size
    mod.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    shade_smooth(obj)

def delete_indices(obj, indices):
    if not indices:
        return
    select_only(obj)
    keep = set(indices)
    for v in obj.data.vertices:
        v.select = v.index in keep
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.mesh.fill_holes(sides=0)
    except Exception:
        pass
    bpy.ops.object.mode_set(mode="OBJECT")


def body_shell(body, name, material, inflate_amt, drop_pred):
    """Duplicate the whole body, drop only unwanted verts (e.g. the head), inflate.
    Avoids the torn 'slice' edges of cutting a mid-body band."""
    g = duplicate_as(body, name)
    clear_shape_keys(g)
    for m in list(g.modifiers):
        g.modifiers.remove(m)
    drop = [v.index for v in g.data.vertices if drop_pred(v.co)]
    print("  shell drop verts", len(drop), "of", len(g.data.vertices))
    delete_indices(g, drop)
    if inflate_amt:
        inflate(g, inflate_amt)
    voxel_remesh(g, 0.022)
    g.data.materials.clear()
    g.data.materials.append(material)
    # paint a second material on lower verts when a tuple (mat_upper, mat_lower, z_cut) is passed? done by caller.
    return g


def assign_strict(obj, upper, lower, belt, shoe, z_pants=0.70, z_shoe=0.09):
    """Assign by the face's min/max z so the waist isn't a jagged sawtooth."""
    obj.data.materials.clear()
    for m in (upper, lower, belt, shoe):
        obj.data.materials.append(m)
    for p in obj.data.polygons:
        zs = [obj.data.vertices[i].co.z for i in p.vertices]
        lo, hi = min(zs), max(zs)
        if hi <= z_shoe:
            p.material_index = 3
        elif hi <= z_pants:
            p.material_index = 1
        elif lo >= z_pants + 0.04:
            p.material_index = 0
        else:
            p.material_index = 2

def assign_by_height(obj, materials):

    """materials: list of (mat, zmin, zmax). Later entries override."""
    obj.data.materials.clear()
    for mat, _a, _b in materials:
        obj.data.materials.append(mat)
    for v in obj.data.vertices:
        v.select = False
    for slot, (_mat, zmin, zmax) in enumerate(materials):
        for p in obj.data.polygons:
            zs = [obj.data.vertices[i].co.z for i in p.vertices]
            z = sum(zs) / len(zs)
            if zmin <= z <= zmax:
                p.material_index = slot


def dress(body, arm, card):
    zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]
    print("  body world Z", round(min(zs), 3), round(max(zs), 3), "verts", len(zs), "origin", tuple(round(x,3) for x in body.location))
    skin = mat(card["id"] + "_skin", card["skin"], roughness=0.62)
    body.data.materials.clear()
    body.data.materials.append(skin)

    # Cut the uniform shell just under the chin so face, scalp and ears stay as skin.
    # Do not use raw bone head_local: MPFB bones may be in a different unit and
    # would push the cut above the mesh (0 verts deleted).
    zmax = max(v.co.z for v in body.data.vertices) or 1.66
    # Chin / base of neck is near 0.85 of stature (1.42 m on a 1.67 m figure).
    # 0.68 was mid-chest and cut the uniform into a torn strapless band.
    head_z = zmax * 0.85
    print("  shell cut z", round(head_z, 3), "of", round(zmax, 3))
    def drop_head(c):
        return c.z >= head_z

    shirt_col = card.get("shirt", (0.93, 0.93, 0.90))
    sweater_col = card.get("sweater", card.get("jacket", (0.18, 0.24, 0.30)))
    pants_col = card.get("pants", (0.13, 0.14, 0.16))
    sock_col = (0.90, 0.90, 0.88) if card["role"] == "student" else pants_col
    shoe_col = (0.08, 0.07, 0.06)

    shell_m = mat(card["id"] + "_shell", sweater_col, roughness=0.7)
    shell = body_shell(body, card["id"] + "_uniform", shell_m, 0.018, drop_head)
    # Regional colours on the same shell: shoes, socks/trousers, sweater/jacket, collar.
    shoe_m = mat(card["id"] + "_shoe", shoe_col, roughness=0.45)
    pants_m = mat(card["id"] + "_pants", pants_col, roughness=0.68)
    sock_m = mat(card["id"] + "_sock", sock_col, roughness=0.8)
    collar_m = mat(card["id"] + "_collar", shirt_col, roughness=0.65)
    if card["role"] == "student":
        belt_m = mat(card["id"] + "_belt", (0.18, 0.16, 0.14), roughness=0.6)
        assign_strict(shell, shell_m, pants_m, belt_m, shoe_m, z_pants=0.70, z_shoe=0.09)
        skirt = None
    else:
        jacket_m = mat(card["id"] + "_jacket", sweater_col, roughness=0.6)
        belt_m = mat(card["id"] + "_belt", (0.16, 0.14, 0.12), roughness=0.55)
        assign_strict(shell, jacket_m, pants_m, belt_m, shoe_m, z_pants=0.70, z_shoe=0.09)
        skirt = None

    pieces = [shell]
    if card.get("skirt"):
        pieces.append(skirt)

    hair_m = mat(card["id"] + "_hair", card["hair"], roughness=0.45)
    make_hair(body, card["hair_style"], hair_m, arm)
    for pce in pieces:
        if not pce:
            continue
        shade_smooth(pce)
        decimate(pce, 0.72, min_faces=1200)
        bind_to_armature(pce, arm, copy_from=body)
    return pieces


# ---------------------------------------------------------------------------
# Animation
# ---------------------------------------------------------------------------

def pb(arm, name):
    return arm.pose.bones.get(name)


def reset_pose(arm):
    for b in arm.pose.bones:
        b.rotation_mode = "XYZ"
        b.rotation_euler = (0, 0, 0)
        b.location = (0, 0, 0)
        b.scale = (1, 1, 1)


def key_all(arm, frame):
    for b in arm.pose.bones:
        b.keyframe_insert("rotation_euler", frame=frame)
        b.keyframe_insert("location", frame=frame)


def set_euler(arm, name, rx=0, ry=0, rz=0, loc=None):
    b = pb(arm, name)
    if not b:
        return
    b.rotation_mode = "XYZ"
    b.rotation_euler = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ")
    if loc is not None:
        b.location = Vector(loc)


def sit_pose(arm, sink=0.22):
    """Seated at a desk: thighs almost level, calves down, slight settled spine."""
    # Move the root down so hips meet a chair (~0.45 m).
    set_euler(arm, "Root", loc=(0, 0.05, -sink))
    # thighs forward (rotate around local X — may need a sign flip after preview)
    set_euler(arm, "thigh_l", rx=78)
    set_euler(arm, "thigh_r", rx=78)
    set_euler(arm, "calf_l", rx=-82)
    set_euler(arm, "calf_r", rx=-82)
    set_euler(arm, "foot_l", rx=4)
    set_euler(arm, "foot_r", rx=4)
    set_euler(arm, "spine_01", rx=8)
    set_euler(arm, "spine_02", rx=4)
    set_euler(arm, "upperarm_l", rx=18, rz=8)
    set_euler(arm, "upperarm_r", rx=18, rz=-8)
    set_euler(arm, "lowerarm_l", rx=-28)
    set_euler(arm, "lowerarm_r", rx=-28)


def add_action(arm, name, frames, setup_fn, loop=True):
    """setup_fn(arm, t01, frame) sets the pose for a normalized time in 0..1."""
    select_only(arm)
    bpy.ops.object.mode_set(mode="POSE")
    reset_pose(arm)
    clip = name
    prefix = arm.name.replace("_rig", "")
    act_name = f"{prefix}_{clip}"
    act = bpy.data.actions.new(act_name)
    act["clip"] = clip
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    for i in range(frames + 1):
        t = i / frames
        setup_fn(arm, t, i)
        key_all(arm, i + 1)
    if loop:
        for fc in act.fcurves:
            fc.modifiers.new("CYCLES")
            # actually CYCLES may overshoot; use interpolate last=first instead
            fc.modifiers.remove(fc.modifiers[-1])
    # force loop: copy frame 1 to last
    setup_fn(arm, 0, 1)
    key_all(arm, frames + 1)
    act.use_fake_user = True
    bpy.ops.object.mode_set(mode="OBJECT")
    return act, clip


def anim_idle_sit(arm, side="r"):
    def fn(a, t, f):
        sit_pose(a)
        breath = math.sin(t * math.tau) * 1.2
        set_euler(a, "spine_02", rx=4 + breath)
        set_euler(a, "spine_03", rx=breath * 0.6)
        set_euler(a, "head", rx=breath * 0.4, ry=math.sin(t * math.tau * 0.5) * 2)
        set_euler(a, "upperarm_l", rx=18, rz=8 + math.sin(t * math.tau) * 1.5)
        set_euler(a, "upperarm_r", rx=18, rz=-8 - math.sin(t * math.tau) * 1.5)
    return add_action(arm, "idle_sit", 48, fn)


def anim_raise_hand(arm, side="r"):
    def fn(a, t, f):
        sit_pose(a)
        k = (1 - math.cos(min(1, t * 1.2) * math.pi)) * 0.5 if t < 0.85 else 1
        if t > 0.85:
            k = 1 - (t - 0.85) / 0.15 * 0.15  # hold mostly up
        bone_u = f"upperarm_{side}"
        bone_c = f"clavicle_{side}"
        bone_l = f"lowerarm_{side}"
        # lift upper arm (sign found by later preview; start with -rx)
        if side == "r":
            set_euler(a, bone_c, rz=-18 * k)
            set_euler(a, bone_u, rx=-10 * k, rz=-70 * k)
            set_euler(a, bone_l, rx=-20 * k, rz=-10 * k)
        else:
            set_euler(a, bone_c, rz=18 * k)
            set_euler(a, bone_u, rx=-10 * k, rz=70 * k)
            set_euler(a, bone_l, rx=-20 * k, rz=10 * k)
        set_euler(a, "head", ry=(6 if side == "r" else -6) * k * 0.3)
    return add_action(arm, "raise_hand", 36, fn)


def anim_nod(arm):
    def fn(a, t, f):
        sit_pose(a)
        n = math.sin(t * math.tau * 2) * 10
        set_euler(a, "head", rx=n)
        set_euler(a, "neck_01", rx=n * 0.3)
    return add_action(arm, "nod", 32, fn)


def anim_confused(arm):
    def fn(a, t, f):
        sit_pose(a)
        k = (1 - math.cos(t * math.tau)) * 0.5
        set_euler(a, "head", rz=14 * k, rx=6 * k, ry=-4 * k)
        set_euler(a, "neck_01", rz=6 * k)
        set_euler(a, "upperarm_l", rx=28, rz=16)
        set_euler(a, "lowerarm_l", rx=-70 * k - 20)
    return add_action(arm, "confused", 40, fn)


def anim_distracted(arm):
    def fn(a, t, f):
        sit_pose(a)
        k = min(1, t * 2) if t < 0.8 else 1
        set_euler(a, "head", rx=22 * k, ry=18 * k)
        set_euler(a, "neck_01", rx=8 * k, ry=8 * k)
        set_euler(a, "spine_02", ry=6 * k)
        # left hand in the lap, looking down (phone)
        set_euler(a, "upperarm_l", rx=35 * k + 10, rz=18)
        set_euler(a, "lowerarm_l", rx=-70 * k - 10)
        set_euler(a, "hand_l", rx=-20 * k)
    return add_action(arm, "distracted", 48, fn)


def anim_group_read(arm):
    """齐读：仍坐着，微微前倾，像看着课本当堂齐读。"""
    def fn(a, t, f):
        sit_pose(a)
        w = math.sin(t * math.tau * 2)
        set_euler(a, "spine_01", rx=12)
        set_euler(a, "spine_02", rx=8)
        set_euler(a, "head", rx=16 + 2 * w)
        set_euler(a, "neck_01", rx=6)
        set_euler(a, "upperarm_l", rx=28, rz=14)
        set_euler(a, "upperarm_r", rx=28, rz=-14)
        set_euler(a, "lowerarm_l", rx=-50)
        set_euler(a, "lowerarm_r", rx=-50)
    return add_action(arm, "group_read", 40, fn)


def anim_stand_to_read(arm, side="r"):
    """请你来读：从坐到站，双手持书，面向前方。"""
    def fn(a, t, f):
        # 0–0.45 起身，之后站着读
        k = min(1, t / 0.45)
        ease = 0.5 - 0.5 * math.cos(k * math.pi)
        sit_pose(a, sink=0.22 * (1 - ease))
        if ease > 0:
            # blend towards a standing reading pose
            set_euler(a, "Root", loc=(0, 0.02 * (1 - ease), -0.22 * (1 - ease)))
            set_euler(a, "thigh_l", rx=78 * (1 - ease))
            set_euler(a, "thigh_r", rx=78 * (1 - ease))
            set_euler(a, "calf_l", rx=-82 * (1 - ease))
            set_euler(a, "calf_r", rx=-82 * (1 - ease))
            set_euler(a, "spine_01", rx=8 * (1 - ease) + 4 * ease)
            set_euler(a, "upperarm_l", rx=18 * (1 - ease) + 30 * ease, rz=8 + 6 * ease)
            set_euler(a, "upperarm_r", rx=18 * (1 - ease) + 30 * ease, rz=-8 - 6 * ease)
            set_euler(a, "lowerarm_l", rx=-28 * (1 - ease) - 50 * ease)
            set_euler(a, "lowerarm_r", rx=-28 * (1 - ease) - 50 * ease)
            set_euler(a, "head", rx=8 * ease)
        w = math.sin(t * math.tau * 2) if t > 0.45 else 0
        if t > 0.45:
            set_euler(a, "head", rx=8 + 2 * w)
    return add_action(arm, "stand_to_read", 48, fn)


def anim_speak(arm, side="r"):
    def fn(a, t, f):
        sit_pose(a)
        w = math.sin(t * math.tau)
        set_euler(a, "head", rx=3 * w, ry=4 * math.sin(t * math.tau * 0.5))
        if side == "r":
            set_euler(a, "upperarm_r", rx=20 + 10 * w, rz=-22)
            set_euler(a, "lowerarm_r", rx=-40 - 10 * w)
        else:
            set_euler(a, "upperarm_l", rx=20 + 10 * w, rz=22)
            set_euler(a, "lowerarm_l", rx=-40 - 10 * w)
    return add_action(arm, "speak", 40, fn)


def anim_ask(arm, side="r"):
    def fn(a, t, f):
        sit_pose(a)
        k = (1 - math.cos(min(1, t * 1.4) * math.pi)) * 0.5
        set_euler(a, "head", rx=-4, ry=(-6 if side == "r" else 6))
        bone_u = f"upperarm_{side}"
        bone_l = f"lowerarm_{side}"
        if side == "r":
            set_euler(a, bone_u, rx=8, rz=-40 * k)
            set_euler(a, bone_l, rx=-8)
            set_euler(a, "hand_r", rz=-10 * k)
        else:
            set_euler(a, bone_u, rx=8, rz=40 * k)
            set_euler(a, bone_l, rx=-8)
            set_euler(a, "hand_l", rz=10 * k)
    return add_action(arm, "ask", 40, fn)


def stand_pose(arm):
    reset_pose(arm)
    set_euler(arm, "upperarm_l", rx=8, rz=6)
    set_euler(arm, "upperarm_r", rx=8, rz=-6)
    set_euler(arm, "lowerarm_l", rx=-8)
    set_euler(arm, "lowerarm_r", rx=-8)


def anim_idle_stand(arm):
    def fn(a, t, f):
        stand_pose(a)
        b = math.sin(t * math.tau)
        set_euler(a, "spine_02", rx=1.2 * b)
        set_euler(a, "head", ry=3 * math.sin(t * math.tau * 0.5), rx=1 * b)
        set_euler(a, "upperarm_l", rx=8 + b, rz=6)
        set_euler(a, "upperarm_r", rx=8 - b, rz=-6)
    return add_action(arm, "idle_stand", 48, fn)


def anim_talk(arm):
    def fn(a, t, f):
        stand_pose(a)
        w = math.sin(t * math.tau)
        w2 = math.sin(t * math.tau * 2)
        set_euler(a, "head", rx=3 * w, ry=5 * math.sin(t * math.tau * 0.5))
        set_euler(a, "spine_03", ry=3 * w)
        set_euler(a, "upperarm_r", rx=16 + 12 * w, rz=-26 - 8 * w)
        set_euler(a, "lowerarm_r", rx=-30 - 16 * w)
        set_euler(a, "hand_r", rz=-8 * w2)
        set_euler(a, "upperarm_l", rx=10, rz=8)
    return add_action(arm, "talk", 48, fn)


def anim_talk_gesture(arm):
    def fn(a, t, f):
        stand_pose(a)
        k = 0.5 - 0.5 * math.cos(t * math.tau)
        set_euler(a, "upperarm_r", rx=20, rz=-50 * k - 10)
        set_euler(a, "lowerarm_r", rx=-20)
        set_euler(a, "head", ry=-8 * k)
        set_euler(a, "spine_02", ry=-4 * k)
    return add_action(arm, "talk_gesture", 36, fn)


def anim_walk(arm):
    def fn(a, t, f):
        stand_pose(a)
        ph = t * math.tau
        th = math.sin(ph) * 28
        tk = -abs(math.sin(ph)) * 20
        set_euler(a, "thigh_l", rx=th)
        set_euler(a, "thigh_r", rx=-th)
        set_euler(a, "calf_l", rx=tk if th > 0 else -6)
        set_euler(a, "calf_r", rx=tk if th < 0 else -6)
        set_euler(a, "upperarm_l", rx=8 - th * 0.4, rz=6)
        set_euler(a, "upperarm_r", rx=8 + th * 0.4, rz=-6)
        set_euler(a, "spine_02", ry=math.sin(ph) * 2)
        # in-place walk; slight vertical bob
        set_euler(a, "Root", loc=(0, 0, abs(math.sin(ph)) * 0.012))
    return add_action(arm, "walk", 32, fn)


def anim_turn_board(arm):
    def fn(a, t, f):
        stand_pose(a)
        k = (1 - math.cos(min(1, t) * math.pi)) * 0.5
        # turn to the (stage) right, as the product's board default
        set_euler(a, "Root", ry=-55 * k, loc=(0.08 * k, 0, 0))
        set_euler(a, "spine_01", ry=-10 * k)
        set_euler(a, "head", ry=-8 * k, rx=6 * k)
        set_euler(a, "upperarm_r", rx=20 * k, rz=-30 * k)
        set_euler(a, "lowerarm_r", rx=-40 * k)
    return add_action(arm, "turn_board", 48, fn)


def stash_nla(arm, actions):
    """Push every clip onto an NLA track so glTF exports them all (not just the last)."""
    if arm.animation_data is None:
        arm.animation_data_create()
    # clear leftover tracks
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
    for act, clip in actions:
        track = arm.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, 1, act)
        strip.action = act
    arm.animation_data.action = None


def add_character_anims(arm, card):
    acts = []
    if card["role"] == "teacher":
        acts += [anim_idle_stand(arm), anim_talk(arm), anim_talk_gesture(arm), anim_walk(arm), anim_turn_board(arm)]
    elif card["role"] == "guest":
        side = card.get("raise_hand", "r")
        acts += [anim_idle_sit(arm), anim_ask(arm, side), anim_nod(arm), anim_speak(arm, side), anim_confused(arm)]
    else:
        side = card.get("raise_hand", "r")
        acts += [anim_idle_sit(arm, side), anim_raise_hand(arm, side), anim_nod(arm), anim_confused(arm), anim_distracted(arm), anim_speak(arm, side), anim_group_read(arm), anim_stand_to_read(arm, side)]
    stash_nla(arm, acts)


# ---------------------------------------------------------------------------
# Build one character
# ---------------------------------------------------------------------------

def apply_macros(basemesh, card, HumanObjectProperties, TargetService):
    for key in ("gender", "age", "height", "weight", "muscle", "african", "asian", "caucasian"):
        HumanObjectProperties.set_value(key, float(card[key]), entity_reference=basemesh)
    TargetService.reapply_macro_details(basemesh)


def build_one(card, HumanService, HumanObjectProperties, TargetService, origin=(0, 0, 0)):
    basemesh = HumanService.create_human(mask_helpers=True, detailed_helpers=False, extra_vertex_groups=True, scale=0.1)
    apply_macros(basemesh, card, HumanObjectProperties, TargetService)
    # helpers off the export
    delete_groups(basemesh, ["HelperGeometry", "JointCubes", "helper-", "joint-"])
    clear_shape_keys(basemesh)
    shade_smooth(basemesh)
    rig = HumanService.add_builtin_rig(basemesh, "game_engine")
    rig.name = card["id"] + "_rig"
    basemesh.name = card["id"] + "_body"
    dress(basemesh, rig, card)
    decimate(basemesh, 0.38, min_faces=3500)
    add_character_anims(rig, card)
    # move the whole rig
    rig.location = Vector(origin)
    # custom property for UI
    rig["character_id"] = card["id"]
    rig["character_label"] = card["label"]
    rig["character_role"] = card["role"]
    return rig


def export_glb(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    # also select children
    def sel(o):
        o.hide_set(False)
        o.select_set(True)
        for c in o.children:
            sel(c)
    for o in objects:
        sel(o)
    bpy.context.view_layer.objects.active = objects[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=True,
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_apply=True,
        export_image_format="NONE",
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_extras=True,
    )
    print("exported", path, "bytes", os.path.getsize(path))


# ---------------------------------------------------------------------------
# Classroom / podium sets (our models, no third-party scene packs)
# ---------------------------------------------------------------------------

def box(name, size, loc, material, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if rot:
        o.rotation_euler = rot
        bpy.ops.object.transform_apply(rotation=True)
    o.data.materials.append(material)
    return o


def build_classroom(n_desks=5):
    wood = mat("wood", (0.45, 0.32, 0.20), roughness=0.7)
    wood_dk = mat("wood_dk", (0.28, 0.18, 0.10), roughness=0.7)
    paper = mat("paper_wall", (0.86, 0.82, 0.74), roughness=0.85)
    floor_m = mat("floor", (0.55, 0.48, 0.38), roughness=0.8)
    board_m = mat("blackboard", (0.12, 0.18, 0.16), roughness=0.55)
    chalk = mat("chalk_tray", (0.62, 0.50, 0.32), roughness=0.6)
    objs = []
    objs.append(box("floor", (7.0, 6.0, 0.04), (0, 0, -0.02), floor_m))
    objs.append(box("back_wall", (7.0, 0.08, 2.6), (0, 2.4, 1.3), paper))
    objs.append(box("blackboard", (3.2, 0.06, 1.5), (0, 2.34, 1.45), board_m))
    objs.append(box("board_frame_b", (3.3, 0.08, 0.06), (0, 2.33, 0.68), wood_dk))
    objs.append(box("board_tray", (3.2, 0.12, 0.04), (0, 2.28, 0.66), chalk))
    # desks in a shallow arc facing +Y (the board)
    span = 3.2
    for i in range(n_desks):
        t = 0 if n_desks == 1 else i / (n_desks - 1)
        x = -span / 2 + t * span
        z_top = 0.72
        desk = box(f"desk_{i}", (0.62, 0.42, 0.04), (x, 0.15, z_top), wood)
        leg1 = box(f"desk_{i}_leg1", (0.04, 0.04, 0.72), (x - 0.26, 0.0, 0.36), wood_dk)
        leg2 = box(f"desk_{i}_leg2", (0.04, 0.04, 0.72), (x + 0.26, 0.0, 0.36), wood_dk)
        leg3 = box(f"desk_{i}_leg3", (0.04, 0.04, 0.72), (x - 0.26, 0.30, 0.36), wood_dk)
        leg4 = box(f"desk_{i}_leg4", (0.04, 0.04, 0.72), (x + 0.26, 0.30, 0.36), wood_dk)
        seat = box(f"chair_{i}", (0.38, 0.38, 0.04), (x, -0.28, 0.44), wood_dk)
        back = box(f"chair_{i}_back", (0.38, 0.04, 0.38), (x, -0.46, 0.64), wood_dk)
        objs += [desk, leg1, leg2, leg3, leg4, seat, back]
    for o in objs:
        shade_smooth(o)
    return objs


def build_podium():
    wood = mat("podium_wood", (0.40, 0.28, 0.16), roughness=0.65)
    wood_dk = mat("podium_dk", (0.22, 0.14, 0.08), roughness=0.65)
    paper = mat("podium_wall", (0.88, 0.84, 0.76), roughness=0.85)
    floor_m = mat("podium_floor", (0.50, 0.44, 0.34), roughness=0.8)
    board_m = mat("podium_board", (0.13, 0.2, 0.17), roughness=0.55)
    objs = []
    objs.append(box("p_floor", (5.5, 5.0, 0.04), (0, 0, -0.02), floor_m))
    objs.append(box("p_wall", (5.5, 0.08, 2.8), (0, 2.1, 1.4), paper))
    objs.append(box("p_board", (2.6, 0.06, 1.6), (0.7, 2.04, 1.5), board_m))
    # lectern
    objs.append(box("lectern_body", (0.7, 0.4, 0.9), (0, 0.35, 0.45), wood))
    objs.append(box("lectern_top", (0.78, 0.5, 0.05), (0, 0.32, 0.92), wood_dk))
    for o in objs:
        shade_smooth(o)
    return objs


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ensure_mpfb()
    HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
    TargetService = dynamic_import("mpfb.services.targetservice", "TargetService")
    HumanObjectProperties = dynamic_import("mpfb.entities.objectproperties", "HumanObjectProperties")

    dest = out_dir()
    os.makedirs(dest, exist_ok=True)
    print("output dir", dest)

    bpy.context.scene.render.fps = FPS
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 64

    # Students
    clear_scene()
    roots = []
    span = 3.2
    n = len(STUDENTS)
    for i, card in enumerate(STUDENTS):
        t = 0 if n == 1 else i / (n - 1)
        x = -span / 2 + t * span
        print("building student", card["label"])
        roots.append(build_one(card, HumanService, HumanObjectProperties, TargetService, origin=(x, -0.28, 0)))
    export_glb(os.path.join(dest, "students.glb"), roots)

    # Guests
    clear_scene()
    roots = []
    for i, card in enumerate(GUESTS):
        x = -1.0 + i * 1.0
        print("building guest", card["label"])
        roots.append(build_one(card, HumanService, HumanObjectProperties, TargetService, origin=(x, -0.2, 0)))
    export_glb(os.path.join(dest, "guests.glb"), roots)

    # Teacher
    clear_scene()
    print("building teacher")
    root = build_one(TEACHER, HumanService, HumanObjectProperties, TargetService, origin=(0, 0.05, 0))
    export_glb(os.path.join(dest, "teacher.glb"), [root])

    # Sets
    clear_scene()
    export_glb(os.path.join(dest, "classroom.glb"), build_classroom())
    clear_scene()
    export_glb(os.path.join(dest, "podium.glb"), build_podium())
    print("done")


if __name__ == "__main__":
    main()

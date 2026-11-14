"""
Build the OpenPodium / 体态镜 character set in headless Blender.

Source: MakeHuman Plugin For Blender (MPFB). The plugin is AGPL-3.0;
bundled MakeHuman assets and exported character meshes are CC0.
Clothes, hair, eyes and skins come from the official MakeHuman Community
CC0 asset packs, fitted with MHCLO proxies on the intact basemesh.
Animations are original keyframes on the default MakeHuman rig
(not Mixamo). 沉思波 · 体态镜 二改: macros, tinted outfits, classroom clips.

Usage (Blender 4.x + MPFB + CC0 packs in the MPFB user data folder):

  export BLENDER_USER_RESOURCES=/workspace/tools/blender-user
  /workspace/tools/blender -b -P scripts/characters/build_cast.py -- --out assets/characters

Optional: --preview writes review stills next to the glb files.
"""
from __future__ import annotations

import os
import sys
import importlib
import math
from mathutils import Vector, Euler

import bpy

FPS = 24

# The official default rig splits each limb into a pair of bones that
# point opposite ways (twist). Hip flexion and knee bend live on the
# *downward* bones: upperleg02 / lowerleg02. Rotating the 01 bones
# tears the mesh. Verified in review stills 2026-11-14.
SIT_THIGH = -80
SIT_SHIN = 85
SIT_FOOT = 8
SIT_SPINE = 8
# Extra world-Z lift after planting the feet, so the hips rest on a
# 0.44 m chair instead of sinking through the seat.
SIT_LIFT = 0.06


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


def mpfb_data():
    env = os.environ.get("MPFB_USER_DATA")
    if env and os.path.isdir(env):
        return env
    root = os.environ.get("BLENDER_USER_RESOURCES", "")
    cand = os.path.join(root, "extensions/.user/user_default/mpfb/data")
    if os.path.isdir(cand):
        return cand
    raise FileNotFoundError(
        "MakeHuman / MPFB user data not found. Set MPFB_USER_DATA or "
        "BLENDER_USER_RESOURCES to a tree that contains the CC0 packs."
    )


# ---------------------------------------------------------------------------
# Character cards (our 二改)
# ---------------------------------------------------------------------------
# age: baby=0, child=0.1875, young=0.5, old=1
# gender: 0 female, 1 male

STUDENTS = [
    dict(id="s1", name="LinQiu", label="林秋", role="student",
         gender=0.15, age=0.32, height=0.42, weight=0.45, muscle=0.35,
         asian=0.85, african=0.05, caucasian=0.10,
         hair_style="bob", hair=(0.08, 0.06, 0.05),
         shirt=(0.20, 0.42, 0.62), pants=(0.16, 0.20, 0.28),
         raise_hand="l"),
    dict(id="s2", name="ZhouNan", label="周南", role="student",
         gender=0.85, age=0.34, height=0.55, weight=0.48, muscle=0.50,
         asian=0.80, african=0.05, caucasian=0.15,
         hair_style="short02", hair=(0.07, 0.05, 0.04),
         shirt=(0.22, 0.48, 0.40), pants=(0.16, 0.18, 0.22),
         suit="clothes/male_casualsuit04/male_casualsuit04.mhclo",
         raise_hand="r"),
    dict(id="s3", name="ChenHe", label="陈禾", role="student",
         gender=0.40, age=0.30, height=0.46, weight=0.42, muscle=0.38,
         asian=0.70, african=0.12, caucasian=0.18,
         hair_style="long", hair=(0.12, 0.07, 0.04),
         shirt=(0.46, 0.28, 0.50), pants=(0.16, 0.14, 0.20),
         raise_hand="r"),
    dict(id="s4", name="MaYan", label="马言", role="student",
         gender=0.90, age=0.36, height=0.62, weight=0.58, muscle=0.55,
         asian=0.75, african=0.08, caucasian=0.17,
         hair_style="short01", hair=(0.10, 0.07, 0.05),
         shirt=(0.24, 0.36, 0.62), pants=(0.14, 0.16, 0.22),
         suit="clothes/male_casualsuit05/male_casualsuit05.mhclo",
         raise_hand="l"),
    dict(id="s5", name="XuQing", label="许青", role="student",
         gender=0.12, age=0.31, height=0.48, weight=0.40, muscle=0.32,
         asian=0.88, african=0.04, caucasian=0.08,
         hair_style="bob", hair=(0.09, 0.06, 0.05),
         shirt=(0.62, 0.28, 0.28), pants=(0.16, 0.14, 0.18),
         raise_hand="r"),
]

GUESTS = [
    dict(id="g1", name="ChenJudge", label="陈评委", role="guest",
         gender=0.90, age=0.62, height=0.62, weight=0.55, muscle=0.50,
         asian=0.80, african=0.05, caucasian=0.15,
         hair_style="short01", hair=(0.12, 0.10, 0.09),
         shirt=(0.18, 0.22, 0.28),
         raise_hand="r"),
    dict(id="g2", name="WangTeacher", label="王老师", role="guest",
         gender=0.20, age=0.58, height=0.52, weight=0.50, muscle=0.40,
         asian=0.82, african=0.05, caucasian=0.13,
         hair_style="bob", hair=(0.16, 0.10, 0.07),
         shirt=(0.32, 0.24, 0.22),
         raise_hand="l"),
    dict(id="g3", name="ZhaoGuest", label="赵嘉宾", role="guest",
         gender=0.70, age=0.48, height=0.58, weight=0.48, muscle=0.48,
         asian=0.70, african=0.10, caucasian=0.20,
         hair_style="short03", hair=(0.07, 0.05, 0.04),
         shirt=(0.22, 0.30, 0.36),
         suit="clothes/male_casualsuit06/male_casualsuit06.mhclo",
         raise_hand="r"),
]

TEACHER = dict(
    id="teacher", name="Presenter", label="试讲老师", role="teacher",
    gender=0.22, age=0.46, height=0.56, weight=0.50, muscle=0.42,
    asian=0.78, african=0.06, caucasian=0.16,
    hair_style="bob", hair=(0.09, 0.07, 0.05),
    raise_hand="r",
)

HAIR_ASSETS = {
    "bob": "hair/bob01/bob01.mhclo",
    "bob02": "hair/bob02/bob02.mhclo",
    "short": "hair/short02/short02.mhclo",
    "short01": "hair/short01/short01.mhclo",
    "short02": "hair/short02/short02.mhclo",
    "short03": "hair/short03/short03.mhclo",
    "short04": "hair/short04/short04.mhclo",
    "long": "hair/long01/long01.mhclo",
    "ponytail": "hair/ponytail01/ponytail01.mhclo",
    "braid": "hair/braid01/braid01.mhclo",
}


def out_dir():
    args = sys.argv
    rest = args[args.index("--") + 1:] if "--" in args else args[1:]
    if "--out" in rest:
        i = rest.index("--out")
        if i + 1 < len(rest):
            return os.path.abspath(rest[i + 1])
    for tok in rest:
        if not tok.startswith("-"):
            return os.path.abspath(tok)
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "../../assets/characters"))


def want_preview():
    args = sys.argv
    rest = args[args.index("--") + 1:] if "--" in args else args[1:]
    return "--preview" in rest


# ---------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    if bpy.data.objects:
        bpy.ops.object.delete()
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.collections):
        for x in list(block):
            try:
                if getattr(x, "users", 1) == 0:
                    block.remove(x)
            except Exception:
                pass


def mat(name, color, roughness=0.55, specular=0.2):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    principled = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    principled.inputs["Base Color"].default_value = (*color, 1)
    if "Roughness" in principled.inputs:
        principled.inputs["Roughness"].default_value = roughness
    return m


def select_only(obj):
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def shade_smooth(obj):
    if obj.type != "MESH":
        return
    select_only(obj)
    try:
        bpy.ops.object.shade_smooth()
    except Exception:
        pass


def ev_bounds(*objs):
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys, zs = [], [], []
    for obj in objs:
        if not obj or obj.type != "MESH":
            continue
        ev = obj.evaluated_get(dg)
        try:
            mesh = ev.to_mesh()
        except Exception:
            continue
        mw = ev.matrix_world
        for v in mesh.vertices:
            w = mw @ v.co
            xs.append(w.x)
            ys.append(w.y)
            zs.append(w.z)
        ev.to_mesh_clear()
    if not zs:
        return None
    return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))


def tint_material(mat, rgb, strength=0.8, mode="MIX"):
    if not mat or not mat.use_nodes:
        return
    nt = mat.node_tree
    principled = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not principled:
        return
    base = principled.inputs.get("Base Color")
    if not base:
        return
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = mode
    mix.inputs["Factor"].default_value = float(strength)
    mix.location = (principled.location.x - 200, principled.location.y)
    # Socket names in Blender 4: Factor, A, B for RGBA via components
    col_in = None
    for key in ("B", "A"):
        sock = mix.inputs.get(key)
        if sock is not None:
            col_in = key
            break
    # Prefer: A = original, B = tint, Factor = strength, blend MIX/MULTIPLY
    if base.is_linked:
        link = base.links[0]
        nt.links.new(link.from_socket, mix.inputs["A"])
        nt.links.remove(link)
    else:
        mix.inputs["A"].default_value = tuple(base.default_value)
    mix.inputs["B"].default_value = (*rgb, 1.0)
    nt.links.new(mix.outputs["Result"], base)


def tint_image_pixels(img, rgb, strength=0.85):
    """Blend the image toward rgb so a logo tee can change colour reliably."""
    try:
        px = list(img.pixels)
    except Exception as e:
        print("  pixel read fail", img.name, e)
        return
    r, g, b = rgb
    n = len(px) // 4
    for i in range(n):
        o = i * 4
        px[o] = px[o] * (1 - strength) + r * strength
        px[o + 1] = px[o + 1] * (1 - strength) + g * strength
        px[o + 2] = px[o + 2] * (1 - strength) + b * strength
    img.pixels[:] = px
    img.update()


def tint_objects(objs, rgb, strength=0.8, mode="MIX"):
    seen_img = set()
    seen_mat = set()
    for obj in objs:
        if not obj or obj.type != "MESH":
            continue
        for mat in obj.data.materials:
            if not mat:
                continue
            if mat.use_nodes:
                for n in mat.node_tree.nodes:
                    if n.type == "TEX_IMAGE" and n.image and id(n.image) not in seen_img:
                        seen_img.add(id(n.image))
                        tint_image_pixels(n.image, rgb, strength)
            if mat.name not in seen_mat:
                seen_mat.add(mat.name)
                tint_material(mat, rgb, min(0.45, strength), mode)


def bake_shapekeys(obj):
    """Collapse macro / asset shapekeys into the basis so glTF can skip morphs."""
    if not obj or obj.type != "MESH" or not obj.data.shape_keys:
        return
    arm_mods = [m for m in obj.modifiers if m.type == "ARMATURE"]
    vis = [m.show_viewport for m in arm_mods]
    for m in arm_mods:
        m.show_viewport = False
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    try:
        mesh = ev.to_mesh()
        coords = [v.co.copy() for v in mesh.vertices]
        ev.to_mesh_clear()
    except Exception as e:
        print("  bake shapekeys failed", obj.name, e)
        coords = None
    for m, v in zip(arm_mods, vis):
        m.show_viewport = v
    if not coords or len(coords) != len(obj.data.vertices):
        return
    for i, co in enumerate(coords):
        obj.data.vertices[i].co = co
    obj.shape_key_clear()


# ---------------------------------------------------------------------------
# Human construction (official MHCLO path)
# ---------------------------------------------------------------------------

def skin_rel(card):
    sex = "female" if float(card["gender"]) < 0.5 else "male"
    age = float(card["age"])
    band = "old" if age >= 0.75 else ("middleage" if age >= 0.5 else "young")
    # Prefer Asian; fall back along the card's weights if missing.
    for group in ("asian", "caucasian", "african"):
        rel = f"skins/{band}_{group}_{sex}/{band}_{group}_{sex}.mhmat"
        yield rel


def add_mhclo(HumanService, data, basemesh, rel, typ):
    path = os.path.join(data, rel)
    if not os.path.exists(path):
        print("  MISSING", rel)
        return None
    return HumanService.add_mhclo_asset(
        path, basemesh, asset_type=typ, subdiv_levels=0,
        material_type="MAKESKIN", set_up_rigging=True,
        interpolate_weights=True, import_subrig=False, import_weights=True,
    )


def clothes_for(card, data):
    """Return (mhclo relative paths, role). Students get a tucked shirt + wool
    pants (complete coverage, no midriff gap, no logo tee). Teachers and
    guests get the official elegant suit for their sex."""
    # Official MHCLO outfits. Seated clothes must survive hip/knee bends:
    # the tucked t-shirt and the male elegant jacket tear or balloon when
    # sitting. female_casualsuit01 / male_casualsuit0N (one-piece tee + jeans)
    # and the female elegant blouse+skirt were verified in review stills.
    # The standing teacher keeps the female elegant suit.
    if card["role"] == "teacher":
        if float(card["gender"]) < 0.5:
            paths = [
                "clothes/female_elegantsuit01/female_elegantsuit01.mhclo",
                "clothes/shoes01/shoes01.mhclo",
            ]
        else:
            paths = [
                "clothes/male_elegantsuit01/male_elegantsuit01.mhclo",
                "clothes/shoes03/shoes03.mhclo",
            ]
    elif float(card["gender"]) < 0.5:
        paths = [
            "clothes/female_casualsuit01/female_casualsuit01.mhclo",
            "clothes/joepal_crude_low_socks/joepal_crude_low_socks.mhclo",
            "clothes/shoes01/shoes01.mhclo",
        ]
    else:
        suit = card.get("suit") or "clothes/male_casualsuit04/male_casualsuit04.mhclo"
        paths = [suit, "clothes/shoes03/shoes03.mhclo"]
    return paths


def existing_meshes():
    return set(bpy.data.objects)


def new_meshes(before):
    return [o for o in bpy.data.objects if o.type == "MESH" and o not in before]


def apply_macros(basemesh, card, HumanObjectProperties, TargetService):
    for key in ("gender", "age", "height", "weight", "muscle", "african", "asian", "caucasian"):
        HumanObjectProperties.set_value(key, float(card[key]), entity_reference=basemesh)
    TargetService.reapply_macro_details(basemesh)


def make_human(card, HumanService, HumanObjectProperties, TargetService, data):
    basemesh = HumanService.create_human(
        mask_helpers=True, detailed_helpers=False,
        extra_vertex_groups=True, scale=0.1,
    )
    apply_macros(basemesh, card, HumanObjectProperties, TargetService)
    skinned = False
    for rel in skin_rel(card):
        path = os.path.join(data, rel)
        if os.path.exists(path):
            HumanService.set_character_skin(
                path, basemesh, skin_type="ENHANCED", material_instances=False,
            )
            skinned = True
            break
    if not skinned:
        print("  no official skin for", card["id"])
    rig = HumanService.add_builtin_rig(basemesh, "default")
    rig.name = f"{card['id']}_rig"
    basemesh.name = f"{card['id']}_body"

    add_mhclo(HumanService, data, basemesh, "eyes/high-poly/high-poly.mhclo", "Eyes")
    add_mhclo(HumanService, data, basemesh, "eyebrows/eyebrow003/eyebrow003.mhclo", "Eyebrows")
    add_mhclo(HumanService, data, basemesh, "eyelashes/eyelashes01/eyelashes01.mhclo", "Eyelashes")
    add_mhclo(HumanService, data, basemesh, "teeth/teeth_base/teeth_base.mhclo", "Teeth")
    add_mhclo(HumanService, data, basemesh, "tongue/tongue01/tongue01.mhclo", "Tongue")

    hair_rel = HAIR_ASSETS.get(card.get("hair_style") or "short", HAIR_ASSETS["short"])
    before = existing_meshes()
    add_mhclo(HumanService, data, basemesh, hair_rel, "Hair")
    hair_objs = new_meshes(before)
    if card.get("hair"):
        tint_objects(hair_objs, card["hair"], strength=0.95, mode="MIX")
        for o in hair_objs:
            for mat in o.data.materials:
                if not mat or not mat.use_nodes:
                    continue
                pr = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if pr and not pr.inputs["Base Color"].is_linked:
                    pr.inputs["Base Color"].default_value = (*card["hair"], 1)

    before = existing_meshes()
    for rel in clothes_for(card, data):
        add_mhclo(HumanService, data, basemesh, rel, "Clothes")
    cloth_objs = new_meshes(before)
    if card.get("shirt") and card["role"] != "teacher":
        # One-piece casual suits include the logo tee; a strong mix hides the
        # MakeHuman mark and gives each student a different uniform colour.
        clothes_only = [o for o in cloth_objs if "shoe" not in o.name.lower() and "sock" not in o.name.lower()]
        tint_objects(clothes_only, card["shirt"], strength=0.88, mode="MIX")

    # Bake macros so we can export without morph targets.
    for obj in list(bpy.data.objects):
        if obj.type == "MESH":
            bake_shapekeys(obj)
            shade_smooth(obj)

    rig.hide_render = True
    return basemesh, rig


# ---------------------------------------------------------------------------
# Posing (default rig)
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


def set_root_world_delta(arm, dx=0, dy=0, dz=0):
    """Translate the root pose bone by an armature-space (≈ world) delta."""
    bone = arm.data.bones.get("root")
    pose = pb(arm, "root")
    if not bone or not pose:
        return
    mat3 = bone.matrix.to_3x3()
    pose.location = mat3.inverted() @ Vector((dx, dy, dz))


# Cache the sit drop so every clip uses the same planted feet.
_SIT_DROP = {}


def measure_sit_drop(arm, meshes):
    """Pose a raw sit (no root drop), then find the world-Z offset that
    puts the feet on the floor and the hips slightly above a 0.44 m seat."""
    reset_pose(arm)
    _sit_legs_and_spine(arm)
    relax_arms_sit(arm)
    bpy.context.view_layer.update()
    b = ev_bounds(*meshes)
    if not b:
        return -0.34
    # Current min z is the lifted feet; drop so they return to ~0.02.
    drop = 0.02 - b[4] + SIT_LIFT
    return drop


def _sit_legs_and_spine(arm, thigh=SIT_THIGH, shin=SIT_SHIN, k=1.0):
    for side in ("L", "R"):
        set_euler(arm, f"upperleg02.{side}", rx=thigh * k)
        set_euler(arm, f"lowerleg02.{side}", rx=shin * k)
        set_euler(arm, f"foot.{side}", rx=SIT_FOOT * k)
    set_euler(arm, "spine05", rx=SIT_SPINE * k)
    set_euler(arm, "spine04", rx=2 * k)


def relax_arms_sit(arm, k=1.0):
    """Only tiny arm offsets. Larger shoulder rotations tear MHCLO sleeves."""
    set_euler(arm, "shoulder01.L", rz=8 * k)
    set_euler(arm, "shoulder01.R", rz=-8 * k)
    set_euler(arm, "lowerarm02.L", rx=-6 * k)
    set_euler(arm, "lowerarm02.R", rx=-6 * k)


def relax_arms_stand(arm, k=1.0):
    set_euler(arm, "shoulder01.L", rz=10 * k)
    set_euler(arm, "shoulder01.R", rz=-10 * k)
    set_euler(arm, "lowerarm02.L", rx=-6 * k)
    set_euler(arm, "lowerarm02.R", rx=-6 * k)


def sit_pose(arm, k=1.0):
    drop = _SIT_DROP.get(arm.name, -0.30)
    _sit_legs_and_spine(arm, k=k)
    relax_arms_sit(arm, k=k)
    set_root_world_delta(arm, dz=drop * k)


def stand_pose(arm):
    reset_pose(arm)
    relax_arms_stand(arm)
    set_root_world_delta(arm, 0, 0, 0)


def add_action(arm, name, frames, setup_fn, loop=True):
    select_only(arm)
    bpy.ops.object.mode_set(mode="POSE")
    reset_pose(arm)
    prefix = arm.name.replace("_rig", "")
    act_name = f"{prefix}_{name}"
    act = bpy.data.actions.new(act_name)
    act["clip"] = name
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    for i in range(frames + 1):
        t = i / frames
        setup_fn(arm, t, i)
        key_all(arm, i + 1)
    # loop: copy frame 1 to last
    setup_fn(arm, 0, 1)
    key_all(arm, frames + 1)
    act.use_fake_user = True
    bpy.ops.object.mode_set(mode="OBJECT")
    return act, name


def anim_idle_sit(arm, side="r"):
    def fn(a, t, f):
        sit_pose(a)
        breath = math.sin(t * math.tau) * 1.2
        set_euler(a, "spine04", rx=2 + breath)
        set_euler(a, "spine03", rx=breath * 0.6)
        set_euler(a, "head", rx=breath * 0.4, ry=math.sin(t * math.tau * 0.5) * 2)
    return add_action(arm, "idle_sit", 48, fn)


def anim_raise_hand(arm, side="r"):
    S = "R" if side == "r" else "L"

    def fn(a, t, f):
        sit_pose(a)
        k = (1 - math.cos(min(1, t * 1.2) * math.pi)) * 0.5 if t < 0.85 else 1
        if t > 0.85:
            k = 1 - (t - 0.85) / 0.15 * 0.15
        # Lift the shoulder / arm on one side. rz sign follows relax_arms_sit.
        if S == "R":
            set_euler(a, "clavicle.R", rz=-8 * k)
            set_euler(a, "shoulder01.R", rz=-28 * k, rx=-6 * k)
            set_euler(a, "upperarm02.R", rz=-8 * k)
            set_euler(a, "lowerarm02.R", rx=-12 * k)
        else:
            set_euler(a, "clavicle.L", rz=8 * k)
            set_euler(a, "shoulder01.L", rz=28 * k, rx=-6 * k)
            set_euler(a, "upperarm02.L", rz=8 * k)
            set_euler(a, "lowerarm02.L", rx=-12 * k)
        set_euler(a, "head", ry=(6 if S == "R" else -6) * k * 0.3)
    return add_action(arm, "raise_hand", 36, fn)


def anim_nod(arm):
    def fn(a, t, f):
        sit_pose(a)
        n = math.sin(t * math.tau * 2) * 10
        set_euler(a, "head", rx=n)
        set_euler(a, "neck01", rx=n * 0.3)
    return add_action(arm, "nod", 32, fn)


def anim_confused(arm):
    def fn(a, t, f):
        sit_pose(a)
        k = (1 - math.cos(t * math.tau)) * 0.5
        set_euler(a, "head", rz=14 * k, rx=6 * k, ry=-4 * k)
        set_euler(a, "neck01", rz=6 * k)
    return add_action(arm, "confused", 40, fn)


def anim_distracted(arm):
    def fn(a, t, f):
        sit_pose(a)
        k = min(1, t * 2) if t < 0.8 else 1
        set_euler(a, "head", rx=22 * k, ry=18 * k)
        set_euler(a, "neck01", rx=8 * k, ry=8 * k)
        set_euler(a, "spine04", ry=6 * k)
    return add_action(arm, "distracted", 48, fn)


def anim_group_read(arm):
    def fn(a, t, f):
        sit_pose(a)
        w = math.sin(t * math.tau * 2)
        set_euler(a, "spine05", rx=12)
        set_euler(a, "spine04", rx=8)
        set_euler(a, "head", rx=16 + 2 * w)
        set_euler(a, "neck01", rx=6)
    return add_action(arm, "group_read", 40, fn)


def anim_stand_to_read(arm, side="r"):
    def fn(a, t, f):
        k = min(1, t / 0.45)
        ease = 0.5 - 0.5 * math.cos(k * math.pi)
        sit_pose(a, k=1 - ease)
        if ease > 0:
            relax_arms_stand(a, k=ease)
            set_euler(a, "spine05", rx=8 * (1 - ease) + 4 * ease)
            set_euler(a, "head", rx=8 * ease)
        if t > 0.45:
            w = math.sin(t * math.tau * 2)
            set_euler(a, "head", rx=8 + 2 * w)
    return add_action(arm, "stand_to_read", 48, fn)


def anim_speak(arm, side="r"):
    S = "R" if side == "r" else "L"

    def fn(a, t, f):
        sit_pose(a)
        w = math.sin(t * math.tau)
        set_euler(a, "head", rx=3 * w, ry=4 * math.sin(t * math.tau * 0.5))
        if S == "R":
            set_euler(a, "shoulder01.R", rz=-16 * (0.5 + 0.15 * w))
        else:
            set_euler(a, "shoulder01.L", rz=16 * (0.5 + 0.15 * w))
    return add_action(arm, "speak", 40, fn)


def anim_ask(arm, side="r"):
    S = "R" if side == "r" else "L"

    def fn(a, t, f):
        sit_pose(a)
        k = (1 - math.cos(min(1, t * 1.4) * math.pi)) * 0.5
        set_euler(a, "head", rx=-4, ry=(-6 if S == "R" else 6))
        if S == "R":
            set_euler(a, "shoulder01.R", rz=-20 * k)
        else:
            set_euler(a, "shoulder01.L", rz=20 * k)
    return add_action(arm, "ask", 40, fn)


def anim_idle_stand(arm):
    def fn(a, t, f):
        stand_pose(a)
        b = math.sin(t * math.tau)
        set_euler(a, "spine04", rx=1.2 * b)
        set_euler(a, "head", ry=3 * math.sin(t * math.tau * 0.5), rx=1 * b)
    return add_action(arm, "idle_stand", 48, fn)


def anim_talk(arm):
    def fn(a, t, f):
        stand_pose(a)
        w = math.sin(t * math.tau)
        set_euler(a, "head", rx=3 * w, ry=5 * math.sin(t * math.tau * 0.5))
        set_euler(a, "spine03", ry=3 * w)
        set_euler(a, "shoulder01.R", rz=-16 - 6 * w)
        set_euler(a, "lowerarm02.R", rx=-20 - 10 * w)
        set_euler(a, "wrist.R", rz=-8 * math.sin(t * math.tau * 2))
    return add_action(arm, "talk", 48, fn)


def anim_talk_gesture(arm):
    def fn(a, t, f):
        stand_pose(a)
        k = 0.5 - 0.5 * math.cos(t * math.tau)
        set_euler(a, "shoulder01.R", rz=-22 * k - 6)
        set_euler(a, "lowerarm02.R", rx=-16)
        set_euler(a, "head", ry=-8 * k)
        set_euler(a, "spine04", ry=-4 * k)
    return add_action(arm, "talk_gesture", 36, fn)


def anim_walk(arm):
    def fn(a, t, f):
        stand_pose(a)
        ph = t * math.tau
        th = math.sin(ph) * 28
        tk = -abs(math.sin(ph)) * 20
        set_euler(a, "upperleg02.L", rx=th)
        set_euler(a, "upperleg02.R", rx=-th)
        set_euler(a, "lowerleg02.L", rx=tk if th > 0 else -6)
        set_euler(a, "lowerleg02.R", rx=tk if th < 0 else -6)
        set_euler(a, "shoulder01.L", rz=18, rx=-th * 0.3)
        set_euler(a, "shoulder01.R", rz=-18, rx=th * 0.3)
        set_euler(a, "spine04", ry=math.sin(ph) * 2)
        set_root_world_delta(a, dz=abs(math.sin(ph)) * 0.012)
    return add_action(arm, "walk", 32, fn)


def anim_turn_board(arm):
    def fn(a, t, f):
        stand_pose(a)
        k = (1 - math.cos(min(1, t) * math.pi)) * 0.5
        # Turn in place toward the board (stage right of the default layout).
        # Root rotation uses the bone's local axes; we also nudge Y.
        set_euler(a, "root", ry=-55 * k)
        set_euler(a, "spine05", ry=-10 * k)
        set_euler(a, "head", ry=-8 * k, rx=6 * k)
        set_euler(a, "shoulder01.R", rz=-28 * k, rx=12 * k)
        set_euler(a, "lowerarm02.R", rx=-30 * k)
    return add_action(arm, "turn_board", 48, fn)


def stash_nla(arm, actions):
    if arm.animation_data is None:
        arm.animation_data_create()
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
    for act, clip in actions:
        track = arm.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, 1, act)
        strip.action = act
    arm.animation_data.action = None


def add_character_anims(arm, card, meshes):
    _SIT_DROP[arm.name] = measure_sit_drop(arm, meshes)
    print("  sit drop", arm.name, round(_SIT_DROP[arm.name], 3))
    acts = []
    if card["role"] == "teacher":
        acts += [anim_idle_stand(arm), anim_talk(arm), anim_talk_gesture(arm), anim_walk(arm), anim_turn_board(arm)]
    elif card["role"] == "guest":
        side = card.get("raise_hand", "r")
        acts += [anim_idle_sit(arm), anim_ask(arm, side), anim_nod(arm), anim_speak(arm, side), anim_confused(arm)]
    else:
        side = card.get("raise_hand", "r")
        acts += [
            anim_idle_sit(arm, side), anim_raise_hand(arm, side), anim_nod(arm),
            anim_confused(arm), anim_distracted(arm), anim_speak(arm, side),
            anim_group_read(arm), anim_stand_to_read(arm, side),
        ]
    stash_nla(arm, acts)


# ---------------------------------------------------------------------------
# Build / export
# ---------------------------------------------------------------------------

def character_objects(rig):
    objs = [rig]
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        # parented to this rig, or armature-modified by it
        if o.parent == rig:
            objs.append(o)
            continue
        for m in o.modifiers:
            if m.type == "ARMATURE" and m.object == rig:
                objs.append(o)
                break
    return objs


def place_character(rig, origin, face_board=True):
    """Classroom board is at +Y; the default MH human faces -Y, so rotate 180°."""
    rig.location = Vector(origin)
    if face_board:
        rig.rotation_euler = Euler((0, 0, math.pi), "XYZ")


def build_one(card, HumanService, HumanObjectProperties, TargetService, data, origin=(0, 0, 0), face_board=True):
    print("building", card["label"], card["id"])
    before = set(bpy.data.objects)
    basemesh, rig = make_human(card, HumanService, HumanObjectProperties, TargetService, data)
    # rename leftover helper objects so names stay unique across a cast
    for o in bpy.data.objects:
        if o not in before and o not in (basemesh, rig) and not o.name.startswith(card["id"]):
            o.name = f"{card['id']}_{o.name}"
    meshes = [o for o in character_objects(rig) if o.type == "MESH"]
    add_character_anims(rig, card, meshes)
    place_character(rig, origin, face_board=face_board)
    bpy.context.view_layer.update()
    return rig


def shrink_images(max_dim=512):
    """Resize packed textures and prefer JPEG so a full cast stays under ~15 MB."""
    import os
    tmp = "/tmp/char-src/tex"
    os.makedirs(tmp, exist_ok=True)
    for img in list(bpy.data.images):
        w, h = img.size
        if w <= 0 or h <= 0:
            continue
        # Skip tiny generated images
        if max(w, h) > max_dim:
            nw = max(1, int(round(w * max_dim / max(w, h))))
            nh = max(1, int(round(h * max_dim / max(w, h))))
            try:
                img.scale(nw, nh)
            except Exception as e:
                print("  scale fail", img.name, e)
                continue
        has_alpha = bool(img.depth and img.depth >= 32)
        # Hair / lash cutouts need alpha; everything else can be JPEG.
        name = (img.name or "").lower()
        need_alpha = has_alpha and any(k in name for k in ("hair", "lash", "brow", "eye", "alpha"))
        try:
            img.file_format = "PNG" if need_alpha else "JPEG"
            dest = os.path.join(tmp, img.name.replace("/", "_")[:80] + (".png" if need_alpha else ".jpg"))
            img.save_render(dest)
            img.filepath = dest
            img.source = "FILE"
            img.reload()
            img.pack()
        except Exception as e:
            print("  recompress fail", img.name, e)
    print("  images after shrink:", len(bpy.data.images))


def export_glb(path, objects):
    shrink_images(384)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    keep = set()
    for o in objects:
        keep.add(o)
        if o.type == "ARMATURE":
            keep.update(character_objects(o))
        for ch in o.children_recursive:
            keep.add(ch)
    for o in keep:
        try:
            o.hide_set(False)
            o.hide_viewport = False
            o.hide_render = o.type == "ARMATURE"
            o.select_set(True)
        except Exception:
            pass
    # Make one armature active
    arms = [o for o in keep if o.type == "ARMATURE"]
    if arms:
        bpy.context.view_layer.objects.active = arms[0]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
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
        export_apply=False,
        export_image_format="JPEG",
        export_jpeg_quality=70,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_extras=True,
        export_yup=True,
    )
    print("exported", path, "bytes", os.path.getsize(path) if os.path.exists(path) else 0)


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
    objs.append(box("left_wall", (0.08, 6.0, 2.6), (-3.46, 0, 1.3), paper))
    objs.append(box("right_wall", (0.08, 6.0, 2.6), (3.46, 0, 1.3), paper))
    span = 3.2
    for i in range(n_desks):
        t = 0 if n_desks == 1 else i / (n_desks - 1)
        x = -span / 2 + t * span
        z_top = 0.72
        desk = box(f"desk_{i}", (0.62, 0.42, 0.04), (x, 0.15, z_top), wood)
        legs = [
            box(f"desk_{i}_leg{k}", (0.04, 0.04, 0.72), (x + dx, 0.0 + dy, 0.36), wood_dk)
            for k, (dx, dy) in enumerate(((-0.26, 0.0), (0.26, 0.0), (-0.26, 0.30), (0.26, 0.30)), 1)
        ]
        seat = box(f"chair_{i}", (0.38, 0.38, 0.04), (x, -0.28, 0.44), wood_dk)
        back = box(f"chair_{i}_back", (0.38, 0.04, 0.38), (x, -0.46, 0.64), wood_dk)
        objs += [desk, *legs, seat, back]
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
    objs.append(box("lectern_body", (0.7, 0.4, 0.9), (0, 0.35, 0.45), wood))
    objs.append(box("lectern_top", (0.78, 0.5, 0.05), (0, 0.32, 0.92), wood_dk)
    )
    return objs


# ---------------------------------------------------------------------------
# Preview stills
# ---------------------------------------------------------------------------

def setup_preview_world(cam_loc, look, size=(900, 1100)):
    world = bpy.data.worlds[0]
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.86, 0.82, 0.74, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.image_settings.file_format = "PNG"
    for o in list(bpy.data.objects):
        if o.type in {"LIGHT", "CAMERA"}:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.light_add(type="SUN", location=(1.2, -2, 4))
    bpy.context.active_object.data.energy = 2.2
    bpy.ops.object.camera_add(location=cam_loc)
    cam = bpy.context.active_object
    cam.rotation_euler = (Vector(look) - Vector(cam_loc)).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    return scene


def render_preview(path, cam_loc, look, size=(900, 1100)):
    scene = setup_preview_world(cam_loc, look, size)
    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            o.hide_render = True
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("preview", path)


def preview_character(rig, card, dest, with_chair=False):
    # Play first frame of idle
    clip = "idle_stand" if card["role"] == "teacher" else "idle_sit"
    if rig.animation_data:
        for tr in rig.animation_data.nla_tracks:
            tr.mute = tr.name != clip
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    if with_chair and card["role"] != "teacher":
        wood = mat("prev_chair", (0.45, 0.28, 0.16))
        # Character was rotated 180° and placed at origin for solo preview
        box("prev_seat", (0.38, 0.38, 0.04), (0, 0, 0.44), wood)
        box("prev_back", (0.38, 0.04, 0.38), (0, 0.18, 0.64), wood)
    loc = rig.location
    # Solo previews are built face_board=False (character faces -Y).
    cam = (loc.x + 1.8, loc.y - 3.2, 1.25)
    look = (loc.x, loc.y, 0.75)
    render_preview(os.path.join(dest, f"{card['id']}_{clip}.png"), cam, look)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ensure_mpfb()
    HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
    TargetService = dynamic_import("mpfb.services.targetservice", "TargetService")
    HumanObjectProperties = dynamic_import("mpfb.entities.objectproperties", "HumanObjectProperties")
    data = mpfb_data()
    dest = out_dir()
    os.makedirs(dest, exist_ok=True)
    preview = want_preview()
    preview_dir = os.path.join(dest, "preview")
    if preview:
        os.makedirs(preview_dir, exist_ok=True)
    print("output dir", dest, "data", data, "preview", preview)

    bpy.context.scene.render.fps = FPS
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 64

    # Students at the classroom chairs, facing the board (+Y).
    clear_scene()
    roots = []
    span = 3.2
    n = len(STUDENTS)
    for i, card in enumerate(STUDENTS):
        t = 0 if n == 1 else i / (n - 1)
        x = -span / 2 + t * span
        roots.append(build_one(
            card, HumanService, HumanObjectProperties, TargetService, data,
            origin=(x, -0.28, 0), face_board=True,
        ))
    export_glb(os.path.join(dest, "students.glb"), roots)
    if preview:
        # individual stills: temporarily solo each, with a chair
        for rig, card in zip(roots, STUDENTS):
            # render from the classroom camera
            if rig.animation_data:
                for tr in rig.animation_data.nla_tracks:
                    tr.mute = tr.name != "idle_sit"
            bpy.context.scene.frame_set(1)
        # whole row
        render_preview(
            os.path.join(preview_dir, "students_row.png"),
            (0, 3.6, 1.6), (0, 0, 0.8), size=(1400, 900),
        )
        # rebuild one-by-one for clean portraits (cheaper than hiding)
        for card in STUDENTS:
            clear_scene()
            r = build_one(
                card, HumanService, HumanObjectProperties, TargetService, data,
                origin=(0, 0, 0), face_board=False,
            )
            preview_character(r, card, preview_dir, with_chair=True)

    clear_scene()
    roots = []
    for i, card in enumerate(GUESTS):
        x = -1.0 + i * 1.0
        roots.append(build_one(
            card, HumanService, HumanObjectProperties, TargetService, data,
            origin=(x, -0.2, 0), face_board=True,
        ))
    export_glb(os.path.join(dest, "guests.glb"), roots)
    if preview:
        for card in GUESTS:
            clear_scene()
            r = build_one(
                card, HumanService, HumanObjectProperties, TargetService, data,
                origin=(0, 0, 0), face_board=False,
            )
            preview_character(r, card, preview_dir, with_chair=True)

    clear_scene()
    root = build_one(
        TEACHER, HumanService, HumanObjectProperties, TargetService, data,
        origin=(0, 0.05, 0), face_board=True,
    )
    export_glb(os.path.join(dest, "teacher.glb"), [root])
    if preview:
        clear_scene()
        r = build_one(
            TEACHER, HumanService, HumanObjectProperties, TargetService, data,
            origin=(0, 0, 0), face_board=False,
        )
        preview_character(r, TEACHER, preview_dir, with_chair=False)

    clear_scene()
    export_glb(os.path.join(dest, "classroom.glb"), build_classroom())
    clear_scene()
    export_glb(os.path.join(dest, "podium.glb"), build_podium())
    print("done")


if __name__ == "__main__":
    main()

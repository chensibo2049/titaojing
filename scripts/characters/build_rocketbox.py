#!/usr/bin/env python3
"""
Build the v1.6 Rocketbox classroom / roadshow / teacher GLBs.

Source: Microsoft Rocketbox Avatar Library (MIT, Copyright (c) 2020 Microsoft)
  https://github.com/microsoft/Microsoft-Rocketbox

Official sit / talk / look-around / shrug / presentation clips are retargeted
onto each character with Copy Location + Damped Track Y + Locked Track X
(the animation FBX bind pose does not match the avatar bind pose).
Missing clips (raise hand, nod, chorus read, turn to board, a short walk)
are keyframed on top of the retargeted sit or stand pose.

Usage (headless):
  /workspace/tools/blender -b -P scripts/characters/build_rocketbox.py -- [--one s5] [--out DIR]
"""
from __future__ import annotations

import math
import os
import sys
import json
from mathutils import Vector, Matrix, Euler

import bpy

REPO = os.environ.get("ROCKETBOX_REPO", "/tmp/rocketbox/repo")
FPS = 30

CAST = [
    dict(id="s1", label="林秋", role="student", folder="Adults", name="Female_Adult_05", sex="f", raise_hand="r"),
    dict(id="s2", label="许青", role="student", folder="Adults", name="Female_Adult_08", sex="f", raise_hand="l"),
    dict(id="s3", label="周南", role="student", folder="Adults", name="Female_Adult_11", sex="f", raise_hand="r"),
    dict(id="s4", label="陈禾", role="student", folder="Adults", name="Male_Adult_09", sex="m", raise_hand="l"),
    dict(id="s5", label="马言", role="student", folder="Adults", name="Male_Adult_10", sex="m", raise_hand="r"),
    dict(id="g1", label="嘉宾一", role="guest", folder="Professions", name="Business_Male_01", sex="m", raise_hand="r"),
    dict(id="g2", label="嘉宾二", role="guest", folder="Professions", name="Business_Female_02", sex="f", raise_hand="l"),
    dict(id="g3", label="嘉宾三", role="guest", folder="Professions", name="Business_Male_07", sex="m", raise_hand="r"),
    dict(id="teacher", label="试讲老师", role="teacher", folder="Professions", name="Business_Female_03", sex="f"),
]


def anim_path(name):
    d = f"{REPO}/Assets/Animations/all_animations_max_motextr_static"
    return os.path.join(d, name)


def char_paths(card):
    base = f"{REPO}/Assets/Avatars/{card['folder']}/{card['name']}"
    return os.path.join(base, "Export", f"{card['name']}.fbx"), os.path.join(base, "Textures")


def clip_file(card, kind):
    s = "f" if card["sex"] == "f" else "m"
    table = {
        "sit": f"{s}_sit_chair_idle_neutral_01.max.fbx",
        "look": f"{s}_sit_chair_idle_look_around.max.fbx",
        "thoughtful": f"{s}_sit_chair_gestic_thoughtful.max.fbx",
        "shrug": f"{s}_sit_chair_gestic_shrug_01.max.fbx",
        "stand": f"{s}_idle_neutral_01.max.fbx",
        "talk": f"{s}_gestic_talk_neutral_01.max.fbx",
        "talk_relaxed": f"{s}_gestic_talk_relaxed_01.max.fbx",
        "present": f"{s}_gestic_presentation_left_01.max.fbx",
        "wave": f"{s}_wave_01.max.fbx",
        "standup": f"{s}_sit_stand_up_chair_01.max.fbx",
    }
    # standup lives in the xyz (root-motion) folder if present
    name = table[kind]
    p = anim_path(name)
    if kind == "standup":
        xyz = p.replace("all_animations_max_motextr_static", "all_animations_max_motextr_xyz")
        if os.path.isfile(xyz):
            return xyz
        # some trees keep xyz clips alongside static with the same name
        if not os.path.isfile(p):
            alt = os.path.join(os.path.dirname(os.path.dirname(p)), "all_animations_max_motextr_xyz", name)
            if os.path.isfile(alt):
                return alt
    return p if os.path.isfile(p) else None


def wipe():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for coll in (
        bpy.data.actions, bpy.data.armatures, bpy.data.meshes, bpy.data.materials,
        bpy.data.images, bpy.data.cameras, bpy.data.lights,
    ):
        for b in list(coll):
            try:
                coll.remove(b)
            except Exception:
                pass


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=False
    )
    return [o for o in bpy.data.objects if o not in before]


def remap_textures(tex_dir):
    n = 0
    for img in bpy.data.images:
        fp = (img.filepath or "").replace("\\", "/")
        base = os.path.basename(fp)
        if not base:
            continue
        cand = os.path.join(tex_dir, base)
        if os.path.isfile(cand):
            img.filepath = cand
            img.source = "FILE"
            try:
                img.reload()
            except Exception:
                pass
            low = base.lower()
            if "normal" in low or "specular" in low:
                try:
                    img.colorspace_settings.name = "Non-Color"
                except Exception:
                    pass
            n += 1
    return n


def fix_materials():
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        princ = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not princ:
            continue
        if "opacity" in mat.name.lower():
            mat.blend_method = "HASHED"
            if "Specular IOR Level" in princ.inputs:
                princ.inputs["Specular IOR Level"].default_value = 0.08
            if "Roughness" in princ.inputs:
                princ.inputs["Roughness"].default_value = 0.55


def mesh_children(arm):
    out = []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if o.parent == arm or o.find_armature() == arm:
            out.append(o)
    return out


def ev_bounds(objs):
    deps = bpy.context.evaluated_depsgraph_get()
    xs, ys, zs = [], [], []
    for o in objs:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(deps)
        mw = ev.matrix_world
        for v in ev.data.vertices:
            w = mw @ v.co
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    if not xs:
        return None
    return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))


def plant_feet(arm, meshes):
    bpy.context.view_layer.update()
    b = ev_bounds(meshes)
    if not b:
        return 0
    dz = -b[4]
    if abs(dz) > 1e-4:
        arm.location.z += dz
        bpy.context.view_layer.update()
    return dz


def add_anim_armature(path):
    new = import_fbx(path)
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    for o in new:
        if o is not arm:
            try:
                bpy.data.objects.remove(o, do_unlink=True)
            except Exception:
                pass
    if arm and arm.animation_data and arm.animation_data.action:
        ad = arm.animation_data
        act = ad.action
        if hasattr(ad, "action_slot") and act.slots and not ad.action_slot:
            try:
                ad.action_slot = act.slots[0]
            except Exception:
                pass
        arm.hide_render = True
    return arm


def constrain_retarget(src, dst):
    helpers = []
    for pb in dst.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        if pb.name not in src.pose.bones:
            continue
        cl = pb.constraints.new("COPY_LOCATION")
        cl.target = src
        cl.subtarget = pb.name
        cl.target_space = "WORLD"
        cl.owner_space = "WORLD"
        dt = pb.constraints.new("DAMPED_TRACK")
        dt.target = src
        dt.subtarget = pb.name
        dt.track_axis = "TRACK_Y"
        dt.head_tail = 1.0
        parent = bpy.data.objects.new(f"rf_{pb.name}", None)
        bpy.context.collection.objects.link(parent)
        parent.hide_render = True
        ct = parent.constraints.new("COPY_TRANSFORMS")
        ct.target = src
        ct.subtarget = pb.name
        child = bpy.data.objects.new(f"rt_{pb.name}", None)
        bpy.context.collection.objects.link(child)
        child.hide_render = True
        child.parent = parent
        child.location = (0.18, 0, 0)
        lt = pb.constraints.new("LOCKED_TRACK")
        lt.target = child
        lt.track_axis = "TRACK_X"
        lt.lock_axis = "LOCK_Y"
        helpers += [parent, child]
    return helpers


def cleanup_helpers(prefix=("rf_", "rt_")):
    for o in list(bpy.data.objects):
        if o.name.startswith(prefix) or o.type == "EMPTY":
            try:
                bpy.data.objects.remove(o, do_unlink=True)
            except Exception:
                pass


def bake_retarget(char_arm, src_arm, frame_start, frame_end, action_name):
    constrain_retarget(src_arm, char_arm)
    bpy.context.view_layer.objects.active = char_arm
    for o in bpy.data.objects:
        o.select_set(o == char_arm)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(
        frame_start=int(frame_start),
        frame_end=int(frame_end),
        only_selected=True,
        visual_keying=True,
        clear_constraints=True,
        use_current_action=False,
        bake_types={"POSE"},
        step=1,
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    act = char_arm.animation_data.action if char_arm.animation_data else None
    if act:
        act.name = action_name
        act["clip"] = action_name.split("_", 1)[-1] if "_" in action_name else action_name
        act.use_fake_user = True
    try:
        bpy.data.objects.remove(src_arm, do_unlink=True)
    except Exception:
        pass
    cleanup_helpers()
    return act


def official_clip(char_arm, card, kind, action_name, nframes=48, start=1):
    path = clip_file(card, kind)
    if not path:
        print("  missing clip", kind)
        return None
    src = add_anim_armature(path)
    if not src or not src.animation_data or not src.animation_data.action:
        print("  no action", path)
        return None
    act = src.animation_data.action
    fr0, fr1 = int(act.frame_range[0]), int(act.frame_range[1])
    fs = max(fr0, int(start))
    fe = min(fr1, fs + int(nframes) - 1)
    baked = bake_retarget(char_arm, src, fs, fe, action_name)
    print(f"  official {kind} -> {action_name} {fs}-{fe} from {os.path.basename(path)}")
    return baked


def capture_pose(arm):
    return {b.name: b.matrix_basis.copy() for b in arm.pose.bones}


def apply_pose(arm, pose):
    for name, m in pose.items():
        pb = arm.pose.bones.get(name)
        if pb:
            pb.matrix_basis = m.copy()


def add_rot(pb, axis, deg):
    if not pb:
        return
    pb.matrix_basis = pb.matrix_basis @ Matrix.Rotation(math.radians(deg), 4, axis)


def world_of(arm, name, use="head"):
    pb = arm.pose.bones.get(name)
    if not pb:
        return Vector((0, 0, 0))
    pt = pb.head if use == "head" else pb.tail
    return arm.matrix_world @ pt


def pick_axis(arm, bone, target_name, mode="raise"):
    """Pick a local axis/sign that raises a target bone (or nods the head)."""
    pb = arm.pose.bones.get(bone)
    if not pb:
        return ("X", 1, 0)
    base = capture_pose(arm)
    use0 = "tail" if mode == "nod" and target_name.endswith("Head") else "head"
    p0 = world_of(arm, target_name, use=use0)
    z0, y0 = p0.z, p0.y
    best = ("X", 1, -1)
    for axis in "XYZ":
        for sign in (1, -1):
            apply_pose(arm, base)
            add_rot(pb, axis, sign * 70)
            bpy.context.view_layer.update()
            use = "tail" if mode == "nod" and target_name.endswith("Head") else "head"
            pt = world_of(arm, target_name, use=use)
            z, y = pt.z, pt.y
            score = (z - z0) if mode == "raise" else ((y0 - y) + (z0 - z) * 0.3)
            if score > best[2]:
                best = (axis, sign, score)
    apply_pose(arm, base)
    bpy.context.view_layer.update()
    return best


def key_all(arm, frame):
    for b in arm.pose.bones:
        b.keyframe_insert("location", frame=frame)
        if b.rotation_mode == "QUATERNION":
            b.keyframe_insert("rotation_quaternion", frame=frame)
        else:
            b.keyframe_insert("rotation_euler", frame=frame)


def new_action(arm, name):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad = arm.animation_data_create()
    ad.action = act
    if hasattr(ad, "action_slot") and act.slots:
        try:
            ad.action_slot = act.slots[0]
        except Exception:
            pass
    return act


def keyframe_from_pose(arm, base_pose, name, frames, setup_fn):
    act = new_action(arm, name)
    for i in range(frames + 1):
        t = i / frames
        apply_pose(arm, base_pose)
        setup_fn(arm, t)
        bpy.context.view_layer.update()
        key_all(arm, i + 1)
    apply_pose(arm, base_pose)
    setup_fn(arm, 0)
    key_all(arm, frames + 1)
    return act


def pb(arm, name):
    return arm.pose.bones.get(name)


def anim_raise_hand(arm, base, side, action_name, params):
    axis, sign, _ = params
    S = "R" if side == "r" else "L"
    ub, cb, fb = f"Bip01 {S} UpperArm", f"Bip01 {S} Clavicle", f"Bip01 {S} Forearm"

    def fn(a, t):
        k = (1 - math.cos(min(1, t * 1.15) * math.pi)) * 0.5
        if t > 0.85:
            k = k * (1 - (t - 0.85) / 0.15 * 0.12)
        add_rot(pb(a, cb), axis, sign * 12 * k)
        add_rot(pb(a, ub), axis, sign * 95 * k)
        add_rot(pb(a, fb), axis, sign * 18 * k)

    return keyframe_from_pose(arm, base, action_name, 36, fn)


def anim_nod(arm, base, action_name, params):
    axis, sign, _ = params

    def fn(a, t):
        n = math.sin(t * math.tau * 2) * 12
        add_rot(pb(a, "Bip01 Head"), axis, sign * n)
        add_rot(pb(a, "Bip01 Neck"), axis, sign * n * 0.3)

    return keyframe_from_pose(arm, base, action_name, 32, fn)


def anim_group_read(arm, base, action_name, nod_params):
    axis, sign, _ = nod_params

    def fn(a, t):
        w = math.sin(t * math.tau * 2)
        add_rot(pb(a, "Bip01 Spine"), axis, sign * 8)
        add_rot(pb(a, "Bip01 Spine1"), axis, sign * 6)
        add_rot(pb(a, "Bip01 Head"), axis, sign * (14 + 2 * w))
        add_rot(pb(a, "Bip01 Neck"), axis, sign * 6)

    return keyframe_from_pose(arm, base, action_name, 40, fn)


def anim_ask(arm, base, side, action_name, raise_params):
    axis, sign, _ = raise_params
    S = "R" if side == "r" else "L"

    def fn(a, t):
        k = (1 - math.cos(min(1, t * 1.4) * math.pi)) * 0.5
        add_rot(pb(a, f"Bip01 {S} UpperArm"), axis, sign * 35 * k)
        add_rot(pb(a, "Bip01 Head"), "Z", 6 * k)

    return keyframe_from_pose(arm, base, action_name, 40, fn)


def anim_walk(arm, base, action_name):
    def fn(a, t):
        ph = t * math.tau
        th = math.sin(ph) * 22
        add_rot(pb(a, "Bip01 L Thigh"), "Z", th)
        add_rot(pb(a, "Bip01 R Thigh"), "Z", -th)
        add_rot(pb(a, "Bip01 L Calf"), "Z", -abs(math.sin(ph)) * 16)
        add_rot(pb(a, "Bip01 R Calf"), "Z", -abs(math.sin(-ph)) * 16)

    return keyframe_from_pose(arm, base, action_name, 32, fn)


def anim_turn_board(arm, base, action_name, raise_params=None):
    # Turn the torso toward stage right (local, then a bit of arm raise).
    def fn(a, t):
        k = (1 - math.cos(min(1, t) * math.pi)) * 0.5
        add_rot(pb(a, "Bip01 Pelvis"), "Z", -40 * k)
        add_rot(pb(a, "Bip01 Spine"), "Z", -12 * k)
        add_rot(pb(a, "Bip01 Head"), "Z", -8 * k)
        if raise_params:
            axis, sign, _ = raise_params
            add_rot(pb(a, "Bip01 R UpperArm"), axis, sign * 40 * k)

    return keyframe_from_pose(arm, base, action_name, 48, fn)


def stash_nla(arm, actions):
    if arm.animation_data is None:
        arm.animation_data_create()
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
    for act, clip in actions:
        if act is None:
            continue
        track = arm.animation_data.nla_tracks.new()
        track.name = act.name  # e.g. s5_idle_sit — three.js splits on the rig prefix
        try:
            strip = track.strips.new(act.name, 1, act)
            strip.action = act
        except Exception as e:
            print("  nla fail", clip, e)
    arm.animation_data.action = None


def load_character(card):
    fbx, tex = char_paths(card)
    new = import_fbx(fbx)
    n = remap_textures(tex)
    print(f"  remapped {n} textures")
    fix_materials()
    arm = next(o for o in new if o.type == "ARMATURE")
    arm.name = f"{card['id']}_rig"
    if arm.data:
        arm.data.name = f"{card['id']}_arm"
    for o in new:
        if o.type == "EMPTY":
            try:
                bpy.data.objects.remove(o, do_unlink=True)
            except Exception:
                pass
        elif o.type == "MESH":
            o.name = f"{card['id']}_{o.name}"
    meshes = mesh_children(arm)
    return arm, meshes


def build_anims(arm, card, meshes):
    prefix = card["id"]
    acts = []
    if card["role"] == "teacher":
        official_clip(arm, card, "stand", f"{prefix}_idle_stand", nframes=48)
        plant_feet(arm, meshes)
        bpy.context.scene.frame_set(8)
        bpy.context.view_layer.update()
        stand_pose = capture_pose(arm)
        raise_p = pick_axis(arm, "Bip01 R UpperArm", "Bip01 R Hand", "raise")
        print("  raise params", raise_p)
        acts.append((bpy.data.actions.get(f"{prefix}_idle_stand"), "idle_stand"))
        acts.append((official_clip(arm, card, "talk", f"{prefix}_talk", nframes=48), "talk"))
        acts.append((official_clip(arm, card, "talk_relaxed", f"{prefix}_talk_gesture", nframes=40) or official_clip(arm, card, "present", f"{prefix}_talk_gesture", nframes=40), "talk_gesture"))
        acts.append((anim_walk(arm, stand_pose, f"{prefix}_walk"), "walk"))
        acts.append((official_clip(arm, card, "present", f"{prefix}_turn_board", nframes=48) or anim_turn_board(arm, stand_pose, f"{prefix}_turn_board", raise_p), "turn_board"))
    else:
        official_clip(arm, card, "sit", f"{prefix}_idle_sit", nframes=64)
        plant_feet(arm, meshes)
        bpy.context.scene.frame_set(8)
        bpy.context.view_layer.update()
        sit_pose = capture_pose(arm)
        side = card.get("raise_hand", "r")
        S = "R" if side == "r" else "L"
        raise_p = pick_axis(arm, f"Bip01 {S} UpperArm", f"Bip01 {S} Hand", "raise")
        nod_target = "Bip01 MNose" if arm.pose.bones.get("Bip01 MNose") else "Bip01 Head"
        nod_p = pick_axis(arm, "Bip01 Head", nod_target, "nod")
        print("  raise params", raise_p, "nod params", nod_p)
        acts.append((bpy.data.actions.get(f"{prefix}_idle_sit"), "idle_sit"))
        if card["role"] == "guest":
            acts.append((anim_ask(arm, sit_pose, side, f"{prefix}_ask", raise_p), "ask"))
            acts.append((anim_nod(arm, sit_pose, f"{prefix}_nod", nod_p), "nod"))
            acts.append((official_clip(arm, card, "thoughtful", f"{prefix}_speak", nframes=40), "speak"))
            acts.append((official_clip(arm, card, "shrug", f"{prefix}_confused", nframes=40), "confused"))
        else:
            acts.append((anim_raise_hand(arm, sit_pose, side, f"{prefix}_raise_hand", raise_p), "raise_hand"))
            acts.append((anim_nod(arm, sit_pose, f"{prefix}_nod", nod_p), "nod"))
            acts.append((official_clip(arm, card, "shrug", f"{prefix}_confused", nframes=40), "confused"))
            acts.append((official_clip(arm, card, "look", f"{prefix}_distracted", nframes=48), "distracted"))
            acts.append((official_clip(arm, card, "thoughtful", f"{prefix}_speak", nframes=40), "speak"))
            acts.append((anim_group_read(arm, sit_pose, f"{prefix}_group_read", nod_p), "group_read"))
            acts.append((official_clip(arm, card, "standup", f"{prefix}_stand_to_read", nframes=48) or anim_group_read(arm, sit_pose, f"{prefix}_stand_to_read", nod_p), "stand_to_read"))
    stash_nla(arm, acts)
    return acts


def shrink_images(max_color=1024, max_normal=768, max_opacity=768, jpeg_q=82):
    tmp = "/tmp/rocketbox/tex-shrunk"
    os.makedirs(tmp, exist_ok=True)
    for img in list(bpy.data.images):
        w, h = img.size
        if w <= 0 or h <= 0:
            continue
        name = (img.name or "").lower() + " " + os.path.basename((img.filepath or "")).lower()
        if "opacity" in name or "hair" in name:
            max_dim = max_opacity
            need_alpha = True
        elif "normal" in name or "specular" in name or "spec" in name:
            max_dim = max_normal
            need_alpha = False
        else:
            max_dim = max_color
            need_alpha = bool(img.depth and img.depth >= 32 and any(k in name for k in ("opacity", "hair", "alpha")))
        if max(w, h) > max_dim:
            nw = max(1, int(round(w * max_dim / max(w, h))))
            nh = max(1, int(round(h * max_dim / max(w, h))))
            try:
                img.scale(nw, nh)
            except Exception as e:
                print("  scale fail", img.name, e)
                continue
        try:
            ext = ".png" if need_alpha else ".jpg"
            img.file_format = "PNG" if need_alpha else "JPEG"
            if not need_alpha:
                # Blender JPEG quality is on the scene render settings for save_render
                bpy.context.scene.render.image_settings.file_format = "JPEG"
                bpy.context.scene.render.image_settings.quality = jpeg_q
            dest = os.path.join(tmp, img.name.replace("/", "_")[:80] + ext)
            img.save_render(dest)
            img.filepath = dest
            img.source = "FILE"
            img.reload()
            img.pack()
        except Exception as e:
            print("  recompress fail", img.name, e)
    print("  images after shrink:", len(bpy.data.images))


def character_objects(rig):
    objs = [rig]
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if o.parent == rig or o.find_armature() == rig:
            objs.append(o)
    return objs


def export_glb(path, objects):
    shrink_images()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    keep = set()
    for o in objects:
        keep.add(o)
        if o.type == "ARMATURE":
            keep.update(character_objects(o))
        try:
            for ch in o.children_recursive:
                if ch.type != "EMPTY":
                    keep.add(ch)
        except Exception:
            pass
    for o in keep:
        try:
            o.hide_set(False)
            o.hide_viewport = False
            o.hide_render = o.type == "ARMATURE"
            o.select_set(True)
        except Exception:
            pass
    arms = [o for o in keep if o.type == "ARMATURE"]
    if arms:
        bpy.context.view_layer.objects.active = arms[0]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    kw = dict(
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
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_extras=True,
        export_yup=True,
    )
    # Prefer WebP when the exporter supports it (Blender 4.2+).
    try:
        bpy.ops.export_scene.gltf(export_image_format="WEBP", export_image_quality=82, **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(export_image_format="JPEG", export_jpeg_quality=82, **kw)
    print("exported", path, "bytes", os.path.getsize(path) if os.path.exists(path) else 0)


def mat(name, color, roughness=0.7):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = roughness
    return m


def box(name, size, loc, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
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
    objs.append(box("lectern_top", (0.78, 0.5, 0.05), (0, 0.32, 0.92), wood_dk))
    return objs


def place_character(arm, origin, face_board=True):
    arm.location.x = origin[0]
    arm.location.y = origin[1]
    # keep planted z
    if face_board:
        arm.rotation_euler[2] = arm.rotation_euler[2] + math.pi
    bpy.context.view_layer.update()


def build_one(card, origin=(0, 0, 0), face_board=True):
    print("building", card["id"], card["name"])
    arm, meshes = load_character(card)
    build_anims(arm, card, meshes)
    place_character(arm, origin, face_board=face_board)
    return arm


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    out = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "characters")
    i = 0
    while i < len(args):
        if args[i] == "--one" and i + 1 < len(args):
            only = args[i + 1]
            i += 2
            continue
        if args[i] == "--out" and i + 1 < len(args):
            out = args[i + 1]
            i += 2
            continue
        i += 1
    return only, os.path.abspath(out)


def write_manifest(out):
    files = {}
    total = 0
    for name in ("classroom.glb", "guests.glb", "podium.glb", "students.glb", "teacher.glb"):
        p = os.path.join(out, name)
        if os.path.isfile(p):
            files[name] = os.path.getsize(p)
            total += files[name]
    man = {
        "license": "MIT (Microsoft Rocketbox Avatar Library, Copyright (c) 2020 Microsoft); classroom set and keyframed clips by 沉思波 · 体态镜",
        "source": "https://github.com/microsoft/Microsoft-Rocketbox",
        "clips": {
            "student": ["idle_sit", "raise_hand", "nod", "confused", "distracted", "speak", "group_read", "stand_to_read"],
            "guest": ["idle_sit", "ask", "nod", "speak", "confused"],
            "teacher": ["idle_stand", "talk", "talk_gesture", "walk", "turn_board"],
        },
        "cast": [
            {"id": c["id"], "label": c["label"], "role": c["role"], "source": c["name"]}
            for c in CAST
        ],
        "files": files,
        "totalBytes": total,
    }
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(man, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("manifest total MB", round(total / 1048576, 2))


def main():
    only, out = parse_args()
    os.makedirs(out, exist_ok=True)
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 64
    students = [c for c in CAST if c["role"] == "student"]
    guests = [c for c in CAST if c["role"] == "guest"]
    teacher = next(c for c in CAST if c["role"] == "teacher")

    if only:
        card = next(c for c in CAST if c["id"] == only or c["name"] == only)
        wipe()
        rig = build_one(card, origin=(0, 0, 0), face_board=False)
        export_glb(os.path.join(out, f"{card['id']}.glb"), [rig])
        print("done one", card["id"])
        return

    wipe()
    roots = []
    span = 3.2
    n = len(students)
    for i, card in enumerate(students):
        t = 0 if n == 1 else i / (n - 1)
        x = -span / 2 + t * span
        roots.append(build_one(card, origin=(x, -0.28, 0), face_board=True))
    export_glb(os.path.join(out, "students.glb"), roots)

    wipe()
    roots = []
    for i, card in enumerate(guests):
        x = -1.0 + i * 1.0
        roots.append(build_one(card, origin=(x, -0.2, 0), face_board=True))
    export_glb(os.path.join(out, "guests.glb"), roots)

    wipe()
    root = build_one(teacher, origin=(0, 0.05, 0), face_board=True)
    export_glb(os.path.join(out, "teacher.glb"), [root])

    wipe()
    export_glb(os.path.join(out, "classroom.glb"), build_classroom())
    wipe()
    export_glb(os.path.join(out, "podium.glb"), build_podium())
    write_manifest(out)
    print("done")


if __name__ == "__main__":
    main()

/**
 * Lazy-loaded 3D classroom / podium scenes (three.js).
 * Call canUse3D() first; on failure the UI keeps the SVG / 2D illustrations.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { demoMotionAt, projectedPose } from "./demo-motion.js";

const STATE_CLIP = {
  idle: "idle_sit",
  hand: "raise_hand",
  speaking: "speak",
  asking: "ask",
  reading: "group_read",
  stand_read: "stand_to_read",
  listening: "idle_sit",
  confused: "confused",
  distracted: "distracted",
};

const TEACHER_CLIPS = {
  idle: "idle_stand",
  talk: "talk",
  gesture: "talk_gesture",
  walk: "walk",
  board: "turn_board",
};

export function assetUrl(rel) {
  try {
    return new URL(rel, document.baseURI).href;
  } catch (_) {
    return rel;
  }
}

export function canUse3D(opts = {}) {
  if (typeof window === "undefined") return false;
  if (opts.force === "off" || opts.force === "illustration") return false;
  if (opts.force === "on") return hasWebGL();
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  } catch (_) {}
  return hasWebGL() && !isSoftwareRenderer();
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (_) {
    return false;
  }
}

function isSoftwareRenderer() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return true;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || "") : "";
    return /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer);
  } catch (_) {
    return false;
  }
}

function makeLoader() {
  const draco = new DRACOLoader();
  draco.setDecoderPath(assetUrl("assets/vendor/draco/"));
  draco.setDecoderConfig({ type: "wasm" });
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return { loader, draco };
}

function loadGltf(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function warmLights(scene) {
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x6a5a48, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.35);
  sun.position.set(2.2, 4.0, 2.4);
  scene.add(sun);
  scene.background = new THREE.Color(0xddd4c6);
}

function collectMixers(root) {
  const mixers = [];
  const clipsByName = new Map();
  const clips = root.animations || [];
  root.scene.traverse((obj) => {
    if (obj.isSkinnedMesh) obj.frustumCulled = false;
  });
  // One mixer per armature (Object3D with bones / isSkinnedMesh parent)
  const armatures = [];
  root.scene.traverse((obj) => {
    if (obj.type === "SkinnedMesh" && obj.skeleton && obj.skeleton.bones[0]) {
      const arm = obj.skeleton.bones[0];
      // climb to the armature object
      let p = obj;
      while (p && p.type !== "Bone" && p.parent) {
        if (p.animations || (p.parent && p.parent.type === "Group")) {
          /* keep climbing */
        }
        if (p.type === "Object3D" || p.type === "Group" || p.type === "Bone") {
          /* noop */
        }
        // The glTF armature is typically an Object3D named *_rig
        p = p.parent;
        if (p && /_rig$/.test(p.name)) {
          if (!armatures.includes(p)) armatures.push(p);
          break;
        }
      }
    }
  });
  // Fallback: any object whose name ends with _rig
  if (!armatures.length) {
    root.scene.traverse((obj) => {
      if (/_rig$/.test(obj.name) && !armatures.includes(obj)) armatures.push(obj);
    });
  }
  for (const arm of armatures) {
    const mixer = new THREE.AnimationMixer(arm);
    const prefix = arm.name.replace(/_rig$/, "");
    const actions = {};
    for (const clip of clips) {
      const name = clip.name;
      const isMine = name.startsWith(prefix + "_") || name.includes(prefix + "_");
      if (!isMine && armatures.length > 1) continue;
      const clipId = name.startsWith(prefix + "_") ? name.slice(prefix.length + 1) : name;
      try {
        actions[clipId] = mixer.clipAction(clip);
        actions[clipId].enabled = true;
      } catch (_) {}
    }
    mixers.push({ mixer, arm, id: prefix, actions, current: null });
    clipsByName.set(prefix, actions);
  }
  return { mixers, clipsByName };
}

function playClip(entry, clipName, fade = 0.25) {
  if (!entry || !entry.actions) return;
  const next = entry.actions[clipName];
  if (!next) return;
  if (entry.current === next) return;
  if (entry.current) entry.current.fadeOut(fade);
  next.reset().fadeIn(fade).play();
  entry.current = next;
}

function findEntry(mixers, id) {
  return mixers.find((m) => m.id === id || m.id.startsWith(id));
}

export async function mountClassroomScene(host, { mode = "class", onPick } = {}) {
  const { loader, draco } = makeLoader();
  const scene = new THREE.Scene();
  warmLights(scene);
  const camera = new THREE.PerspectiveCamera(44, 1, 0.05, 40);
  // glTF Y-up: Blender (x, y, z) → three.js (x, z, -y).
  // The board / back wall sits at z ≈ -2.34. A camera at z < -2.34 looks at the
  // back of that wall and renders a blank gray frame. Stay in front of it,
  // slightly off-axis so the blackboard stays in view with the seated row.
  if (mode === "roadshow") {
    camera.position.set(2.05, 1.55, -1.15);
    camera.lookAt(0, 0.8, 0.15);
  } else {
    camera.position.set(2.35, 1.72, -1.25);
    camera.lookAt(0, 0.88, 0.05);
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "default" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.className = "sim-3d-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");

  const peopleFile = mode === "roadshow" ? "guests.glb" : "students.glb";
  const setFile = mode === "roadshow" ? "podium.glb" : "classroom.glb";
  const [peopleGltf, setGltf] = await Promise.all([
    loadGltf(loader, assetUrl(`assets/characters/${peopleFile}`)),
    loadGltf(loader, assetUrl(`assets/characters/${setFile}`)),
  ]);
  scene.add(setGltf.scene);
  scene.add(peopleGltf.scene);
  const packed = collectMixers(peopleGltf);
  packed.mixers.forEach((e) => playClip(e, "idle_sit", 0));

  const clock = new THREE.Clock();
  let running = true;
  const ro = new ResizeObserver(() => resize());
  ro.observe(host);
  function resize() {
    const w = Math.max(1, host.clientWidth || 320);
    const h = Math.max(1, host.clientHeight || 220);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  resize();

  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  function onClick(ev) {
    if (!onPick) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObject(peopleGltf.scene, true);
    if (!hits.length) return;
    let obj = hits[0].object;
    while (obj && !/_rig$/.test(obj.name)) obj = obj.parent;
    const id = obj && obj.name.replace(/_rig$/, "");
    if (id) onPick(id);
  }
  renderer.domElement.addEventListener("click", onClick);

  function loop() {
    if (!running) return;
    const dt = Math.min(0.05, clock.getDelta());
    packed.mixers.forEach((e) => e.mixer.update(dt));
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    setStates(people) {
      for (const p of people || []) {
        const entry = findEntry(packed.mixers, p.id);
        if (!entry) continue;
        playClip(entry, STATE_CLIP[p.state] || "idle_sit");
      }
    },
    dispose() {
      running = false;
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      try { draco.dispose(); } catch (_) {}
    },
  };
}

export async function mountPresenterScene(host, { clip = "talk" } = {}) {
  const { loader, draco } = makeLoader();
  const scene = new THREE.Scene();
  // Presenter-only lighting: the shared classroom key leaves the face in shade.
  // A broad hemispheric fill and frontal key reveal the notes-facing pose.
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x887c72, 1.85));
  scene.add(new THREE.AmbientLight(0xf4f2ef, 0.65));
  const faceFill = new THREE.DirectionalLight(0xfff6eb, 2.8);
  faceFill.position.set(-0.5, 2.6, 3.2);
  faceFill.target.position.set(0, 1.1, 0);
  scene.add(faceFill, faceFill.target);
  scene.background = new THREE.Color(0xcfc4b4);
  const camera = new THREE.PerspectiveCamera(32, 9 / 16, 0.05, 30);
  camera.position.set(0.15, 1.23, 3.65);
  camera.lookAt(0, 0.93, 0.2);
  let renderer, ro, rafId = 0, teacherGltf, podiumGltf;
  let running = true, scripted = false, lastClip = "", entry = null;
  const clock = new THREE.Clock();
  // GLTFLoader sanitizes whitespace in node names; retain the original keys
  // expected by projectedPose while matching the actual runtime bone names.
  const jointNames = ["MNose", "L UpperArm", "R UpperArm", "L Forearm", "R Forearm", "L Hand", "R Hand", "L Thigh", "R Thigh", "L Calf", "R Calf", "L Foot", "R Foot", "L Toe0", "R Toe0"].map((n) => `Bip01 ${n}`);
  const jointByRuntimeName = new Map(jointNames.map((name) => [THREE.PropertyBinding.sanitizeNodeName(name), name]));
  const joints = new Map();
  const world = new THREE.Vector3();
  const poseBones = new Map();
  const restRotations = new Map();
  // In this glTF the spine/neck/head local X points up, Y points forward,
  // and Z points to the model's right (confirmed against the exported rig).
  const up = new THREE.Vector3(1, 0, 0);
  const forward = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3(0, 0, 1);
  const turn = new THREE.Quaternion();

  function dispose() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    ro?.disconnect();
    entry?.mixer.stopAllAction();
    for (const gltf of [teacherGltf, podiumGltf]) gltf?.scene.traverse((obj) => {
      obj.geometry?.dispose();
      for (const material of Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []) {
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
    });
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
    draco.dispose();
  }

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "default" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.className = "presenter-3d-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    [teacherGltf, podiumGltf] = await Promise.all([
      loadGltf(loader, assetUrl("assets/characters/teacher.glb")),
      loadGltf(loader, assetUrl("assets/characters/podium.glb")),
    ]);
    scene.add(podiumGltf.scene, teacherGltf.scene);
    teacherGltf.scene.rotation.y = Math.PI;
    teacherGltf.scene.position.set(0, 0, 0.15);
    const packed = collectMixers(teacherGltf);
    entry = packed.mixers[0];
    if (entry) playClip(entry, TEACHER_CLIPS[clip] || clip || "talk", 0);
    const animatedBones = new Set(["Pelvis", "Spine1", "Spine2", "Neck", "Head"]);
    teacherGltf.scene.traverse((obj) => {
      const key = obj.isBone && jointByRuntimeName.get(obj.name);
      if (key) joints.set(key, obj);
      if (!obj.isBone) return;
      for (const name of animatedBones) {
        if (obj.name !== THREE.PropertyBinding.sanitizeNodeName(`Bip01 ${name}`)) continue;
        poseBones.set(name, obj);
        restRotations.set(name, obj.quaternion.clone());
      }
    });
    ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
  } catch (err) {
    dispose();
    throw err;
  }

  function resize() {
    const w = Math.max(1, host.clientWidth || 320);
    const h = Math.max(1, host.clientHeight || 480);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  function getProjectedPose() {
    if (!entry || joints.size !== jointNames.length) return null;
    camera.updateMatrixWorld();
    teacherGltf.scene.updateMatrixWorld(true);
    const points = {};
    for (const name of jointNames) {
      const bone = joints.get(name);
      bone.getWorldPosition(world).project(camera);
      points[name] = { x: world.x, y: world.y, z: world.z };
    }
    return projectedPose(points);
  }
  function setDemoTime(t) {
    scripted = true;
    const { clip: name, clipTime, params } = demoMotionAt(t);
    const clipId = TEACHER_CLIPS[name];
    const action = entry?.actions[clipId];
    // Even a repeat seek to the same clip must deactivate its bindings: the
    // previous quaternion overlay is otherwise blended into the next sample.
    // stopAllAction restores the mixer's captured pre-animation transform for
    // every animated track (including bones this overlay does not touch).
    if (entry) entry.mixer.stopAllAction();
    for (const [boneName, bone] of poseBones) bone.quaternion.copy(restRotations.get(boneName));
    if (action) {
      action.reset().setEffectiveWeight(1).play();
      entry.current = action;
      lastClip = clipId;
      entry.mixer.setTime(clipTime % action.getClip().duration);
    }
    // Local axes in teacher.glb: X is up, Y faces the audience, Z is right.
    // Pose the actual rig (not the 2D overlay or the scene root). A positive
    // pitch nods toward the notes; the waist turn leaves the feet in place.
    function rotate(name, axis, angle) {
      const bone = poseBones.get(name);
      if (bone && angle) bone.quaternion.multiply(turn.setFromAxisAngle(axis, angle));
    }
    rotate("Spine1", forward, -params.swayX * 1.6 - params.weight * 0.045);
    rotate("Spine2", up, params.bodyYaw * 0.75);
    rotate("Spine2", forward, -params.swayX * 0.8 + params.weight * 0.035);
    rotate("Spine2", right, params.headPitch * 0.12);
    rotate("Neck", up, params.bodyYaw * 0.25 + params.headYaw * 0.6);
    rotate("Head", up, params.headYaw * 0.4);
    rotate("Head", right, params.headPitch * 0.88);
    teacherGltf.scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
    return getProjectedPose();
  }
  function loop() {
    if (!running) return;
    if (!scripted) {
      const dt = Math.min(0.05, clock.getDelta());
      entry?.mixer.update(dt);
      renderer.render(scene, camera);
    }
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
  return {
    setClip(name) { if (!scripted && entry) playClip(entry, TEACHER_CLIPS[name] || name); },
    setDemoTime,
    getProjectedPose,
    diagnostics() {
      const positions = {};
      camera.updateMatrixWorld();
      teacherGltf.scene.updateMatrixWorld(true);
      for (const [name, bone] of joints) {
        bone.getWorldPosition(world).project(camera);
        positions[name] = [world.x, world.y, world.z].map((n) => Math.round(n * 100) / 100);
      }
      const rig = {};
      for (const [name, bone] of poseBones) {
        const position = bone.getWorldPosition(new THREE.Vector3());
        const rotation = bone.getWorldQuaternion(new THREE.Quaternion());
        rig[name] = { position: position.toArray(), quaternion: rotation.toArray() };
      }
      rig.Nose = { position: joints.get("Bip01 MNose")?.getWorldPosition(new THREE.Vector3()).toArray() };
      return { joints: joints.size, names: jointNames, runtimeBones: teacherGltf.scene.getObjectByName("teacher_rig")?.children.map((o) => o.name).slice(0, 10), clips: Object.keys(entry?.actions || {}), current: lastClip, positions, rig, valid: !!getProjectedPose() };
    },
    dispose,
  };
}

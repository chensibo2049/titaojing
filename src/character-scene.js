/**
 * Lazy-loaded 3D classroom / podium scenes (three.js).
 * Call canUse3D() first; on failure the UI keeps the SVG / 2D illustrations.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

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
  warmLights(scene);
  scene.background = new THREE.Color(0xcfc4b4);
  const camera = new THREE.PerspectiveCamera(32, 9 / 16, 0.05, 30);
  camera.position.set(0.15, 1.35, 3.15);
  camera.lookAt(0, 1.05, 0.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "default" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.className = "presenter-3d-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");

  const [teacherGltf, podiumGltf] = await Promise.all([
    loadGltf(loader, assetUrl("assets/characters/teacher.glb")),
    loadGltf(loader, assetUrl("assets/characters/podium.glb")),
  ]);
  scene.add(podiumGltf.scene);
  scene.add(teacherGltf.scene);
  // Teacher was exported slightly in front of the lectern, facing +Y (the board).
  // Turn her to face the camera (-Y) for the cover / demo shot.
  teacherGltf.scene.rotation.y = Math.PI;
  teacherGltf.scene.position.set(0, 0, 0.15);

  const packed = collectMixers(teacherGltf);
  const entry = packed.mixers[0];
  if (entry) playClip(entry, TEACHER_CLIPS[clip] || clip || "talk", 0);

  const clock = new THREE.Clock();
  let running = true;
  let desired = clip;
  const ro = new ResizeObserver(() => resize());
  ro.observe(host);
  function resize() {
    const w = Math.max(1, host.clientWidth || 320);
    const h = Math.max(1, host.clientHeight || 480);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  resize();

  function loop() {
    if (!running) return;
    const dt = Math.min(0.05, clock.getDelta());
    packed.mixers.forEach((e) => e.mixer.update(dt));
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    setClip(name) {
      desired = name;
      if (entry) playClip(entry, TEACHER_CLIPS[name] || name);
    },
    dispose() {
      running = false;
      ro.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      try { draco.dispose(); } catch (_) {}
    },
  };
}

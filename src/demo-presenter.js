import * as THREE from "three";
import { presenterAt, solveArm } from "./demo-rig.js";

// Original illustration-sculpture geometry, no model downloads or legacy assets.
export function mountDemoPresenter(host) {
  let cleanup = () => {};
  try { return createPresenter(host, fn => { cleanup = fn; }); }
  catch (error) { cleanup(); throw error; }
}
function createPresenter(host, onCleanup) {
  const started = performance.now();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: true });
  onCleanup(() => { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const canvas = renderer.domElement;
  canvas.className = "demo-presenter-canvas";
  canvas.setAttribute("aria-label", "预设三维试讲者，非真实识别");
  host.append(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e9e9df");
  const camera = new THREE.PerspectiveCamera(31, 1, .1, 30);
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0x919e9c, 2.5));
  const key = new THREE.DirectionalLight(0xffe8d3, 3.3); key.position.set(-3, 5, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xdbefff, 1.8); fill.position.set(3, 3, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xfff0d8, 2); rim.position.set(0, 4, -3); scene.add(rim);
  const materials = new Set(), textures = new Set();
  onCleanup(() => {
    scene.traverse(o => o.geometry?.dispose());
    materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
  });
  const mat = (color, roughness = .83) => { const m = new THREE.MeshStandardMaterial({ color, roughness }); materials.add(m); return m; };
  const skin = mat("#dca485"), blush = mat("#cd8d77"), hair = mat("#302d30"), hairLight = mat("#454044");
  const jacket = mat("#446e70"), seam = mat("#365a60"), shirt = mat("#faf0dc"), ink = mat("#322e35"), lip = mat("#925e55");
  const add = (geometry, material, parent = scene) => { const m = new THREE.Mesh(geometry, material); parent.add(m); return m; };
  const ellipsoid = (parent, material, pos, scale) => { const m = add(new THREE.SphereGeometry(1, 32, 24), material, parent); m.position.set(...pos); m.scale.set(...scale); return m; };
  const box = (parent, material, pos, size) => { const m = add(new THREE.BoxGeometry(...size), material, parent); m.position.set(...pos); return m; };
  const stroke = (parent, material, points, radius = .008) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 20, radius, 7, false), material, parent);
  // Continuous elliptical loft. Smooth shoulders/waist and sculpted jaw, not stacked primitives.
  const loft = (parent, material, rows, sides = 48) => {
    const vertices = [], indices = [];
    for (const [y, rx, rz, z = 0] of rows) for (let i = 0; i <= sides; i++) {
      const a = i / sides * Math.PI * 2;
      vertices.push(Math.cos(a) * rx, y, Math.sin(a) * rz + z);
    }
    for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < sides; i++) {
      const a = r * (sides + 1) + i, b = a + sides + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); g.setIndex(indices); g.computeVertexNormals();
    return add(g, material, parent);
  };
  const shape = (parent, material, points, depth = .014) => {
    const s = new THREE.Shape(); s.moveTo(...points[0]); points.slice(1).forEach(p => s.lineTo(...p)); s.closePath();
    const m = add(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .007, bevelThickness: .005 }), material, parent); return m;
  };
  // Room: board above and to the presenter's right. Legible text is authored, not OCR.
  box(scene, mat("#c6cbbf"), [0, 1.45, -.88], [6, 3.3, .12]);
  box(scene, mat("#ac9a7c"), [.45, 1.99, -.72], [2.8, 1.36, .09]);
  box(scene, mat("#375958"), [.45, 2.0, -.66], [2.69, 1.25, .045]);
  box(scene, mat("#c7b493"), [.45, 1.34, -.55], [2.84, .045, .18]);
  const boardCanvas = document.createElement("canvas"); boardCanvas.width = 1024; boardCanvas.height = 512;
  const boardContext = boardCanvas.getContext("2d");
  const boardTexture = new THREE.CanvasTexture(boardCanvas); boardTexture.colorSpace = THREE.SRGBColorSpace; textures.add(boardTexture);
  const boardMaterial = new THREE.MeshBasicMaterial({ map: boardTexture, transparent: true }); materials.add(boardMaterial);
  const boardText = add(new THREE.PlaneGeometry(2.64, 1.21), boardMaterial); boardText.position.set(.45, 2, -.632);
  let lastLetters = -1;
  function paintBoard(progress) {
    const letters = Math.floor(progress * 5 + .001); if (letters === lastLetters) return; lastLetters = letters;
    boardContext.clearRect(0, 0, 1024, 512);
    boardContext.fillStyle = "#cbdcd1"; boardContext.font = '24px "PingFang SC", sans-serif';
    boardContext.fillText("静夜思  /  诗句练习", 440, 210);
    boardContext.fillStyle = "#f7f0d8"; boardContext.font = '54px "Kaiti SC", "Songti SC", serif';
    [..."疑是地上霜"].slice(0, letters).forEach((c, i) => boardContext.fillText(c, 440 + (i % 3) * 130, 285 + Math.floor(i / 3) * 80));
    boardContext.strokeStyle = "#b9cebd"; boardContext.lineWidth = 2; boardContext.beginPath(); boardContext.moveTo(440, 400); boardContext.lineTo(900, 400); boardContext.stroke();
    boardContext.font = '21px "PingFang SC", sans-serif'; boardContext.fillStyle = "#cbdbce"; boardContext.fillText("板书区 · 预设书写", 440, 420);
    boardTexture.needsUpdate = true;
  }
  // Anchored lower body; only upper-body weight shifts, feet never translate.
  const root = new THREE.Group(); root.position.set(-.42, 0, .08); scene.add(root);
  const trousers = mat("#3c4752"), shoes = mat("#33353c");
  for (const x of [-.12, .12]) {
    const leg = loft(root, trousers, [[.055,.07,.085],[.20,.071,.075],[.55,.085,.085],[.91,.10,.11]]); leg.position.x = x;
    ellipsoid(root, shoes, [x,.055,.075], [.088,.055,.16]);
  }
  const torso = new THREE.Group(); torso.position.y = .87; root.add(torso);
  loft(torso, jacket, [[0,.205,.135],[.12,.218,.147],[.34,.258,.16],[.57,.294,.153],[.65,.245,.136],[.69,.13,.10],[.70,.08,.07]]);
  const shirtPanel = shape(torso, shirt, [[-.105,.64],[.105,.64],[.105,.27],[0,.25],[-.105,.27]], .009); shirtPanel.position.z = .187;
  for (const side of [-1,1]) {
    const collar = shape(torso, shirt, [[0,.69],[side*.1,.65],[side*.105,.53],[side*.025,.58]], .012); collar.position.z=.204;
    const lapel = shape(torso, seam, [[side*.12,.64],[side*.22,.52],[side*.16,.44],[side*.19,.38],[side*.06,.22]], .013); lapel.position.z = .179;
    stroke(torso, seam, [[side*.16,.14,.133],[side*.18,.15,.14],[side*.20,.15,.135]], .004);
  }
  for (const y of [.2,.1]) ellipsoid(torso, mat("#c9c8b3"), [.015,y,.151], [.013,.013,.008]);
  const neck = loft(torso, skin, [[.65,.065,.065],[.77,.07,.07],[.81,.075,.075]]);
  const head = new THREE.Group(); head.position.set(0,.80,0); torso.add(head);
  loft(head, skin, [[-.018,.018,.035,.018],[.005,.075,.085,.015],[.05,.116,.107,.009],[.12,.146,.125,0],[.22,.155,.132,-.006],[.30,.145,.123,-.01],[.36,.111,.095,-.012],[.385,.025,.025,-.012],[.388,.002,.002,-.012]]);
  for (const x of [-.151,.151]) ellipsoid(head, skin, [x,.17,-.002], [.028,.052,.031]);
  // Hair cap follows the skull, with thick swept locks rather than card hair.
  // Higher front hairline keeps eyes clear; lower sides/back overlap the side locks.
  const capGeometry = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI*2, 0, Math.PI);
  const capPositions = capGeometry.getAttribute("position");
  for (let i = 0; i < capPositions.count; i++) {
    const phi = Math.atan2(capPositions.getZ(i), -capPositions.getX(i));
    const theta = Math.acos(THREE.MathUtils.clamp(capPositions.getY(i), -1, 1)) * (.50 - .10 * Math.sin(phi));
    capPositions.setXYZ(i, -Math.cos(phi)*Math.sin(theta), Math.cos(theta), Math.sin(phi)*Math.sin(theta));
  }
  capGeometry.computeVertexNormals();
  const cap = add(capGeometry, hair, head); cap.position.set(0,.215,-.012); cap.scale.set(.174,.215,.154);
  ellipsoid(head, hair, [-.14,.214,-.033], [.026,.092,.105]);
  ellipsoid(head, hair, [.14,.22,-.038], [.023,.085,.096]);
  for (let i=0;i<4;i++) {
    const lock = ellipsoid(head, i === 0 ? hairLight : hair, [-.065+i*.036,.315-i*.012,.087], [.081,.043,.05]); lock.rotation.z = -.23;
  }
  stroke(head, hairLight, [[-.115,.32,.09],[-.06,.365,.09],[.025,.36,.075],[.09,.323,.073]], .006);
  // Small recessed-looking graphic eyes; gaze inherits the head transform.
  const eyes = [];
  for (const side of [-1,1]) {
    const eye = new THREE.Group(); eye.position.set(side*.063,.205,.119); head.add(eye);
    ellipsoid(eye, shirt, [0,0,0], [.035,.017,.010]);
    ellipsoid(eye, ink, [side*.002,0,.009], [.012,.014,.006]);
    ellipsoid(eye, shirt, [-.003,.005,.014], [.0035,.0035,.002]);
    stroke(head, hair, [[side*.033,.245,.120],[side*.06,.255,.121],[side*.094,.249,.104]], .007);
    eyes.push(eye);
    ellipsoid(head, blush, [side*.10,.136,.100], [.026,.013,.006]);
  }
  ellipsoid(head, skin, [0,.164,.131], [.023,.036,.025]);
  stroke(head, lip, [[-.036,.086,.111],[0,.080,.121],[.036,.088,.111]], .0045);
  // Custom tapered sleeve surfaces + analytic elbows, joined under cloth, not ball joints.
  const arms = [];
  for (const side of [-1,1]) {
    const sleeveGeometry = new THREE.BufferGeometry();
    const sleeve = add(sleeveGeometry, jacket); const foreGeometry = new THREE.BufferGeometry();
    const forearm = add(foreGeometry, skin);
    const hand = new THREE.Group(); scene.add(hand);
    ellipsoid(hand, skin, [0,0,0], [.055,.075,.025]);
    for (let i=0;i<4;i++) {
      const finger = ellipsoid(hand, skin, [(i-1.5)*.023,.078+(i===0||i===3?-.007:0),.004], [.011,.048-(i===3?.008:0),.012]); finger.rotation.x = -.16;
    }
    const thumb = ellipsoid(hand, skin, [side*.052,.016,.014], [.019,.044,.018]); thumb.rotation.z = -side*.65;
    const chalk = box(hand, shirt, [0,.115,.015], [.011,.09,.012]); chalk.visible = false;
    arms.push({ side, sleeve, sleeveGeometry, forearm, foreGeometry, hand, chalk });
  }
  const tube = (geometry, points, r0, r1) => {
    const curve = new THREE.CatmullRomCurve3(points); const frames = curve.computeFrenetFrames(16, false);
    const pos=[], idx=[];
    for(let j=0;j<=16;j++) { const c=curve.getPointAt(j/16), r=r0+(r1-r0)*j/16; for(let i=0;i<=12;i++) {
      const a=i/12*Math.PI*2; const v=c.clone().addScaledVector(frames.normals[j],Math.cos(a)*r).addScaledVector(frames.binormals[j],Math.sin(a)*r*.92); pos.push(v.x,v.y,v.z);
    }}
    for(let j=0;j<16;j++)for(let i=0;i<12;i++){const a=j*13+i;idx.push(a,a+1,a+13,a+13,a+1,a+14);}
    if (!geometry.getAttribute("position")) { geometry.setAttribute("position",new THREE.Float32BufferAttribute(pos,3)); geometry.setIndex(idx); }
    else { geometry.getAttribute("position").array.set(pos); geometry.getAttribute("position").needsUpdate=true; }
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  };
  // Small lectern leaves face and gestures free; paper sits above its solid top.
  const wood = mat("#b98b60"), edge = mat("#cfab7c");
  box(scene, wood, [-.53,.57,.60], [.85,1.02,.32]);
  box(scene, edge, [-.53,1.10,.60], [1.04,.07,.50]);
  box(scene, mat("#f7f0df"), [-.48,1.143,.60], [.37,.008,.25]);
  for(let i=0;i<5;i++) box(scene, mat("#c1c6bd"), [-.48,1.149,.52+i*.031], [.27,.002,.002]);
  for (let i=0;i<7;i++) box(scene, edge, [-.88+i*.115,.58,.765], [.018,.76,.012]);
  // Soft ground contact is procedural, no shadow map or external texture.
  const shadowCanvas=document.createElement("canvas"); shadowCanvas.width=128;shadowCanvas.height=128;
  const sc=shadowCanvas.getContext("2d"), grad=sc.createRadialGradient(64,64,3,64,64,64);grad.addColorStop(0,"rgba(42,55,50,.23)");grad.addColorStop(1,"rgba(42,55,50,0)");sc.fillStyle=grad;sc.fillRect(0,0,128,128);
  const shadowTexture=new THREE.CanvasTexture(shadowCanvas);textures.add(shadowTexture);
  const shadowMat=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false});materials.add(shadowMat);
  const shadow=add(new THREE.PlaneGeometry(1.6,.8),shadowMat);shadow.rotation.x=-Math.PI/2;shadow.position.set(-.42,.006,.06);
  let disposed=false, latestTime=0, width=0,height=0, frames=0, renderMs=0, lastState=null;
  const v = a => new THREE.Vector3(...a);
  function resize() {
    const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight); if(w===width&&h===height)return;
    width=w;height=h;renderer.setSize(w,h,false);camera.aspect=w/h;
    // Same legible waist-up composition at portrait/landscape stage ratios.
    camera.position.set(.05,1.92,5.9);camera.lookAt(.04,1.65,0);
    const vertical=1.85, horizontal=1.85; const distance=Math.max(vertical,horizontal/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));
    camera.position.z=distance;camera.lookAt(.04,1.65,0);camera.updateProjectionMatrix();
  }
  function setTime(t) {
    if(disposed)return;latestTime=t;
    const s=presenterAt(t); lastState=s;
    torso.rotation.set(0,s.yaw,s.lean);torso.position.x=s.sway;torso.scale.set(1+s.breath*.3,1+s.breath*.4,1+s.breath);
    head.rotation.set(s.headPitch,s.headYaw,-s.read*.045);eyes.forEach(e=>e.scale.y=Math.max(.07,1-s.blink));
    root.updateMatrixWorld(true);
    const data=[];
    for(const a of arms){
      const side=a.side;const shoulder=torso.localToWorld(new THREE.Vector3(side*.269,.565,0));
      // Rest and speaking hands are outside torso and above the lectern; no straight T pose.
      const local=new THREE.Vector3(side*(.32+s.gesture*.12),.43+s.gesture*.18+s.hesitationHand*.10,.31+s.gesture*.10);
      local.x+=(side===1?-.07: .04)*s.read;local.y-=s.read*.11;local.z+=s.read*.13;
      const target=torso.localToWorld(local);
      if(side===1){const writing=new THREE.Vector3(-.08+.05*Math.sin(t*2.1),1.94+.03*s.writingStroke,-.53);target.lerp(writing,s.write);}
      const pole=torso.localToWorld(new THREE.Vector3(side*.63,.15,.20));
      const solved=solveArm(shoulder.toArray(),target.toArray(),pole.toArray());
      const sh=v(solved.shoulder),el=v(solved.elbow),wr=v(solved.wrist);
      const cuff=el.clone().lerp(wr,.60);
      tube(a.sleeveGeometry,[sh,sh.clone().lerp(el,.5).add(new THREE.Vector3(0,.012,0)),el,cuff],.107,.059);
      tube(a.foreGeometry,[cuff,wr],.053,.039);
      a.hand.position.copy(wr);const direction=wr.clone().sub(el).normalize();
      a.hand.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
      a.hand.rotateY(side*.25*(1-s.write));a.chalk.visible=side===1&&s.write>.5;
      data.push({side,...solved});
    }
    paintBoard(s.writingProgress);resize();
    if(!document.hidden){const before=performance.now();renderer.render(scene,camera);renderMs+=performance.now()-before;frames++;}
    canvas.dataset.time=String(s.t);canvas.dataset.phase=s.phase.label;
    canvas.dataset.rig=JSON.stringify(data); // diagnostic world coordinates, not a fake 2D overlay
  }
  const observer=new ResizeObserver(()=>setTime(latestTime));observer.observe(host);
  const onLost=e=>{e.preventDefault();dispose();host.dispatchEvent(new Event("presenterfailed"));};canvas.addEventListener("webglcontextlost",onLost);
  function dispose(){
    if(disposed)return;disposed=true;observer.disconnect();canvas.removeEventListener("webglcontextlost",onLost);
    const geometries=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
    renderer.dispose();renderer.forceContextLoss();canvas.remove();
  }
  onCleanup(dispose);
  setTime(0);
  const mountMs = performance.now() - started;
  return {setTime,dispose,diagnostics:()=>({disposed,frames,meanRenderSubmissionMs:frames?renderMs/frames:0,mountMs,pixelRatio:renderer.getPixelRatio(),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,time:latestTime,sample:lastState})};
}

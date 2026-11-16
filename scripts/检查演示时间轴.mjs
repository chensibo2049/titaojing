#!/usr/bin/env node
/** 纯 Node 回归：绝对时间/seek、IK 骨长与轻量 controller；不加载 Three、不启动浏览器。 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function checkDemoTimeline(check) {
  const test = async (name, run) => {
    try { await run(); check(name, true); }
    catch (error) { check(name, false, error.message); }
  };
  let mod;
  try {
    const bundle = await esbuild.build({
      absWorkingDir: root,
      stdin: { contents: 'export * from "./src/demo-rig.js"; export * from "./src/demo-motion.js"; export * from "./src/demo-view.js";', resolveDir: root, sourcefile: "demo-timeline-test.js" },
      bundle: true, write: false, metafile: true, format: "esm", platform: "node", logLevel: "silent",
    });
    assert(!Object.keys(bundle.metafile.inputs).some((name) => /node_modules\/three\//.test(name)), "纯时间轴/controller 测试不得加载 Three");
    mod = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  } catch (error) {
    check("演示纯逻辑可独立加载（无 Three/DOM 执行）", false, error.message);
    return;
  }
  const { DEMO_PHASES, presenterAt, demoMotionAt, solveArm, createDemoView, preferDemo2D } = mod;
  await test("演示阶段连续覆盖 0–55 秒，边界按绝对时间切换", () => {
    const phases = [[0, 2, "准备开场"], [2, 9, "开场问好"], [9, 17, "低头找稿"], [17, 26, "卡顿与犹豫"], [26, 30, "重新组织"], [30, 44, "转身板书"], [44, 55, "回看学生"]];
    assert.deepEqual(DEMO_PHASES.map(({ start, end, label }) => [start, end, label]), phases);
    for (const [start, end, label] of phases) {
      for (const t of [start, (start + end) / 2, end - 1e-6]) assert.equal(presenterAt(t).phase.label, label, `t=${t}`);
    }
    assert.equal(presenterAt(55).phase.label, "回看学生");
  });
  await test("演示时间钳制与所有动作通道有限，不依赖墙钟或随机数", () => {
    for (const sample of [presenterAt, demoMotionAt]) {
      for (const t of [NaN, Infinity, -Infinity, undefined, -10]) assert.equal(sample(t).t, 0);
      assert.equal(sample(100).t, 55);
    }
    const originalNow = Date.now, originalRandom = Math.random;
    try {
      Date.now = Math.random = () => { throw new Error("纯时间轴不可读取墙钟/随机数"); };
      for (let i = 0; i <= 550; i++) {
        const s = presenterAt(i / 10);
        for (const [key, value] of Object.entries(s)) if (key !== "phase") assert(Number.isFinite(value), `${key}@${s.t}`);
        for (const key of ["read", "board", "write", "blink", "writingProgress"]) assert(s[key] >= 0 && s[key] <= 1, `${key}@${s.t}`);
        assert.equal(demoMotionAt(i / 10).t, s.t);
      }
    } finally { Date.now = originalNow; Math.random = originalRandom; }
  });
  await test("低头/犹豫/板书/回看有对应动作，板书进度随绝对时间恢复", () => {
    assert(presenterAt(12).read > .99 && presenterAt(12).headPitch > .4);
    assert(Math.abs(presenterAt(20).sway) > .01);
    assert(presenterAt(36).board > .99 && presenterAt(36).write > .99 && presenterAt(36).yaw > 1);
    assert.equal(presenterAt(33).writingProgress, 0);
    assert.equal(presenterAt(42).writingProgress, 1);
    assert.equal(presenterAt(48).board, 0);
    assert.equal(presenterAt(48).read, 0);
  });
  await test("正播/倒播/跨段 seek 在相同绝对时间完全确定，motion 与 rig 同步", () => {
    const times = [0, 2, 4.47, 9, 12.5, 17, 20, 26, 30, 33, 36, 42, 44, 48, 55];
    const snapshots = new Map(times.map((t) => [t, structuredClone({ rig: presenterAt(t), motion: demoMotionAt(t) })]));
    for (const t of [...times, ...[...times].reverse(), 36, 0, 55, 12.5, 33, 2]) {
      assert.deepEqual({ rig: presenterAt(t), motion: demoMotionAt(t) }, snapshots.get(t), `seek=${t}`);
      assert.deepEqual(demoMotionAt(t).presenter, presenterAt(t), `motion/rig=${t}`);
    }
  });
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  const verifyArm = (shoulder, target, pole, upper = .38, lower = .36) => {
    const originals = structuredClone([shoulder, target, pole]);
    const arm = solveArm(shoulder, target, pole, upper, lower);
    for (const joint of [arm.shoulder, arm.elbow, arm.wrist]) assert(joint.every(Number.isFinite), "关节必须有限");
    assert(Math.abs(distance(arm.shoulder, arm.elbow) - upper) < 1e-8, `上臂长度 ${distance(arm.shoulder, arm.elbow)} != ${upper}`);
    assert(Math.abs(distance(arm.elbow, arm.wrist) - lower) < 1e-8, `前臂长度 ${distance(arm.elbow, arm.wrist)} != ${lower}`);
    assert.deepEqual([shoulder, target, pole], originals, "IK 不得修改输入");
    assert.deepEqual(solveArm(shoulder, target, pole, upper, lower), arm);
    return arm;
  };
  await test("IK 常规/过远/过近目标与自定义骨长保持两段长度", () => {
    for (const side of [-1, 1]) for (let i = 0; i <= 55; i++) {
      const s = presenterAt(i);
      verifyArm([side * .269, 1.435, 0], [side * (.32 + s.gesture * .12), 1.3 + s.gesture * .18 - s.read * .11, .31 + s.read * .13], [side * .63, 1.02, .2]);
    }
    assert.equal(verifyArm([0, 0, 0], [3, 2, 1], [0, 1, 0]).reachClamped, true);
    verifyArm([0, 0, 0], [.001, 0, 0], [0, 1, 0]);
    verifyArm([1, 2, 3], [1.4, 2.2, 3.1], [1, 3, 3], .6, .45);
  });
  await test("IK 目标与肩重合时仍保持骨长且输出有限", () => {
    verifyArm([0, 0, 0], [0, 0, 0], [0, 1, 0]);
  });
  await test("IK pole 与目标方向共线时仍保持骨长", () => {
    verifyArm([0, 0, 0], [.4, 0, 0], [1, 0, 0]);
    verifyArm([0, 0, 0], [0, 0, .4], [0, 0, 1]);
  });

  // 只模拟 controller 使用的 DOM 接口；不引入浏览器或第三方 DOM 库。
  class Element extends EventTarget {
    children = []; parent = null; className = "";
    append(child) { child.remove(); this.children.push(child); child.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  }
  const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  const renderer = () => ({ times: [], disposed: 0, setTime(t) { this.times.push(t); }, dispose() { this.disposed++; }, diagnostics() { return { time: this.times.at(-1) }; } });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => new Element() } });
  const views = [];
  const view = (options) => { const result = createDemoView({ lowPower: () => false, ...options }); views.push(result); return result; };
  try {
    await test("controller 构造不加载，mount 后共享最新绝对时间，dispose 释放一次", async () => {
      let loads = 0, mounts = 0, ready = 0;
      const pending = deferred(), instance = renderer(), stage = new Element();
      const controller = view({ load: () => { loads++; return pending.promise; }, onReady: () => ready++ });
      assert.equal(loads, 0); assert.equal(controller.status().state, "off");
      controller.setTime(12);
      const mounting = controller.mount(stage);
      assert.equal(loads, 1); assert.equal(controller.status().state, "loading"); assert.equal(stage.children.length, 1);
      controller.setTime(36);
      pending.resolve({ mountDemoPresenter: () => { mounts++; return instance; } });
      await mounting;
      assert.equal(mounts, 1); assert.equal(ready, 1); assert.equal(controller.status().state, "ready");
      assert.deepEqual(instance.times, [36]);
      controller.setTime(9); assert.deepEqual(instance.times, [36, 9]);
      controller.dispose(); controller.dispose(); controller.setTime(55);
      assert.equal(instance.disposed, 1); assert.equal(stage.children.length, 0); assert.equal(controller.status().state, "off");
      assert.deepEqual(instance.times, [36, 9]);
    });
    await test("低性能/显式 2D 路径不加载 Three，也不创建 host", async () => {
      assert(preferDemo2D({ navigator: { deviceMemory: 2 } }));
      assert(preferDemo2D({ navigator: { hardwareConcurrency: 2 } }));
      assert(preferDemo2D({ location: { search: "?demoRenderer=2d" } }));
      assert(!preferDemo2D({ navigator: { deviceMemory: 8, hardwareConcurrency: 8 } }));
      let loads = 0, ready = 0;
      const controller = view({ lowPower: () => true, load: () => { loads++; throw new Error("不应加载"); }, onReady: () => ready++ });
      const stage = new Element(); await controller.mount(stage);
      assert.equal(loads, 0); assert.equal(ready, 1); assert.equal(stage.children.length, 0); assert.equal(controller.status().state, "fallback");
    });
    await test("controller 加载拒绝/renderer 初始化异常回退 2D，清理 host 且可重试", async () => {
      for (const factoryFailure of [false, true]) {
        let ready = 0, fail = true;
        const instance = renderer(), stage = new Element();
        const controller = view({ load: async () => {
          if (fail && !factoryFailure) throw new Error("下载失败");
          return { mountDemoPresenter: () => { if (fail) throw new Error("WebGL 不可用"); return instance; } };
        }, onReady: () => ready++ });
        await controller.mount(stage);
        assert.equal(controller.status().state, "fallback"); assert.match(controller.status().error, /下载失败|WebGL 不可用/);
        assert.equal(stage.children.length, 0); assert.equal(ready, 1);
        fail = false; controller.setTime(24); await controller.mount(stage);
        assert.equal(controller.status().state, "ready"); assert.deepEqual(instance.times, [24]); assert.equal(ready, 2);
        controller.dispose(); assert.equal(instance.disposed, 1);
      }
    });
    await test("controller 加载中 dispose，迟到成功/失败不得挂载或复活状态", async () => {
      for (const reject of [false, true]) {
        const pending = deferred(), stage = new Element(); let mounts = 0, ready = 0;
        const controller = view({ load: () => pending.promise, onReady: () => ready++ });
        const mounting = controller.mount(stage); controller.dispose();
        if (reject) pending.reject(new Error("迟到失败"));
        else pending.resolve({ mountDemoPresenter: () => { mounts++; return renderer(); } });
        await mounting;
        assert.equal(mounts, 0); assert.equal(ready, 0); assert.equal(controller.status().state, "off"); assert.equal(stage.children.length, 0);
      }
    });
    await test("controller 重入 mount 竞态只允许最新请求接管，旧请求成功/失败均忽略", async () => {
      for (const reject of [false, true]) {
        const old = deferred(), latest = deferred(), stage = new Element(), instance = renderer(); let loads = 0, oldMounts = 0, ready = 0;
        const controller = view({ load: () => loads++ ? latest.promise : old.promise, onReady: () => ready++ });
        const first = controller.mount(stage), second = controller.mount(stage);
        controller.setTime(42);
        latest.resolve({ mountDemoPresenter: () => instance }); await second;
        if (reject) old.reject(new Error("旧请求失败"));
        else old.resolve({ mountDemoPresenter: () => { oldMounts++; return renderer(); } });
        await first;
        assert.equal(oldMounts, 0); assert.equal(ready, 1); assert.equal(stage.children.length, 1);
        assert.equal(controller.status().state, "ready"); assert.deepEqual(instance.times, [42]); assert.equal(instance.disposed, 0);
        controller.dispose(); assert.equal(instance.disposed, 1);
      }
    });
    await test("renderer 同步挂载期间触发 dispose，迟到 instance 必须释放", async () => {
      const instance = renderer(), stage = new Element(); let ready = 0, controller;
      controller = view({ load: async () => ({ mountDemoPresenter: () => { controller.dispose(); return instance; } }), onReady: () => ready++ });
      await controller.mount(stage);
      assert.equal(instance.disposed, 1); assert.deepEqual(instance.times, []); assert.equal(ready, 0);
      assert.equal(controller.status().state, "off"); assert.equal(stage.children.length, 0);
    });
    await test("controller WebGL 丢失事件回退并释放，dispose 后移除失败监听", async () => {
      const instance = renderer(), stage = new Element(); let ready = 0;
      const controller = view({ load: async () => ({ mountDemoPresenter: () => instance }), onReady: () => ready++ });
      await controller.mount(stage); const host = stage.children[0];
      host.dispatchEvent(new Event("presenterfailed"));
      assert.equal(controller.status().state, "fallback"); assert.match(controller.status().error, /WebGL/);
      assert.equal(instance.disposed, 1); assert.equal(stage.children.length, 0); assert.equal(ready, 2);
      controller.dispose(); host.dispatchEvent(new Event("presenterfailed"));
      assert.equal(controller.status().state, "off"); assert.equal(ready, 2); assert.equal(instance.disposed, 1);
    });
  } finally {
    for (const controller of views) controller.dispose();
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else delete globalThis.document;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let failed = 0;
  await checkDemoTimeline((name, ok, detail = "") => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  });
  console.log(failed ? `\n演示时间轴 ${failed} 项失败` : "\n演示时间轴检查全部通过");
  process.exitCode = failed ? 1 : 0;
}

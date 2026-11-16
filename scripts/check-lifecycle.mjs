import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Source functions run in isolated VMs, with synthetic data only. No browser,
// network, real media, storage, model downloads, or wall-clock timers are used.
const src = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const sources = Object.fromEntries(['main.js', 'speech.js', 'asr-sherpa.js', 'asr-server-ui.js', 'constants.js'].map(name => [name, src(name)]));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
async function settled(promise) {
  let done = false, value, error;
  Promise.resolve(promise).then(v => { done = true; value = v; }, e => { done = true; error = e; });
  await drain();
  assert.ok(done, 'Promise did not settle after controlled events (no real-time waiting)');
  if (error) throw error;
  return value;
}
async function rejected(promise, pattern) {
  let error;
  try { await settled(promise); } catch (e) { error = e; }
  assert.ok(error, 'Expected rejection, not successful completion');
  assert.match(error.message, pattern);
}
function clock() {
  let now = 10000, nextId = 1;
  const jobs = new Map();
  const add = (fn, delay, interval) => {
    const id = nextId++;
    jobs.set(id, { fn, at: now + Math.max(1, Number(delay) || 0), interval });
    return id;
  };
  return {
    performance: { now: () => now },
    setTimeout: (fn, ms) => add(fn, ms, 0), clearTimeout: id => jobs.delete(id),
    setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms)), clearInterval: id => jobs.delete(id),
    async tick(ms) {
      const end = now + ms;
      let turns = 0;
      while (true) {
        const due = [...jobs].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        assert.ok(++turns < 10000, 'Virtual clock runaway');
        const [id, job] = due;
        now = job.at;
        if (job.interval) job.at += job.interval; else jobs.delete(id);
        job.fn();
        await drain();
      }
      now = end;
      await drain();
    },
    size: () => jobs.size,
    clear: () => jobs.clear(),
  };
}
function element() {
  const listeners = new Map(), children = new Map();
  let value = '';
  const el = {
    hidden: false, disabled: false, checked: false, textContent: '', innerHTML: '', dataset: {}, files: [],
    width: 320, height: 180, videoWidth: 320, videoHeight: 180,
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    emit(type, event = {}) { return (listeners.get(type) || []).map(fn => fn(event)); },
    querySelector(selector) { if (!children.has(selector)) children.set(selector, element()); return children.get(selector); },
    pause() {}, load() {}, removeAttribute() {},
  };
  Object.defineProperty(el, 'value', { get: () => value, set: v => { value = v; if (v === '') el.files = []; } });
  return el;
}
function sandbox(bindings = {}) {
  const timers = clock();
  const context = vm.createContext({ console, Blob, AbortController, ...timers, ...bindings });
  const run = (code, filename = 'lifecycle-harness.js') => vm.runInContext(code, context, { filename, timeout: 1000 });
  return { timers, context, run };
}
// Import/export syntax alone is removed. Function bodies are never rewritten.
const scriptModule = text => text.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function loadModule(name, bindings, exports) {
  const box = sandbox(bindings);
  box.run(scriptModule(sources[name]), fileURLToPath(new URL(`../src/${name}`, import.meta.url)));
  return { ...box, api: box.run(`({${exports.join(',')}})`) };
}
function mainFunction(name) {
  const lines = sources['main.js'].split('\n');
  const start = lines.findIndex(line => line.startsWith(`function ${name}(`) || line.startsWith(`async function ${name}(`));
  assert.ok(start >= 0, `Missing source function: ${name}`);
  const end = lines.findIndex((line, i) => i > start && line === '}');
  assert.ok(end > start, `Missing top-level function end: ${name}`);
  const text = lines.slice(start, end + 1).join('\n');
  new vm.Script(text); // Extraction must produce an executable function, not text assertions.
  return text;
}
function mainHarness() {
  const elements = new Map(), attachments = [], recognizers = [], recordings = [], saves = [], queued = [], hashes = [], replays = [], banners = [], loops = [];
  let created = 0, releases = 0, screenshots = 0, saveDeferred = null, visionDeferred = null;
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const settings = { boardSide: 'right', sens: { filler: 'mid' }, mirror: true, frameMode: 'half', sessionMode: 'practice', fillers: ['然后'], asrEngine: 'webspeech', speechLang: 'zh-CN', classroomSim: 'off', stemRequirement: '' };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; recordings.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    data(text) { this.ondataavailable?.({ data: new Blob([text], { type: 'video/webm' }) }); }
    end() { this.onstop?.(); }
  }
  const box = sandbox({
    $, window: { MediaRecorder: Recorder }, MediaRecorder: Recorder,
    location: { hash: '#/try' }, history: { replaceState(a, b, hash) { hashes.push(hash); } },
    document: { querySelectorAll: () => [] },
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
    createReplayClock: () => ({}), timing: () => ({ suggested: 120, minStop: 15, max: 180 }),
    getSettings: () => settings, saveSettings() {}, setRuntime() {},
    createSession: kind => ({ name: `S${++created}`, kind, duration: 12, frames: [], events: [], transcripts: [], thumb: 'synthetic', speechAvailable: true }),
    getLicense: () => ({ features: { saveVideo: true } }), showScreen() {}, applyMirror() {}, fmt: String,
    cancelAnimationFrame() {}, cancelLocalImport() {}, releaseLocalReplay() {}, keepAwake() {},
    demoView: { dispose() {} }, STAGE_W: 320, STAGE_H: 180,
    bakeDemoSession: () => ({ kind: 'demo', frames: [], events: [] }),
    paintDemoFrame() {}, mountDemoView() {}, loopDemo: () => loops.push(box.run('session')),
    stopClassroomSim() {}, startClassroomSim: async () => {}, isSimActive: () => false, summarizeClassroomSim: () => ({}),
    attachVideo() { const d = deferred(); attachments.push(d); return d.promise; },
    videoAspectOf: () => 16 / 9, fitStage() {},
    visionStatus: () => visionDeferred ? {} : ({ pose: true }), initVision: () => visionDeferred.promise,
    banner: (...args) => banners.push(args), speechSupported: () => true,
    currentProfileName: async () => '', debugSessionStart() {}, debugSessionEnd() {}, debugEnabled: () => false,
    startAsr(options) { const stop = deferred(); const h = { options, stopDeferred: stop, engine: 'webspeech', stop: () => stop.promise }; recognizers.push(h); return h; },
    addFiller: (sess, t, word) => sess.events.push({ t, word }),
    addTranscript: (sess, t, text, final) => sess.transcripts.push({ t, text, final }),
    flashFiller() {}, debugSpeech() {}, feedClassroomSim() {}, setAsrStatusLabel() {},
    asrStatus: () => ({ sherpa: false, sherpaSupported: false }),
    loopCamera: () => loops.push(box.run('session')),
    makeThumb: () => 'synthetic', drawVideoInto: () => () => {},
    diagnose: sess => { sess.diagnosis = { counts: {} }; }, setLastSessionStats() {},
    releaseStream: () => { releases++; },
    openReplay: sess => { replays.push(sess); box.context.replaySession = sess; box.run('session = replaySession; mode = "replay"'); },
    renderSaveStatus: st => { box.context.renderedStatus = st; },
    toRecord: sess => ({ id: `saved-${sess.name}`, hasVideo: false }),
    putSession(rec, blob) { saves.push({ rec, blob }); return saveDeferred ? saveDeferred.promise : Promise.resolve(); },
    requestPersist() {}, logEvent() {}, experienceOn: () => true,
    stillCanvas: () => { screenshots++; return { width: 320, toDataURL: () => 'synthetic-screenshot' }; },
    maybeEnqueue: async (sess, options) => { queued.push({ sess, options }); },
  });
  const text = sources['main.js'];
  box.run(text.slice(text.indexOf('let mode ='), text.indexOf('\nfunction applyPendingUpdate')));
  const names = ['applyPendingUpdate', 'clearDemoView', 'stopEverything', 'startDemo', 'countdownSeconds', 'runCountdown', 'startCameraLive', 'pickMime', 'startRecording', 'finishCamera', 'saveToHistory', 'enqueueIfConsented', 'setHashSilently'];
  box.run(`let coverRaf = 0; let lastSaveStatus = null;\n${names.map(mainFunction).join('\n')}`);
  box.run('mode = "coach"; micOn = true; mediaStream = {};');
  const api = box.run(`({${names.join(',')}})`);
  return {
    ...box, api, $, attachments, recognizers, recordings, saves, queued, hashes, replays, banners, loops,
    get: code => box.run(code),
    switchAway() { api.stopEverything(); box.run('mode = "coach"; mediaStream = {};'); },
    deferSave() { saveDeferred = deferred(); return saveDeferred; },
    deferVision() { visionDeferred = deferred(); return visionDeferred; },
    readyVision() { visionDeferred = null; },
    counts: () => ({ releases, screenshots }),
    async start() {
      const pending = api.startCameraLive();
      attachments.at(-1).resolve(); await drain();
      await box.timers.tick(3280);
      await settled(pending);
      return box.run('session');
    },
  };
}
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('A finishing while B starts: recorder/transcript/finalization stay with A', async () => {
  const h = mainHarness();
  const a = await h.start(), aRec = h.recordings[0], aSpeech = h.recognizers[0];
  aRec.data('A-first');
  const aChunks = h.get('chunks');
  const finishing = h.api.finishCamera();
  await drain();
  h.switchAway();
  const startingB = h.api.startCameraLive(), b = h.get('session');
  h.attachments[1].resolve(); await drain();
  assert.notEqual(a, b);
  // Deliver A's tail while B owns the UI, but before A's 3s deadline.
  aSpeech.options.onTranscript({ text: 'synthetic A final', final: true });
  aSpeech.options.onFiller('然后');
  aSpeech.options.onStatus({ ok: false, engine: 'webspeech', message: 'synthetic A error' });
  aRec.data('A-final'); aRec.end(); aSpeech.stopDeferred.resolve();
  await settled(finishing);
  await h.timers.tick(3280); await settled(startingB);
  const bRec = h.recordings[1];
  assert.equal(h.get('session'), b);
  assert.equal(h.get('mode'), 'camera');
  assert.equal(h.get('recorder'), bRec);
  assert.equal(h.get('speechHandle'), h.recognizers[1]);
  assert.equal(a.transcripts.at(-1).text, 'synthetic A final');
  assert.equal(b.transcripts.length, 0);
  assert.equal(b.events.length, 0);
  assert.equal(b.speechError, '');
  assert.equal(a.videoBlob.size, 'A-firstA-final'.length);
  assert.equal(b.videoBlob, undefined);
  assert.equal(h.counts().releases, 1); // Only explicit switchAway releases resources.
  assert.equal(h.replays.length, 0);
  assert.deepEqual(h.hashes, []);
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0].rec.id, `saved-${a.name}`);
  assert.equal(h.queued.length, 1);
  assert.equal(h.queued[0].sess, a);
  assert.equal(h.queued[0].options.screenshots.length, 0);
  assert.equal(h.get('pendingSaves'), 0);
  const size = a.videoBlob.size, transcripts = a.transcripts.length, chunkCount = aChunks.length;
  aRec.data('too late'); aSpeech.options.onTranscript({ text: 'too late', final: true });
  assert.equal(a.videoBlob.size, size);
  assert.equal(aChunks.length, chunkCount);
  assert.equal(a.transcripts.length, transcripts);
});

for (const stage of ['attach', 'vision', 'countdown']) {
  test(`Stale ${stage} continuation cannot start B a second time`, async () => {
    const h = mainHarness();
    const oldVision = stage === 'vision' ? h.deferVision() : null;
    const oldStart = h.api.startCameraLive();
    const oldAttach = h.attachments[0];
    if (stage !== 'attach') { oldAttach.resolve(); await drain(); }
    if (stage === 'countdown') await h.timers.tick(1000);
    h.switchAway();
    h.readyVision();
    const b = await h.start();
    const before = { recordings: h.recordings.length, recognizers: h.recognizers.length, loops: h.loops.length, liveStart: h.get('liveStart'), caption: h.$('hud-caption').textContent };
    if (stage === 'attach') oldAttach.resolve();
    if (oldVision) oldVision.resolve({ pose: true });
    await h.timers.tick(5000);
    await settled(oldStart);
    await settled(h.api.startCameraLive()); // Duplicate start button/caller is also harmless.
    assert.equal(h.get('session'), b);
    assert.equal(h.recordings.length, 1);
    assert.equal(h.recognizers.length, 1);
    assert.equal(h.loops.length, 1);
    assert.deepEqual({ recordings: h.recordings.length, recognizers: h.recognizers.length, loops: h.loops.length, liveStart: h.get('liveStart'), caption: h.$('hud-caption').textContent }, before);
    assert.equal(h.loops[0], b);
  });
}

for (const offset of [700, 1400]) {
  test(`Stale demo countdown at ${offset}ms cannot restart B or alter its caption`, async () => {
    const h = mainHarness();
    h.api.startDemo();
    const a = h.get('session');
    await h.timers.tick(offset); // Include the delayed 280ms final-caption callback.
    h.api.startDemo();
    const b = h.get('session');
    assert.notEqual(a, b);
    await h.timers.tick(1680);
    assert.equal(h.loops.length, 1);
    assert.equal(h.loops[0], b);
    assert.equal(h.get('session'), b);
    assert.equal(h.$('hud-caption').textContent, '开始');
    assert.equal(h.timers.size(), 0);
  });
}

test('A save resolves after B starts: no B route/status/screenshot/enqueue', async () => {
  const h = mainHarness(), a = await h.start(), db = h.deferSave();
  const finishing = h.api.finishCamera();
  await drain(); h.recordings[0].end(); h.recognizers[0].stopDeferred.resolve(); await drain();
  assert.equal(h.saves.length, 1);
  assert.equal(h.replays[0], a);
  assert.deepEqual(h.hashes, ['#/replay']);
  h.switchAway();
  const b = await h.start();
  const releases = h.counts().releases;
  db.resolve(); await settled(finishing);
  assert.equal(h.get('session'), b);
  assert.equal(h.get('mode'), 'camera');
  assert.deepEqual(h.hashes, ['#/replay']);
  assert.equal(h.context.renderedStatus, undefined);
  assert.equal(h.counts().releases, releases);
  assert.equal(h.counts().screenshots, 0);
  assert.equal(h.queued.length, 1);
  assert.equal(h.queued[0].sess, a);
  assert.equal(h.queued[0].options.screenshots.length, 0);
  assert.equal(a.stored, true);
  assert.equal(b.stored, undefined);
});

test('Current A normal completion still opens/saves/routes/enqueues A', async () => {
  const h = mainHarness(), a = await h.start();
  h.recordings[0].data('synthetic');
  const finishing = h.api.finishCamera();
  await drain();
  h.recordings[0].end(); h.recognizers[0].stopDeferred.resolve();
  await settled(finishing);
  assert.equal(h.replays[0], a);
  assert.equal(h.context.renderedStatus.ok, true);
  assert.deepEqual(h.hashes, ['#/replay', `#/session/saved-${a.name}`]);
  assert.equal(h.queued[0].sess, a);
  assert.equal(h.queued[0].options.screenshots.length, 1);
  assert.equal(h.get('pendingSaves'), 0);
});

test('Main finalization has concurrent recorder/speech deadlines and closes late callbacks', async () => {
  const h = mainHarness(), a = await h.start();
  const finishing = h.api.finishCamera();
  await drain(); await h.timers.tick(3000); await settled(finishing);
  assert.equal(a.speechAvailable, false);
  assert.match(a.speechError, /超时/);
  assert.match(a.captureWarnings[0], /录像收尾未完成/);
  assert.equal(a.speechClosed, true);
  const count = a.transcripts.length;
  h.recognizers[0].options.onTranscript({ text: 'late', final: true });
  assert.equal(a.transcripts.length, count);
  h.recognizers[0].stopDeferred.reject(new Error('late rejection'));
  await drain();
  assert.equal(h.get('pendingSaves'), 0);
});

function constants() {
  const box = sandbox();
  box.run(scriptModule(sources['constants.js']));
  return box.run('({DEFAULT_RE: FILLER_RE, buildFillerRe, SINGLE_CHAR_FILLERS})');
}
function speechHarness({ pendingMic = false } = {}) {
  const instances = [], transcripts = [], fillers = [], mic = deferred();
  let probeStopped = 0;
  class Recognition {
    constructor() { instances.push(this); this.stopCount = 0; this.abortCount = 0; }
    start() {}
    stop() { this.stopCount++; }
    abort() { this.abortCount++; }
    text(text) { const result = [{ transcript: text }]; result.isFinal = true; this.onresult({ resultIndex: 0, results: [result] }); }
    end() { this.onend(); }
  }
  const stream = { getTracks: () => [{ stop() { probeStopped++; } }] };
  const box = loadModule('speech.js', {
    ...constants(), window: { SpeechRecognition: Recognition },
    navigator: { mediaDevices: { getUserMedia: () => pendingMic ? mic.promise : Promise.resolve(stream) } },
  }, ['startSpeech']);
  const handle = box.api.startSpeech({ onTranscript: seg => transcripts.push(seg), onFiller: word => fillers.push(word) });
  return { ...box, handle, instances, transcripts, fillers, mic, stream, probeStopped: () => probeStopped };
}

test('Web Speech preserves final text between stop and end, then blocks late results', async () => {
  const h = speechHarness(); await drain();
  assert.equal(h.instances.length, 1);
  const rec = h.instances[0], stop = h.handle.stop();
  assert.equal(h.handle.stop(), stop);
  let done = false; stop.then(() => { done = true; });
  rec.text('然后 synthetic final'); await drain();
  assert.equal(done, false);
  assert.equal(h.transcripts[0].text, '然后 synthetic final');
  assert.equal(h.fillers[0], '然后');
  rec.end(); await settled(stop);
  rec.text('late'); await h.timers.tick(5000);
  assert.equal(h.transcripts.length, 1);
  assert.equal(h.instances.length, 1);
  assert.equal(h.timers.size(), 0);
});

test('Web Speech stop timeout rejects, aborts, blocks late text, and leaves no timers', async () => {
  const h = speechHarness(); await drain();
  const stop = h.handle.stop(25);
  const check = rejected(stop, /收尾超时/);
  // Attach a rejection observer before advancing the controlled deadline.
  await h.timers.tick(25); await check;
  const rec = h.instances[0];
  assert.equal(rec.abortCount, 1);
  rec.text('late'); rec.end(); await h.timers.tick(1000);
  assert.equal(h.transcripts.length, 0);
  assert.equal(h.instances.length, 1);
  assert.equal(h.timers.size(), 0);
});

test('Web Speech stopped during mic permission never starts late recognition', async () => {
  const h = speechHarness({ pendingMic: true });
  await settled(h.handle.stop());
  h.mic.resolve(h.stream); await drain();
  assert.equal(h.instances.length, 0);
  assert.equal(h.probeStopped(), 1);
});

function sherpaHarness() {
  const transcripts = [], messages = [];
  let terminated = 0, closed = 0, tracksStopped = 0;
  const stream = { getAudioTracks: () => [{}], getTracks: () => [{ stop() { tracksStopped++; } }] };
  const worker = { postMessage: message => messages.push(message), terminate: () => { terminated++; } };
  const audio = { ctx: { state: 'running', sampleRate: 16000 }, kind: 'synthetic', pause() {}, connect() {}, close: () => { closed++; } };
  const eng = { worker, audio, ownStream: stream, srcStream: stream, ready: Promise.resolve({ ok: true, initMs: 0 }), queue: [] };
  const box = loadModule('asr-sherpa.js', {
    ...constants(), engineSupported: () => true, location: { search: '' },
    modelCacheRefs: () => { throw new Error('Unexpected real engine creation'); },
    eng,
  }, ['startSherpa']);
  box.run('warm = Promise.resolve(eng)');
  const handle = box.api.startSherpa({ stream, onTranscript: seg => transcripts.push(seg) });
  return { ...box, handle, worker, transcripts, messages, counts: () => ({ terminated, closed, tracksStopped }) };
}

test('Sherpa flush deadline rejects and cleans worker/audio/tracks', async () => {
  const h = sherpaHarness();
  assert.equal((await settled(h.handle.ready)).ok, true);
  const stop = h.handle.stop(25);
  const check = rejected(stop, /收尾超时/);
  await h.timers.tick(25); await check;
  assert.equal(h.messages.at(-1).type, 'flush');
  assert.deepEqual(h.counts(), { terminated: 1, closed: 1, tracksStopped: 1 });
  assert.equal(h.timers.size(), 0);
  await settled(h.handle.stop());
});

test('Sherpa final text before flushed is retained and normal stop resolves', async () => {
  const h = sherpaHarness(); await settled(h.handle.ready);
  const stop = h.handle.stop(25);
  h.worker.onmessage({ data: { type: 'text', text: 'synthetic final', agoSec: 0, durSec: 1 } });
  h.worker.onmessage({ data: { type: 'flushed' } });
  await settled(stop);
  assert.equal(h.transcripts[0].text, 'synthetic final');
  await h.timers.tick(100);
  assert.deepEqual(h.counts(), { terminated: 1, closed: 1, tracksStopped: 1 });
  assert.equal(h.timers.size(), 0);
});

function serverHarness() {
  const root = element(), events = element(), health = deferred(), session = deferred(), result = deferred(), calls = [];
  const location = { hash: '#/settings' };
  let options;
  const box = loadModule('asr-server-ui.js', {
    window: events, location, document: { getElementById: () => element() },
    serverAsrStatus: () => ({ configured: true }),
    probeServerAsr: opts => { calls.push('probe'); options = opts; return health.promise; },
    createServerAsrSession: () => { calls.push('session'); return session.promise; },
    transcribeServerAudio: (file, opts) => { calls.push('transcribe'); options = opts; return result.promise; },
  }, ['mountServerAsr']);
  box.api.mountServerAsr(root);
  const q = selector => root.querySelector(`[data-${selector}]`);
  q('audio').files = [{ name: 'synthetic.audio', type: 'audio/wav', size: 32 }];
  q('audio').value = 'synthetic.audio'; q('code').value = 'synthetic-access-code'; q('consent').checked = true;
  return { ...box, q, events, location, health, session, result, calls, options: () => options,
    click: () => q('start').emit('click')[0],
    clear: event => { if (event === 'hashchange') location.hash = '#/history'; events.emit(event); },
  };
}
function assertPrivateCleared(h) {
  assert.equal(h.q('code').value, '');
  assert.equal(h.q('audio').value, '');
  assert.equal(h.q('audio').files.length, 0);
  assert.equal(h.q('consent').checked, false);
  assert.equal(h.q('result').value, '');
}
for (const event of ['pagehide', 'hashchange']) {
  for (const stage of ['probe', 'session', 'transcribe']) {
    test(`${event} at ${stage}: clears private fields, aborts, and rejects late results`, async () => {
      const h = serverHarness(), pending = h.click();
      if (stage !== 'probe') {
        h.health.resolve({ available: true }); await drain();
        if (stage === 'transcribe') {
          h.session.resolve({ token: 'synthetic-token' }); await drain();
          assert.deepEqual(h.calls, ['probe', 'session', 'transcribe']);
        }
        h.q('code').value = 'synthetic-retyped-code';
      }
      h.q('result').value = 'synthetic old result';
      h.clear(event);
      assertPrivateCleared(h);
      assert.equal(h.options().signal.aborted, true);
      // The transport deliberately ignores AbortSignal to exercise the UI guard.
      if (stage === 'probe') h.health.resolve({ available: true });
      else {
        if (stage === 'session') { h.session.resolve({ token: 'memory-only' }); await drain(); }
        h.result.resolve({ text: 'late synthetic result' });
      }
      await settled(pending);
      assertPrivateCleared(h);
      assert.equal(h.q('start').disabled, false);
      assert.equal(h.q('cancel').disabled, true);
      if (stage === 'probe') assert.deepEqual(h.calls, ['probe']);
    });
  }
}

test('Server ASR positive control: explicit consent can display an in-memory result', async () => {
  const h = serverHarness(), pending = h.click();
  h.health.resolve({ available: true }); await drain();
  h.session.resolve({ token: 'synthetic-token' }); await drain();
  h.result.resolve({ text: 'synthetic successful result' }); await settled(pending);
  assert.equal(h.q('result').value, 'synthetic successful result');
  assert.equal(h.q('code').value, '');
  assert.equal(h.q('consent').checked, false);
});

let failed = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`Lifecycle regression: ${tests.length - failed}/${tests.length} passed. Memory/VM stubs only; not browser validation.`);
if (failed) process.exitCode = 1;

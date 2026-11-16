import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../../src/asr-server.js', import.meta.url), 'utf8');
const client = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
globalThis.location = { href: 'https://openpodium.chensibo.cn/', origin: 'https://openpodium.chensibo.cn' };
globalThis.window = { TITAOJING_CONFIG: {} };
let requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({url, options});
  let result = url.endsWith('/health') ? { status: 'ok', engine: 'server', maxDurationSec: 60, maxBytes: 1920044 }
    : url.endsWith('/session') ? { token: 'test-session-token', expiresIn: 300 }
    : options.method === 'POST' ? { id: 'test-job-123456789' }
      : options.method === 'DELETE' ? { state: 'deleted' }
        : { state: 'succeeded', result: { text: '你好课堂', durationSec: 1, rtf: 0.1 } };
  return { ok: true, json: async () => result };
};
assert.equal(client.serverAsrStatus().available, false);
await assert.rejects(client.transcribeServerAudio(new Blob(['x'], {type:'audio/wav'})), {code:'consent_required'});
for (const endpoint of ['https://other.invalid/api/asr', 'http://openpodium.chensibo.cn/api/asr', 'https://user:pass@openpodium.chensibo.cn/api/asr']) {
  window.TITAOJING_CONFIG.asrServerEndpoint = endpoint;
  assert.equal(client.serverAsrStatus().available, false);
}
assert.equal(requests.length, 0);
window.TITAOJING_CONFIG.asrServerEndpoint = '/api/asr';
assert.equal(client.serverAsrStatus().configured, true);
assert.equal(client.serverAsrStatus().available, false);
assert.equal((await client.probeServerAsr()).available, true);
const goodFetch = globalThis.fetch;
globalThis.fetch = async () => ({ok:true, json:async()=>({status:'ok'})});
assert.equal((await client.probeServerAsr()).available, false);
globalThis.fetch = async () => { throw new Error('offline'); };
assert.equal((await client.probeServerAsr()).available, false);
globalThis.fetch = goodFetch;
assert.equal((await client.probeServerAsr()).available, true);
requests = [];
await assert.rejects(client.transcribeServerAudio(new Blob(['x'], {type:'video/webm'}), {consent:true, sessionToken:'test'}), {code:'audio_required'});
assert.equal(requests.length, 0);
const session = await client.createServerAsrSession('test-only-code');
assert.equal(session.expiresIn, 300);
class AudioContext {
  async decodeAudioData() { return {duration:1, sampleRate:16000, length:16000, numberOfChannels:1, getChannelData:()=>new Float32Array(16000)}; }
  async close() {}
}
globalThis.AudioContext = AudioContext;
const result = await client.transcribeServerAudio(new Blob(['synthetic'], {type:'audio/wav'}), {consent:true, sessionToken:session.token});
assert.equal(result.text, '你好课堂');
assert.equal(requests.at(-1).options.method, 'DELETE');
assert.equal(requests.find(r=>r.url.endsWith('/jobs')).options.body.size, 32044);
const controller = new AbortController(); controller.abort();
await assert.rejects(client.transcribeServerAudio(new Blob(['x'], {type:'audio/wav'}), {consent:true, sessionToken:'test', signal:controller.signal}), {code:'cancelled'});
const now = Date.now;
Date.now = () => now() + 31000;
assert.equal(client.serverAsrStatus().available, false);
Date.now = now;

// Pending polls must be abortable; cleanup uses its own non-aborted signal.
for (const mode of ['timeout', 'cancelled', 'inference_failed', 'network']) {
  requests = [];
  const cancel = new AbortController();
  globalThis.fetch = async (url, options) => {
    requests.push({url, options});
    if (options.method === 'POST') return {ok:true, json:async()=>({id:'test-job-123456789'})};
    if (options.method === 'DELETE') {
      assert.equal(options.signal.aborted, false);
      return {ok:true, json:async()=>({state:'deleted'})};
    }
    if (mode === 'inference_failed') return {ok:true, json:async()=>({state:'failed', error:'inference_failed'})};
    if (mode === 'network') throw new Error('offline');
    if (mode === 'cancelled') queueMicrotask(() => cancel.abort());
    return await new Promise((resolve, reject) => {
      if (options.signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
      else options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once:true});
    });
  };
  await assert.rejects(client.transcribeServerAudio(new Blob(['synthetic'], {type:'audio/wav'}),
    {consent:true, sessionToken:'test', timeoutMs:1000, signal:cancel.signal}), {code:mode});
  assert.equal(requests.at(-1).options.method, 'DELETE');
}
globalThis.fetch = async (url, {signal}) => await new Promise((resolve, reject) => {
  if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
  else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once:true});
});
assert.equal((await client.probeServerAsr()).available, false);
const probeCancel = new AbortController(); probeCancel.abort();
assert.equal((await client.probeServerAsr({signal:probeCancel.signal})).available, false);
globalThis.fetch = goodFetch;
console.log('PASS: safe config; explicit health/expiry/offline/malformed probe; no-consent/no-video/no-request; session; PCM upload; success/timeout/active-cancel/failure/network DELETE; pre-cancellation.');

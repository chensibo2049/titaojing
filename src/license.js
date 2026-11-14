/**
 * 授权 / 激活的隔离层。
 *
 * v1.0 没有后端：版本由 config.js 的 edition 决定，测试码只在本机生效。
 * 以后接入真实授权时，只改这个文件：
 *   1. verifyLicense(code) 改为请求授权后端（config.licenseEndpoint），返回 { ok, edition, expiresAt }；
 *   2. 后端签发的凭证存进 localStorage（或改为服务端会话），启动时用 refreshLicense() 校验。
 * 其余页面只读取 getLicense().features，与授权实现无关。
 */
const KEY = "titaojing.license.v1";

const DEFAULT_EDITIONS = {
  trial: { label: "试用版", maxHistory: 5, saveVideo: true, compare: true, printReport: true, reportWatermark: true },
  pro: { label: "正式版", maxHistory: Infinity, saveVideo: true, compare: true, printReport: true, reportWatermark: false },
};

function cfg() {
  return (typeof window !== "undefined" && window.TITAOJING_CONFIG) || {};
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; }
}

export function getLicense() {
  const c = cfg();
  const editions = { ...DEFAULT_EDITIONS, ...(c.editions || {}) };
  const local = readLocal();
  let edition = c.edition === "pro" ? "pro" : "trial";
  let source = "config";
  if (edition !== "pro" && local && local.edition === "pro") {
    edition = "pro";
    source = local.source || "local";
  }
  const features = { ...DEFAULT_EDITIONS[edition], ...(editions[edition] || {}) };
  if (features.maxHistory == null || features.maxHistory === "Infinity") features.maxHistory = Infinity;
  return { edition, label: features.label, features, source, activatedAt: local?.at || null };
}

/** Stub. Replace with a call to a real licensing backend. */
export async function verifyLicense(code) {
  const c = cfg();
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return { ok: false, message: "请输入激活码。" };
  if (Array.isArray(c.testActivationCodes) && c.testActivationCodes.map((s) => String(s).toUpperCase()).includes(clean)) {
    return { ok: true, edition: "pro", source: "test-code", message: "测试码有效：本机已切换为正式版（仅供内部测试）。" };
  }
  if (c.licenseEndpoint) {
    return { ok: false, message: "在线激活尚未开通。请联系沉思波获取正式版。" };
  }
  return { ok: false, message: "激活码无效，或在线激活尚未开通。" };
}

export async function activate(code) {
  const r = await verifyLicense(code);
  if (r.ok) {
    try { localStorage.setItem(KEY, JSON.stringify({ edition: r.edition, source: r.source, at: Date.now() })); } catch (_) {}
  }
  return r;
}

export function deactivate() {
  try { localStorage.removeItem(KEY); } catch (_) {}
}

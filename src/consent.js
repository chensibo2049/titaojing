/**
 * 首次使用说明与「体验计划」知情同意。
 * 体验计划默认关闭；未勾选时不会入队、更不会发送任何内容。
 */
const KEY = "titaojing.consent.v1";

const DEFAULT = {
  termsAccepted: false,
  termsAcceptedAt: null,
  experience: false,       // 体验计划，默认关
  experienceAt: null,
};

let cache = null;

export function getConsent() {
  if (cache) return cache;
  try { cache = { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) || "null") || {}) }; }
  catch (_) { cache = { ...DEFAULT }; }
  cache.experience = !!cache.experience;
  cache.termsAccepted = !!cache.termsAccepted;
  return cache;
}

export function hasAcceptedTerms() {
  return !!getConsent().termsAccepted;
}

export function experienceOn() {
  const c = getConsent();
  return !!c.termsAccepted && !!c.experience;
}

export function saveConsent(patch) {
  const next = { ...getConsent(), ...patch };
  if (patch.termsAccepted && !getConsent().termsAccepted) next.termsAcceptedAt = new Date().toISOString();
  if (patch.experience === true && !getConsent().experience) next.experienceAt = new Date().toISOString();
  if (patch.experience === false) next.experienceAt = next.experienceAt || null;
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (_) {}
  return next;
}

export function acceptTerms({ experience = false } = {}) {
  return saveConsent({ termsAccepted: true, experience: !!experience });
}

export function setExperience(on) {
  return saveConsent({ experience: !!on, ...(on ? {} : {}) });
}

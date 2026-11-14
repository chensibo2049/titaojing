/**
 * 本机练习档案，以及尚未接通的云端账号外壳。
 * 档案只写在这台设备的 IndexedDB 里；不会把密码存进 localStorage。
 */
import { $, esc, toast, confirmBox } from "./ui.js";
import { getProfile, saveProfile, clearProfile as clearStoredProfile } from "./store.js";

export function authConfig() {
  const cfg = (typeof window !== "undefined" && window.TITAOJING_CONFIG) || {};
  return { endpoint: String(cfg.authEndpoint || "").trim() };
}

export function profileNameOf(p) {
  if (!p) return "";
  return String(p.displayName || "").trim();
}

export async function currentProfileName() {
  try {
    const p = await getProfile();
    return profileNameOf(p);
  } catch (_) {
    return "";
  }
}

function cloudConnected() {
  return !!authConfig().endpoint;
}

export async function renderProfile() {
  const host = $("profile-body");
  if (!host) return;
  let p = null;
  let storeOk = true;
  try { p = await getProfile(); }
  catch (_) { storeOk = false; }

  const name = p ? profileNameOf(p) : "";
  const school = p?.school || "";
  const dept = p?.dept || "";
  const hasLocal = !!(name || school || dept);

  $("profile-name").value = name;
  $("profile-school").value = school;
  $("profile-dept").value = dept;
  $("profile-local-state").textContent = !storeOk
    ? "这个浏览器不允许本地存储（可能是无痕模式），练习档案不可用。"
    : hasLocal
      ? `本机档案已建立${name ? "：" + name : ""}。记录只留在这台设备的这个浏览器里。`
      : "还没有本机练习档案。填写后点「保存档案」，以后的试讲可以附上这个称呼。不建档案也可以直接练习。";
  $("btn-clear-profile").hidden = !hasLocal;

  const cloud = $("profile-cloud-state");
  const form = $("cloud-auth-form");
  if (cloudConnected()) {
    cloud.textContent = "云端账号服务已配置。当前版本仍不会在未确认前把密码发送出去；请以服务端说明为准。";
    if (form) form.querySelectorAll("input,button[type=submit]").forEach((el) => { el.disabled = false; });
  } else {
    cloud.textContent = "云端账号会在服务端就绪后开通；现在可以先在本机建立练习档案，记录仍留在这台设备。练习不需要注册或登录。";
    if (form) {
      // 保留输入框可见，但提交只说明尚未接通，绝不保存密码。
    }
  }
  $("cloud-auth-msg").textContent = "";
}

export function wireProfile() {
  const local = $("profile-form");
  if (local && !local.dataset.wired) {
    local.dataset.wired = "1";
    local.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await saveProfile({
          displayName: $("profile-name").value,
          school: $("profile-school").value,
          dept: $("profile-dept").value,
        });
        $("profile-local-hint").textContent = "已保存到这台设备。";
        toast("本机档案已保存");
        await renderProfile();
      } catch (err) {
        $("profile-local-hint").textContent = "没能保存（浏览器可能处于无痕模式）。";
      }
    });
  }
  const clear = $("btn-clear-profile");
  if (clear && !clear.dataset.wired) {
    clear.dataset.wired = "1";
    clear.addEventListener("click", async () => {
      if (!(await confirmBox("清除本机练习档案？历史试讲记录不会被删除，只是不再附带这个称呼。", "清除档案"))) return;
      await clearStoredProfile();
      toast("本机档案已清除");
      $("profile-local-hint").textContent = "";
      await renderProfile();
    });
  }
  const cloud = $("cloud-auth-form");
  if (cloud && !cloud.dataset.wired) {
    cloud.dataset.wired = "1";
    cloud.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("cloud-auth-msg");
      const email = (cloud.email?.value || "").trim();
      const password = cloud.password?.value || "";
      // 绝不把密码写入 localStorage / IndexedDB。
      if (cloud.password) cloud.password.value = "";
      if (!authConfig().endpoint) {
        msg.textContent = "云端账号会在服务端就绪后开通；现在可以先在本机建立练习档案，记录仍留在这台设备。刚才输入的密码没有被保存。";
        return;
      }
      if (!email || !password) {
        msg.textContent = "请填写邮箱和密码。";
        return;
      }
      msg.textContent = "已配置账号服务地址，但当前版本尚未接通登录，密码没有发送，也没有保存在这台设备上。";
    });
  }
}

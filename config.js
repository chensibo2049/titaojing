/*
 * 沉思波 · 体态镜 —— 部署配置（不参与打包，部署时可直接改这个文件，无需重新构建）
 *
 * edition: "trial" 试用版 | "pro" 正式版
 *   - 这里只是本地功能开关，不是安全的授权机制：懂技术的人可以改掉它。
 *   - 将来接入真正的授权后端时，只需替换 src/license.js 里的 verifyLicense()，
 *     其余页面只读取 license.features，不必改动。
 *
 * 不要在这里放任何密钥或付款信息。
 */
window.TITAOJING_CONFIG = {
  edition: "trial",

  // 各版本的功能限制（页面只读这些开关）
  editions: {
    trial: {
      label: "试用版",
      maxHistory: Infinity,        // 本机最多保留几次真实试讲（一键演示不计入）
      saveVideo: true,      // 是否允许把录像存进本机历史
      compare: true,        // 进步对比
      printReport: true,    // 打印 / 存为 PDF
      reportWatermark: true // 小结图片与打印页带「试用版」字样
    },
    pro: {
      label: "正式版",
      maxHistory: Infinity,
      saveVideo: true,
      compare: true,
      printReport: true,
      reportWatermark: false
    }
  },

  // 仅供内部测试：在「关于与隐私 → 激活」输入下列任一测试码，可在本机切换到正式版。
  // 正式上线前请清空，并改为调用授权后端（见 src/license.js）。
  testActivationCodes: ["CSB-TEST-PRO"],

  // 激活接口（预留，当前版本不调用任何网络接口）
  licenseEndpoint: "",

  // 反馈：只生成文本 / JSON，由测试同学手动发给负责人。这里可填写收件说明。
  feedbackHint: "请把下面的文字或下载的 .json 文件，发给安排你测试的老师（微信或邮件均可）。",

  // 体验计划上传地址。留空（默认）时，即使参加者队也不会向任何地址发送。
  // 将来若启用，请换成自己的 https 接口，并在隐私说明里写清接收方与保存期限。
  // 请求体为 JSON，字段见 src/experience.js（fillers / transcript / summary / screenshots），不含录像和音频。
  experienceEndpoint: "",
  experienceMaxScreenshots: 3,
  experienceSampleRate: 1,

  // 本机听写中文模型的自建镜像目录（可选）。留空时依次从魔搭 ModelScope、hf-mirror.com、Hugging Face 下载。
  // 若填写，目录下需有 model.int8.onnx 与 tokens.txt（见 assets/asr/manifest.json 的 sha256），并允许跨域（Access-Control-Allow-Origin）。
  // 可用 `npm run fetch-asr` 下载到本地后上传到自己的对象存储。
  asrModelBase: "",

  // 可选录后服务：仅同源 HTTPS，空值表示未接入；访问码不放配置。
  asrServerEndpoint: "",

  // 云端账号服务地址。留空（默认）时，注册 / 登录表单只作说明，不会发送邮箱或密码。
  authEndpoint: ""
};

/**
 * 模拟课堂 / 模拟路演：全部在本机、按规则演算，不调用任何在线服务。
 * 题库见 assets/classroom/banks.json，老师可直接改。
 */
export const BANK_URL = "assets/classroom/banks.json";
export const SILENCE_CONFUSED_SEC = 8;
export const FAST_SPEECH_CPM = 280;
export const FAST_WINDOW_SEC = 8;

export const DEFAULT_BANK = {
  version: 1,
  notice: "练习用模拟",
  class: {
    label: "模拟学生",
    students: [
      { id: "s1", name: "林秋", seat: "左一", tone: "稳" },
      { id: "s2", name: "周南", seat: "左二", tone: "急" },
      { id: "s3", name: "陈禾", seat: "中", tone: "细" },
      { id: "s4", name: "马言", seat: "右二", tone: "慢" },
      { id: "s5", name: "许青", seat: "右一", tone: "活" },
    ],
    askCues: ["谁来回答", "请这位同学", "有没有同学", "大家说说", "谁来讲", "请同学"],
    pickCues: ["请你", "就你", "请这位"],
    readChorusCues: ["齐读", "全班一起读", "我们一起读"],
    readPointCues: ["请你来读", "请这位同学读", "请同学来读", "请同学读"],
    readModelCues: ["我来读", "听老师读", "跟着老师读"],
    readRoleCues: ["分角色", "男生读", "女生读"],
    answers: [
      { id: "a1", kind: "correct", text: "老师，我的理解是：刚才讲的要点，就是前面反复强调的那一句。" },
      { id: "a2", kind: "partial", text: "我只记住了一半。前半句好像是对的，后面那一步我还没跟上。" },
      { id: "a3", kind: "wrong", text: "我好像把前后两步弄反了，结果说成了另一个意思。" },
    ],
  },
  roadshow: {
    label: "模拟路演",
    guests: [
      { id: "g1", name: "陈评委", role: "评委" },
      { id: "g2", name: "王老师", role: "评委" },
      { id: "g3", name: "赵嘉宾", role: "嘉宾" },
    ],
    askCues: ["大家有什么问题", "请问各位", "欢迎提问", "还有问题吗", "请评委"],
    questions: [
      { id: "q1", topic: "差异化", text: "和已经有的办法比，你们的差别在哪里？" },
      { id: "q2", topic: "收费", text: "如果学校要用，你们打算怎么收费？" },
      { id: "q3", topic: "用户是谁", text: "你们现在最想先给谁用？第一批用户是谁？" },
      { id: "q4", topic: "下一步计划", text: "接下来三个月，你们准备先做成哪一件事？" },
      { id: "q5", topic: "团队分工", text: "这件事里，你们各自负责哪一块？" },
    ],
    thinkSeconds: 30,
    segmentSeconds: 50,
  },
};

let cachedBank = null;

export async function loadBank(url = BANK_URL) {
  if (cachedBank) return cachedBank;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    const raw = await res.json();
    cachedBank = normalizeBank(raw);
  } catch (_) {
    cachedBank = normalizeBank(DEFAULT_BANK);
  }
  return cachedBank;
}

export function resetBankCache() {
  cachedBank = null;
}

export function normalizeBank(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const base = DEFAULT_BANK;
  const cls = { ...base.class, ...(src.class || {}) };
  const road = { ...base.roadshow, ...(src.roadshow || {}) };
  cls.students = Array.isArray(cls.students) && cls.students.length ? cls.students.slice(0, 6) : base.class.students.slice();
  if (cls.students.length < 4) cls.students = base.class.students.slice();
  cls.askCues = list(cls.askCues, base.class.askCues);
  cls.pickCues = list(cls.pickCues, base.class.pickCues);
  cls.readChorusCues = list(cls.readChorusCues, base.class.readChorusCues);
  cls.readPointCues = list(cls.readPointCues, base.class.readPointCues);
  cls.readModelCues = list(cls.readModelCues, base.class.readModelCues);
  cls.readRoleCues = list(cls.readRoleCues, base.class.readRoleCues);
  cls.answers = Array.isArray(cls.answers) && cls.answers.length ? cls.answers : base.class.answers.slice();
  road.guests = Array.isArray(road.guests) && road.guests.length ? road.guests.slice(0, 3) : base.roadshow.guests.slice();
  if (road.guests.length < 3) {
    const fill = base.roadshow.guests.filter((g) => !road.guests.some((x) => x.id === g.id));
    road.guests = road.guests.concat(fill).slice(0, 3);
  }
  road.askCues = list(road.askCues, base.roadshow.askCues);
  road.questions = Array.isArray(road.questions) && road.questions.length ? road.questions : base.roadshow.questions.slice();
  road.thinkSeconds = Math.max(8, Number(road.thinkSeconds) || base.roadshow.thinkSeconds);
  road.segmentSeconds = Math.max(20, Number(road.segmentSeconds) || base.roadshow.segmentSeconds);
  return { version: src.version || 1, notice: src.notice || base.notice, class: cls, roadshow: road };
}

function list(v, fallback) {
  return Array.isArray(v) && v.length ? v.map((x) => String(x)).filter(Boolean) : fallback.slice();
}

export function matchCue(text, cues) {
  const t = String(text || "").replace(/\s+/g, "");
  if (!t) return null;
  for (const c of cues || []) {
    const cue = String(c).replace(/\s+/g, "");
    if (cue && t.includes(cue)) return c;
  }
  return null;
}

export function findPickTarget(text, people, raisedIds) {
  const t = String(text || "").replace(/\s+/g, "");
  if (!t) return null;
  for (const p of people) {
    if (t.includes("请" + p.name) || t.includes(p.name)) return p.id;
  }
  if (/请左边|左边这位|请左/.test(t)) {
    const left = people.find((p) => raisedIds.includes(p.id) && /左/.test(p.seat || ""));
    if (left) return left.id;
    return people[0] && people[0].id;
  }
  if (/请右边|右边这位|请右/.test(t)) {
    const right = [...people].reverse().find((p) => raisedIds.includes(p.id) && /右/.test(p.seat || ""));
    if (right) return right.id;
    return people[people.length - 1] && people[people.length - 1].id;
  }
  if (/请第一|第一位|就你|请你|请这位/.test(t)) {
    return (raisedIds[0] || (people[0] && people[0].id)) || null;
  }
  return null;
}

export function recentCharsPerMin(transcript, t, windowSec = FAST_WINDOW_SEC) {
  const from = Math.max(0, t - windowSec);
  let chars = 0;
  for (const row of transcript || []) {
    if (row.t >= from && row.t <= t) chars += String(row.text || "").replace(/\s+/g, "").length;
  }
  const span = Math.max(1, Math.min(windowSec, t));
  return (chars / span) * 60;
}

function sideFromPose(pose) {
  const lm = Array.isArray(pose) ? pose : (pose && pose.landmarks);
  if (!lm) return null;
  const lw = lm[15], rw = lm[16], ls = lm[11], rs = lm[12];
  if (!lw || !rw || !ls || !rs) return null;
  const body = ((ls.x || 0) + (rs.x || 0)) / 2;
  const reachL = (body - (lw.x || 0));
  const reachR = ((rw.x || 0) - body);
  // 画面坐标：x 小在左。伸臂超过肩宽约 0.18 视为指向。
  if (reachL > 0.18 && reachL > reachR + 0.04) return "left";
  if (reachR > 0.18 && reachR > reachL + 0.04) return "right";
  return null;
}

export function createSim(mode, bank, opts = {}) {
  const m = mode === "roadshow" ? "roadshow" : "class";
  const b = normalizeBank(bank || DEFAULT_BANK);
  const peopleSrc = m === "roadshow" ? b.roadshow.guests : b.class.students;
  const people = peopleSrc.map((p, i) => ({
    id: p.id || ("p" + i),
    name: p.name || ("同学" + (i + 1)),
    seat: p.seat || p.role || "",
    role: p.role || (m === "roadshow" ? "嘉宾" : "同学"),
    tone: p.tone || "",
    state: "idle",
    bubble: "",
    raisedAt: 0,
  }));
  const usedAnswers = new Set();
  const usedQuestions = new Set();
  const log = [];
  let lastSpeechAt = 0;
  let lastSegmentAskAt = -999;
  let spokenSinceSegment = 0;
  let pendingQ = null;
  let lastFed = "";
  let nextId = 1;
  const rng = typeof opts.random === "function" ? opts.random : Math.random;

  const pushLog = (row) => {
    const ev = { id: "e" + nextId++, t: row.t, type: row.type, who: row.who || "", label: row.label || "", kind: row.kind || "", dur: row.dur ?? null, text: row.text || "" };
    log.push(ev);
    return ev;
  };

  const person = (id) => people.find((p) => p.id === id);
  const raised = () => people.filter((p) => p.state === "hand").map((p) => p.id);

  const groupRead = (t, cue) => {
    for (const p of people) {
      p.state = "reading";
      p.bubble = "齐读";
    }
    pushLog({ t, type: "read", label: "齐读", text: cue || "齐读" });
  };

  const standRead = (id, t, cue) => {
    for (const p of people) {
      if (p.state === "reading" || p.state === "stand_read" || p.state === "listening" || p.state === "hand") {
        p.state = "idle";
        p.bubble = "";
      }
    }
    const p = person(id) || people[0];
    if (!p) return null;
    p.state = "stand_read";
    p.bubble = "朗读";
    pushLog({ t, type: "read", label: "点读", who: p.id, text: cue || "请你来读" });
    return p;
  };

  const listenModel = (t, cue) => {
    for (const p of people) {
      p.state = "listening";
      p.bubble = "";
    }
    pushLog({ t, type: "read", label: "范读", text: cue || "听老师读" });
  };

  const setState = (ids, state) => {
    for (const p of people) {
      if (ids && !ids.includes(p.id)) continue;
      p.state = state;
      if (state !== "speaking" && state !== "asking") p.bubble = "";
      if (state !== "hand") p.raisedAt = 0;
    }
  };

  const pickAnswer = () => {
    const pool = b.class.answers.filter((a) => !usedAnswers.has(a.id));
    const src = pool.length ? pool : b.class.answers;
    const a = src[Math.floor(rng() * src.length)] || src[0];
    if (a) usedAnswers.add(a.id);
    if (usedAnswers.size >= b.class.answers.length) usedAnswers.clear();
    return a;
  };

  const pickQuestion = () => {
    const pool = b.roadshow.questions.filter((q) => !usedQuestions.has(q.id));
    const src = pool.length ? pool : b.roadshow.questions;
    const q = src[Math.floor(rng() * src.length)] || src[0];
    if (q) usedQuestions.add(q.id);
    if (usedQuestions.size >= b.roadshow.questions.length) usedQuestions.clear();
    return q;
  };

  const raiseHands = (t) => {
    // 多数举手，留一两位坐着，更像真实课堂
    const n = people.length <= 4 ? people.length : Math.max(3, people.length - 1);
    const order = people.slice().sort(() => rng() - 0.5);
    const ids = order.slice(0, n).map((p) => p.id);
    for (const p of people) {
      if (ids.includes(p.id)) {
        p.state = "hand";
        p.raisedAt = t;
        p.bubble = "";
      } else {
        p.state = "idle";
        p.bubble = "";
        p.raisedAt = 0;
      }
    }
    pushLog({ t, type: "raise", label: "举手", text: "谁来回答" });
    return ids;
  };

  const callOn = (id, t) => {
    const p = person(id);
    if (!p) return null;
    if (m === "roadshow") return null;
    const ans = pickAnswer();
    for (const x of people) {
      x.state = x.id === id ? "speaking" : "idle";
      x.bubble = x.id === id ? (ans ? ans.text : "") : "";
      x.raisedAt = 0;
    }
    pushLog({
      t,
      type: "call",
      who: p.id,
      label: p.name,
      kind: ans ? ans.kind : "",
      text: ans ? ans.text : "",
    });
    return { person: p, answer: ans };
  };

  const askGuest = (t, reason) => {
    if (pendingQ) return pendingQ;
    const q = pickQuestion();
    if (!q) return null;
    const idle = people.filter((p) => p.state !== "asking");
    const g = idle[Math.floor(rng() * idle.length)] || people[0];
    for (const x of people) {
      x.state = x.id === g.id ? "asking" : "idle";
      x.bubble = x.id === g.id ? q.text : "";
    }
    pendingQ = { guestId: g.id, question: q, askedAt: t, reason: reason || "cue" };
    lastSegmentAskAt = t;
    spokenSinceSegment = 0;
    pushLog({
      t,
      type: "ask",
      who: g.id,
      label: g.name,
      kind: q.topic,
      text: q.text,
    });
    return pendingQ;
  };

  const startReply = (t) => {
    if (!pendingQ) return null;
    const dur = Math.max(0, t - pendingQ.askedAt);
    const ev = pushLog({
      t,
      type: "reply",
      who: pendingQ.guestId,
      label: "开始回应",
      kind: pendingQ.question && pendingQ.question.topic,
      dur,
      text: "",
    });
    pendingQ.repliedAt = t;
    pendingQ = null;
    for (const x of people) {
      if (x.state === "asking") {
        x.state = "idle";
        x.bubble = "";
      }
    }
    return ev;
  };

  return {
    mode: m,
    bank: b,
    people,
    notice: b.notice || "练习用模拟",
    label: m === "roadshow" ? b.roadshow.label : b.class.label,

    feedTranscript(text, t, isFinal = true) {
      lastSpeechAt = t;
      const raw = String(text || "");
      const compact = raw.replace(/\s+/g, "");
      if (compact && compact === lastFed) return null;
      if (compact) lastFed = compact;
      if (compact) spokenSinceSegment += compact.length;

      if (m === "class") {
        const chorus = matchCue(raw, b.class.readChorusCues) || matchCue(raw, b.class.readRoleCues);
        if (chorus) {
          groupRead(t, chorus);
          return { action: "group_read", cue: chorus };
        }
        const pointRead = matchCue(raw, b.class.readPointCues) || (/请[\u4e00-\u9fff]{1,4}来读/.test(compact) || /请[\u4e00-\u9fff]{1,4}读/.test(compact) ? "请你来读" : null);
        if (pointRead) {
          const target = findPickTarget(raw, people, people.map((p) => p.id)) || (people[0] && people[0].id);
          const who = standRead(target, t, pointRead);
          return { action: "stand_read", person: who, cue: pointRead };
        }
        const model = matchCue(raw, b.class.readModelCues);
        if (model) {
          listenModel(t, model);
          return { action: "model_read", cue: model };
        }
        if (matchCue(raw, b.class.askCues)) {
          raiseHands(t);
          return { action: "raise" };
        }
        const target = findPickTarget(raw, people, raised());
        const pickLike = matchCue(raw, b.class.pickCues) || target;
        if (pickLike && (raised().length || target)) {
          const id = target || raised()[0];
          const r = callOn(id, t);
          return r ? { action: "call", ...r } : null;
        }
        return null;
      }

      // 路演：老师开口且嘉宾刚提问，视为开始回应
      if (pendingQ && compact.length >= 2 && t - pendingQ.askedAt >= 0.4) {
        const ev = startReply(t);
        return ev ? { action: "reply", event: ev } : null;
      }
      if (matchCue(raw, b.roadshow.askCues)) {
        const q = askGuest(t, "cue");
        return q ? { action: "ask", pending: q } : null;
      }
      return null;
    },

    tick(t, extras = {}) {
      const events = [];
      const silence = extras.silence != null ? extras.silence : (t - lastSpeechAt);
      const cpm = extras.cpm != null ? extras.cpm : 0;
      const busy = people.some((p) => p.state === "speaking" || p.state === "asking" || p.state === "hand" || p.state === "reading" || p.state === "stand_read");

      if (!busy && silence >= SILENCE_CONFUSED_SEC && lastSpeechAt > 0) {
        const already = people.filter((p) => p.state === "confused" || p.state === "distracted");
        if (!already.length) {
          const n = 1 + (rng() > 0.5 ? 1 : 0);
          const pick = people.slice().sort(() => rng() - 0.5).slice(0, n);
          pick.forEach((p, i) => { p.state = i === 0 ? "confused" : "distracted"; });
          events.push(pushLog({ t, type: "mood", label: "安静过久", text: "有同学露出困惑或走神" }));
        }
      } else if (!busy && cpm >= FAST_SPEECH_CPM) {
        const already = people.some((p) => p.state === "confused");
        if (!already) {
          const p = people[Math.floor(rng() * people.length)];
          if (p) p.state = "confused";
          events.push(pushLog({ t, type: "mood", label: "语速很快", text: "有同学露出困惑" }));
        }
      } else if ((silence < 3 && cpm < FAST_SPEECH_CPM * 0.8) && people.some((p) => p.state === "confused" || p.state === "distracted")) {
        for (const p of people) {
          if (p.state === "confused" || p.state === "distracted") p.state = "idle";
        }
      }

      if (m === "roadshow" && !pendingQ && !busy) {
        const gap = t - lastSegmentAskAt;
        if (spokenSinceSegment > 40 && gap >= b.roadshow.segmentSeconds) {
          const q = askGuest(t, "segment");
          if (q) events.push({ action: "ask", pending: q });
        }
      }

      // 指向：举手时，手臂伸向某一侧即点名
      if (m === "class" && raised().length && extras.pose) {
        const side = sideFromPose(extras.pose);
        if (side) {
          const ids = raised();
          const seated = people.filter((p) => ids.includes(p.id));
          const target = side === "left"
            ? seated.find((p) => /左/.test(p.seat || "")) || seated[0]
            : [...seated].reverse().find((p) => /右/.test(p.seat || "")) || seated[seated.length - 1];
          if (target) {
            const r = callOn(target.id, t);
            if (r) events.push({ action: "call", ...r });
          }
        }
      }

      return events;
    },

    pick(id, t) {
      return callOn(id, t);
    },

    remainingThink(t) {
      if (!pendingQ) return null;
      const limit = b.roadshow.thinkSeconds;
      return { askedAt: pendingQ.askedAt, remain: Math.max(0, limit - (t - pendingQ.askedAt)), limit, topic: pendingQ.question && pendingQ.question.topic, guestId: pendingQ.guestId };
    },

    snapshot(t = 0) {
      return {
        mode: m,
        label: m === "roadshow" ? b.roadshow.label : b.class.label,
        notice: "练习用模拟",
        t,
        people: people.map((p) => ({ ...p })),
        pending: pendingQ ? { ...pendingQ, question: { ...pendingQ.question } } : null,
        timer: this.remainingThink(t),
      };
    },

    getLog() {
      return log.slice();
    },

    summarize() {
      const calls = log.filter((e) => e.type === "call");
      const asks = log.filter((e) => e.type === "ask");
      const replies = log.filter((e) => e.type === "reply");
      const raises = log.filter((e) => e.type === "raise");
      const byWho = {};
      for (const e of calls) {
        const name = e.label || e.who;
        byWho[name] = (byWho[name] || 0) + 1;
      }
      const replyDurs = replies.map((e) => e.dur).filter((n) => n != null);
      const mean = replyDurs.length ? replyDurs.reduce((a, b) => a + b, 0) / replyDurs.length : null;
      return {
        mode: m,
        interactions: raises.length + calls.length + asks.length + replies.length,
        raiseCount: raises.length,
        callCount: calls.length,
        askCount: asks.length,
        replyCount: replies.length,
        callDistribution: byWho,
        replyDurations: replyDurs,
        meanReplySec: mean,
        events: log.slice(),
      };
    },
  };
}

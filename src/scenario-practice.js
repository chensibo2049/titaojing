/** Replaceable practice interpretation; suggestions, not measured teaching quality. */
export const PRACTICE_RULE_VERSION = "practice-self-review/1.0.0";
export function interpretPractice(observation) {
  const o = observation;
  const candidates = o.evidence.filter(e => {
    const key = e.kind === "sway" ? "posture" : e.kind;
    return o.available[key] !== false;
  });
  const event = candidates.find(e => e.type === "back") || candidates.find(e => e.kind === "board") || candidates.find(e => e.kind === "filler") || candidates[0];
  let next = "选一处关键句，下一遍讲完后停半秒，再自己回看是否更清楚。";
  if (!o.available.posture) next = "先调整取景与正面光线，让腰部以上进入画面，再练两分钟。";
  else if (event?.kind === "filler") next = "先回听这个词；若确实是多余的，把它换成半拍停顿，再讲同一句。";
  else if (event?.kind === "board" || event?.type === "back") next = "回看写板附近这一段；下一遍试试写完后先转向镜头，再继续讲。";
  else if (event?.kind === "gaze") next = "回看这次低头是否必要；下一遍试试讲完一个要点后看向镜头。";
  else if (event) next = "回看标记处，自己确认是否需要调整；下一遍只改这一处站姿或移动。";
  return {
    scenario: "practice-self-review", ruleVersion: PRACTICE_RULE_VERSION,
    good: o.demo ? "这是完整预设演示；动画、字幕和标记不是实际识别结果。" : `本次留下了 ${Math.round(o.duration)} 秒练习记录。标记是单摄像头／转写规则提示，不是表现评分。`,
    next, evidence: event ? [{ t: event.t, type: event.type, source: event.source }] : [],
    basis: event ? "根据所列时刻提供自查建议；请先确认标记是否正确。" : "没有足够事件依据；这是通用复练动作，不代表已检测到问题。",
  };
}

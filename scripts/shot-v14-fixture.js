import { renderObserveSheet } from "../src/observe-ui.js";
import { sampleChunxiaoTranscript, sampleChunxiaoStem } from "../src/yuwen.js";
import { createSim, DEFAULT_BANK } from "../src/classroom-sim.js";
import { seatsHtml } from "../src/classroom-sim-ui.js";

function paint() {
  const stem = sampleChunxiaoStem();
  const ta = document.getElementById("perm-stem");
  if (ta) ta.value = stem;

  const session = {
    kind: "camera",
    duration: 190,
    transcript: sampleChunxiaoTranscript(),
    frames: [],
    speechAvailable: true,
    speechHeard: true,
    stemRequirement: stem,
  };
  renderObserveSheet(document.getElementById("sheet"), session);

  const chorus = createSim("class", DEFAULT_BANK, { random: () => 0.3 });
  chorus.feedTranscript("请大家齐读题目。", 8, true);
  document.getElementById("sim-chorus-row").innerHTML = seatsHtml(chorus.snapshot(8).people);

  const point = createSim("class", DEFAULT_BANK, { random: () => 0.3 });
  point.feedTranscript("请你来读", 10, true);
  document.getElementById("sim-point-row").innerHTML = seatsHtml(point.snapshot(10).people);

  document.body.classList.add("ready");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
else paint();

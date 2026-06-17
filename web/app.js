// app.js - the Lilt middle-school math session.
//
// A calm, one-thing-at-a-time math practice that runs the engine live on a real
// student's answers. It times each answer, grades free text, lets the student say
// they are stuck, and feeds the three signals (correct, response time, help) to the
// tutor, which decides what comes next and when to suggest a break. The student's
// profile persists in the browser, so the belief about their pace carries across days.

import {
  Tracer, Tutor, checkAnswer, SKILLS, GRADES, topicsInGrade,
  skillsInGrade, allPrerequisites, topologicalOrder, buildScope,
} from "./engine.js";

const SEGMENT = 8;        // problems before a gentle checkpoint
const PARTICLES = 400;

const $ = id => document.getElementById(id);
const views = ["start", "practice", "break", "checkpoint", "end"];
function show(view) { for (const v of views) $("view-" + v).hidden = (v !== view); }

const state = {
  name: "", grade: 6, topic: "All",
  tracer: null, tutor: null, item: null, shownAt: 0,
  pending: null, total: 0, segment: 0, graded: false,
};

// --- persistence -----------------------------------------------------------

const key = name => "lilt:profile:" + name.trim().toLowerCase();
function loadProfile(name) { try { return JSON.parse(localStorage.getItem(key(name))); } catch { return null; } }
function saveProfile(name, profile) { try { localStorage.setItem(key(name), JSON.stringify(profile)); } catch { /* private mode */ } }

// --- start screen ----------------------------------------------------------

function buildGradeChips() {
  const box = $("grades"); box.innerHTML = "";
  for (const g of GRADES) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip" + (g === state.grade ? " on" : "");
    b.textContent = "Grade " + g;
    b.onclick = () => { state.grade = g; buildGradeChips(); buildTopics(); };
    box.appendChild(b);
  }
}

function buildTopics() {
  const sel = $("topic"); sel.innerHTML = "";
  const opts = ["All", ...topicsInGrade(state.grade)];
  for (const t of opts) {
    const o = document.createElement("option");
    o.value = t; o.textContent = t; sel.appendChild(o);
  }
  if (!opts.includes(state.topic)) state.topic = "All";
  sel.value = state.topic;
  sel.onchange = () => { state.topic = sel.value; };
}

function refreshWelcome() {
  const name = $("name").value.trim();
  const prof = name ? loadProfile(name) : null;
  $("welcome").hidden = !prof;
  if (prof) $("welcome").textContent = "Welcome back. We'll pick up where you left off.";
}

function scopeFor(grade, topic) {
  if (topic === "All") return buildScope(grade);
  const inGT = skillsInGrade(grade).filter(sid => SKILLS[sid].topic === topic);
  const chosen = new Set(inGT);
  for (const sid of inGT) for (const p of allPrerequisites(sid)) chosen.add(p);
  return topologicalOrder().filter(sid => chosen.has(sid));
}

function startSession() {
  state.name = $("name").value.trim() || "friend";
  const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  state.tracer = new Tracer(PARTICLES, seed, loadProfile(state.name));
  state.tutor = new Tutor({ grade: state.grade, estimator: state.tracer, scope: scopeFor(state.grade, state.topic) });
  state.total = 0; state.segment = 0;
  show("practice");
  showItem(state.tutor.start());
}

// --- the practice loop -----------------------------------------------------

function showItem(item) {
  state.item = item;
  state.graded = false;
  state.shownAt = performance.now();
  $("prompt").textContent = item.prompt;
  $("skill-name").textContent = "Working on: " + SKILLS[item.skillId].name;
  const m = state.tracer.masteryMean(item.skillId);
  $("mastery-fill").style.width = Math.round(8 + 92 * m) + "%";
  $("count").textContent = "Problems today: " + state.total;
  $("answer").value = "";
  $("feedback").hidden = true;
  $("answer-form").hidden = false;
  $("answer").focus();
}

function grade(correct, helpRequested) {
  if (state.graded) return;
  state.graded = true;
  const rt = Math.min(60, Math.max(0.4, (performance.now() - state.shownAt) / 1000));
  const obs = {
    correct, responseTime: rt, helpRequested,
    skillId: state.item.skillId, itemDifficulty: state.item.difficulty,
  };
  const decision = state.tutor.observe(obs);
  saveProfile(state.name, state.tracer.exportProfile());
  state.total += 1; state.segment += 1;
  state.pending = decision;

  const result = $("result");
  if (correct) { result.textContent = "Correct."; result.className = "result right"; }
  else { result.textContent = "The answer is " + state.item.answer + "."; result.className = "result wrong"; }
  $("encourage").textContent = decision.feedback;
  $("answer-form").hidden = true;
  $("feedback").hidden = false;
  $("next").focus();
}

function proceed() {
  const d = state.pending;
  if (d.action === "break") { state.segment = 0; show("break"); return; }
  if (state.segment >= SEGMENT) {
    state.segment = 0;
    $("checkpoint-msg").textContent = "You worked through " + SEGMENT + " problems. Keep going or take a break.";
    show("checkpoint");
    return;
  }
  show("practice");
  showItem(d.item);
}

function endSession() {
  if (state.tracer) saveProfile(state.name, state.tracer.exportProfile());
  $("end-msg").textContent = "You worked on " + state.total + " problem" + (state.total === 1 ? "" : "s") + ". See you next time.";
  show("end");
}

// --- wiring ----------------------------------------------------------------

$("name").addEventListener("input", refreshWelcome);
$("start").addEventListener("click", startSession);

$("answer-form").addEventListener("submit", e => {
  e.preventDefault();
  grade(checkAnswer(state.item, $("answer").value), false);
});
$("stuck").addEventListener("click", () => grade(false, true));
$("next").addEventListener("click", proceed);
$("done").addEventListener("click", endSession);

$("resume").addEventListener("click", () => { show("practice"); showItem(state.pending.item); });
$("keep-going").addEventListener("click", () => { show("practice"); showItem(state.pending.item); });
$("cp-break").addEventListener("click", () => show("break"));
$("restart").addEventListener("click", () => { show("start"); refreshWelcome(); });

buildGradeChips();
buildTopics();
show("start");

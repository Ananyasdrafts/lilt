// app.js - the Lilt middle-school math session.
//
// A calm, one-thing-at-a-time math tutor that runs the engine live on a real
// student's answers. A new student starts with a short placement check so practice
// begins at their level. Each problem can be worked through with hints, one step at a
// time; a wrong answer gets a note on what probably went wrong and a second try, and
// a second miss shows the full worked solution. After each problem the app says in
// one line what the tutor decided and why.
//
// The engine sees one observation per problem: whether the first answer was right,
// how long the student took before answering or asking for help, and whether they
// used help. That is the same { correct, responseTime, helpRequested } signal the
// simulator produces. The student's profile persists in the browser.

import { Tracer, Tutor, SKILLS, GRADES, topicsInGrade, allPrerequisites, topologicalOrder, buildScope, generateItem, mulberry32 } from "./engine.js";
import { lesson, grade as gradeResponse, lc } from "./teach.js";
import { chosenSkills, placementSkills, placementItems, priorFromPlacement, practiceOrder, credit } from "./placement.js";

const SEGMENT = 8;        // problems before a checkpoint
const PARTICLES = 400;
const RECENT = 6;         // don't repeat a prompt seen in the last few problems
const STREAK = 2;         // clean answers in a row on a skill before the app steps it up
const STEP_UP = 0.2;      // how far up (levels run 0 to 1 within a skill)
const TOP_LEVEL = 0.75;   // problems at or above this level count toward testing out
const TEST_OUT = 3;       // clean answers in a row at the top level to test out of a skill

const $ = id => document.getElementById(id);
const views = ["start", "placement", "placed", "practice", "break", "checkpoint", "end"];
function show(view) { for (const v of views) $("view-" + v).hidden = (v !== view); window.scrollTo(0, 0); }

const state = {
  name: "", grade: 6, topic: "All", scope: [],
  tracer: null, tutor: null, rng: null, pending: null,
  total: 0, segment: 0, firstTry: 0, recent: [], startMastery: {}, misses: {}, streak: 0, heldMastered: 0, topRun: 0, testedOut: false,
  // the current problem
  item: null, shownAt: 0, actedAt: null, attempts: 0, firstRight: false, hints: 0, resolved: false,
  // the placement check
  check: null,
};

// --- persistence -----------------------------------------------------------------

const key = name => "lilt:profile:" + name.trim().toLowerCase();
function loadProfile(name) { try { return JSON.parse(localStorage.getItem(key(name))); } catch { return null; } }
function saveProfile(name, profile) { try { localStorage.setItem(key(name), JSON.stringify(profile)); } catch { /* private mode */ } }
function clearProfile(name) { try { localStorage.removeItem(key(name)); } catch { /* private mode */ } }

// --- progress language -----------------------------------------------------------

function status(m) {
  if (m >= 0.8) return { label: "Got it", cls: "got" };
  if (m >= 0.6) return { label: "Almost", cls: "almost" };
  if (m >= 0.3) return { label: "Learning", cls: "learning" };
  return { label: "New", cls: "new" };
}
const pct = m => Math.round(4 + 96 * m) + "%";

// --- start screen ----------------------------------------------------------------

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
    o.value = t; o.textContent = t === "All" ? "Everything in this grade" : t; sel.appendChild(o);
  }
  if (!opts.includes(state.topic)) state.topic = "All";
  sel.value = state.topic;
  sel.onchange = () => { state.topic = sel.value; };
}

function refreshWelcome() {
  const name = $("name").value.trim();
  const prof = name ? loadProfile(name) : null;
  $("welcome").hidden = !prof;
  $("start").textContent = prof ? "Continue" : "Start";
}

function scopeFor(grade, topic) {
  if (topic === "All") return buildScope(grade);
  const inGT = chosenSkills(grade, topic);
  const chosen = new Set(inGT);
  for (const sid of inGT) for (const p of allPrerequisites(sid)) chosen.add(p);
  return topologicalOrder().filter(sid => chosen.has(sid));
}

const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;

function startSession() {
  state.name = $("name").value.trim() || "friend";
  state.scope = scopeFor(state.grade, state.topic);
  state.rng = mulberry32(newSeed());
  const profile = loadProfile(state.name);
  if (profile) { beginPractice(profile); return; }
  const skills = placementSkills(state.grade, state.topic);
  state.check = { items: placementItems(skills, newSeed()), i: 0, results: [] };
  show("placement");
  showCheckItem();
}

// --- placement check -------------------------------------------------------------

function showCheckItem() {
  const c = state.check, item = c.items[c.i], L = lesson(item);
  $("check-count").textContent = `Question ${c.i + 1} of ${c.items.length}`;
  $("check-skill").textContent = SKILLS[item.skillId].name;
  $("check-prompt").textContent = L.display;
  $("check-prompt").classList.toggle("long", L.display.length > 36);
  $("check-answer").value = "";
  $("check-answer").placeholder = L.placeholder;
  $("check-note").hidden = true;
  $("check-answer").focus();
}

function recordCheck(passed) {
  const c = state.check;
  c.results.push({ skillId: c.items[c.i].skillId, passed });
  c.i += 1;
  if (c.i < c.items.length) { showCheckItem(); return; }
  finishCheck();
}

function finishCheck() {
  const { results } = state.check;
  const profile = priorFromPlacement(state.scope, state.grade, state.topic, results);
  state.scope = practiceOrder(state.scope, profile);
  beginPractice(profile, false);
  const passed = results.filter(r => r.passed).map(r => SKILLS[r.skillId].name);
  const missed = results.filter(r => !r.passed).map(r => SKILLS[r.skillId].name);
  const box = $("placed-list"); box.innerHTML = "";
  const row = (title, names, cls) => {
    if (!names.length) return;
    const h = document.createElement("h3"); h.textContent = title; box.appendChild(h);
    const ul = document.createElement("ul"); ul.className = "plain " + cls;
    for (const n of names) { const li = document.createElement("li"); li.textContent = n; ul.appendChild(li); }
    box.appendChild(ul);
  };
  row("You look solid on", passed, "got");
  row("Worth practicing", missed, "learning");
  const first = SKILLS[state.item.skillId];
  const below = first.grade < state.grade;
  $("placed-start").textContent = below
    ? `We'll start with ${lc(first.name)} from grade ${first.grade}, since the grade ${state.grade} skills build on it.`
    : `We'll start with ${lc(first.name)}.`;
  show("placed");
  $("placed-go").focus();
}

// --- practice ----------------------------------------------------------------------

function beginPractice(profile, go = true) {
  state.tracer = new Tracer(PARTICLES, newSeed(), profile);
  state.tutor = new Tutor({ grade: state.grade, estimator: state.tracer, scope: state.scope, seed: newSeed() });
  state.total = 0; state.segment = 0; state.firstTry = 0; state.recent = []; state.misses = {}; state.streak = 0; state.heldMastered = 0; state.topRun = 0;
  state.startMastery = {};
  for (const s of state.scope) state.startMastery[s] = state.tracer.masteryMean(s);
  saveProfile(state.name, state.tracer.exportProfile());
  const first = state.tutor.start();
  prepareItem(first);
  if (go) { show("practice"); renderItem(); }
}

// swap in a fresh problem at the same skill and level if this exact one came up recently
function prepareItem(item) {
  for (let tries = 0; tries < 8 && state.recent.includes(item.prompt); tries++)
    item = generateItem(item.skillId, item.level, state.rng);
  state.recent = [item.prompt, ...state.recent].slice(0, RECENT);
  state.item = item;
}

function renderSkillHead(sid, mastery) {
  const s = SKILLS[sid], st = status(mastery);
  $("skill-name").textContent = s.name;
  $("skill-meta").textContent = `Grade ${s.grade}, ${s.topic}`;
  $("mastery-fill").style.width = pct(mastery);
  $("mastery-label").textContent = st.label;
  $("mastery-label").className = "pill " + st.cls;
}

function renderDots() {
  const box = $("dots"); box.innerHTML = "";
  $("dots-label").textContent = `Grade ${state.grade}${state.topic === "All" ? "" : ", " + state.topic}`;
  for (const sid of chosenSkills(state.grade, state.topic)) {
    const d = document.createElement("span");
    d.className = "dot " + status(state.tracer.masteryMean(sid)).cls + (sid === state.item.skillId ? " here" : "");
    d.title = SKILLS[sid].name + ": " + status(state.tracer.masteryMean(sid)).label;
    box.appendChild(d);
  }
}

function renderItem() {
  const item = state.item, L = lesson(item);
  Object.assign(state, { shownAt: performance.now(), actedAt: null, attempts: 0, firstRight: false, hints: 0, resolved: false });
  renderSkillHead(item.skillId, state.tracer.masteryMean(item.skillId));
  renderDots();
  $("count").textContent = state.total ? `${state.total} done today` : "";
  $("prompt").textContent = L.display;
  $("prompt").classList.toggle("long", L.display.length > 36);
  $("answer").value = "";
  $("answer").placeholder = L.placeholder;
  $("answer").disabled = false;
  $("steps").innerHTML = "";
  $("steps").hidden = true;
  $("note").hidden = true;
  $("check").hidden = false;
  $("hint").hidden = false;
  $("hint").textContent = "Hint";
  $("feedback").hidden = true;
  $("result").hidden = true;
  $("answer").focus();
}

function setNote(text, kind) {
  const n = $("note");
  n.textContent = text; n.className = "note " + kind; n.hidden = false;
}

function revealStep(i) {
  const steps = lesson(state.item).steps, ol = $("steps");
  ol.hidden = false;
  while (ol.children.length <= i && ol.children.length < steps.length) {
    const li = document.createElement("li");
    li.textContent = steps[ol.children.length];
    ol.appendChild(li);
  }
}

function markActed() { if (state.actedAt === null) state.actedAt = performance.now(); }

function onHint() {
  if (state.resolved) return;
  markActed();
  const steps = lesson(state.item).steps;
  revealStep(state.hints);
  state.hints += 1;
  if (state.hints >= steps.length) { resolve(false); return; }
  $("hint").textContent = state.hints === steps.length - 1 ? "Show the answer" : "Next step";
  $("answer").focus();
}

function onCheck() {
  if (state.resolved) return;
  const res = gradeResponse(state.item, $("answer").value);
  if (res.status === "empty") { setNote("Type an answer, or tap Hint if you're not sure where to start.", "info"); return; }
  markActed();
  if (res.status === "almost") { setNote(res.note, "almost"); $("answer").focus(); return; }
  state.attempts += 1;
  if (res.status === "right") { state.firstRight = state.attempts === 1; resolve(true); return; }
  if (state.attempts === 1) {
    setNote(`Not quite. ${res.note ? res.note + " " : ""}Have another go, or tap Hint for the next step.`, "wrong");
    $("answer").select();
    return;
  }
  resolve(false, res.note);
}

function resolve(gotIt, note = null) {
  state.resolved = true;
  const item = state.item, L = lesson(item);
  const wasMastered = state.tracer.masteryMean(item.skillId) >= 0.8;
  const clean = state.firstRight && state.hints === 0;
  const lastSkill = state.lastSkill; state.lastSkill = item.skillId;
  state.topRun = clean && item.level >= TOP_LEVEL ? (lastSkill === item.skillId ? state.topRun : 0) + 1 : 0;
  state.testedOut = !wasMastered && state.topRun >= TEST_OUT;
  if (state.testedOut) { credit(state.tracer, item.skillId); state.topRun = 0; }
  const rt = Math.min(60, Math.max(0.4, ((state.actedAt ?? performance.now()) - state.shownAt) / 1000));
  const decision = state.tutor.observe({
    correct: state.firstRight, responseTime: rt, helpRequested: state.hints > 0,
    skillId: item.skillId, itemDifficulty: item.difficulty,
  });
  saveProfile(state.name, state.tracer.exportProfile());
  state.total += 1; state.segment += 1;
  if (state.firstRight && state.hints === 0) state.firstTry += 1;
  if (!gotIt || !state.firstRight) state.misses[item.skillId] = (state.misses[item.skillId] || 0) + 1;
  decision.item = stretch(decision, item);
  state.pending = decision;

  const after = state.tracer.masteryMean(item.skillId);
  const holdingMastered = decision.item.skillId === item.skillId && after >= 0.8 && ["hold", "ease", "abstain"].includes(decision.action);
  state.heldMastered = holdingMastered ? state.heldMastered + 1 : 0;
  renderSkillHead(item.skillId, after);
  renderDots();

  const result = $("result");
  if (gotIt) {
    result.textContent = state.firstRight ? (state.hints ? "Correct, with a hint." : "Correct.") : "Correct on the second try.";
    result.className = "result right";
  } else {
    revealStep(L.steps.length - 1);
    result.textContent = state.hints >= L.steps.length ? "Here's the whole solution." : "Here's how this one works.";
    result.className = "result wrong";
  }
  if (!gotIt && note) setNote(`Your answer: ${note}`, "wrong");
  else $("note").hidden = true;
  const showSteps = $("show-steps");
  showSteps.hidden = !gotIt || !$("steps").hidden;
  $("tutor-note").textContent = holdingMastered
    ? "You've got this one. New material works better when you're fresh, so I'm holding here for now."
    : explain(decision, item, state.firstRight, wasMastered);
  if (state.testedOut) $("tutor-note").textContent = `That's ${TEST_OUT} hard ones in a row, so you clearly know ${lc(SKILLS[item.skillId].name)}. ` +
    (decision.item.skillId === item.skillId ? "" : decision.feedback.startsWith("Quick review")
      ? `Next, a quick review of ${lc(SKILLS[decision.item.skillId].name)}.`
      : `Moving on to ${lc(SKILLS[decision.item.skillId].name)}.`);
  $("tutor-note").hidden = decision.action === "break" || !$("tutor-note").textContent;
  $("answer").disabled = true;
  $("check").hidden = true;
  $("hint").hidden = true;
  $("feedback").hidden = false;
  $("result").hidden = false;
  $("next").focus();
}

// The engine aims for about 75% success and moves a skill's level up slowly, so a
// student who keeps getting it right can sit on easy problems for a long time. After
// STREAK clean answers in a row (first try, no hints) on the same skill, step the next
// problem up a level. The engine still sees the harder problem's real difficulty, so a
// right answer on it is stronger evidence and the belief catches up faster.
function stretch(decision, prev) {
  const next = decision.item, clean = state.firstRight && state.hints === 0;
  state.streak = clean && next.skillId === prev.skillId ? state.streak + 1 : 0;
  if (!clean || next.skillId !== prev.skillId || !["hold", "advance"].includes(decision.action)) return next;
  if (state.streak < STREAK) return next;
  const level = Math.min(1, Math.max(next.level, prev.level + STEP_UP));
  return level > next.level ? generateItem(next.skillId, level, state.rng) : next;
}

// one honest line on what the tutor decided, based on what it actually did
function explain(d, prev, firstRight, wasReview) {
  const next = d.item, name = lc(SKILLS[next.skillId].name), prevName = lc(SKILLS[prev.skillId].name);
  const same = next.skillId === prev.skillId, dl = next.level - prev.level;
  const harder = same && dl > 0.1, easier = same && dl < -0.1;
  switch (d.action) {
    case "break": return "";
    case "advance":
      if (d.feedback.startsWith("Quick review")) return `Next: a quick review of ${name}, which you already have, so it sticks.`;
      if (wasReview) return same ? "Here's another to keep it sharp." : `Next: ${name}.`;
      return same ? `You've got ${prevName}. Here's another to keep it sharp.` : `You've got ${prevName}. Moving on to ${name}.`;
    case "switch":
      if (!same) return `Switching to ${name} for a change of pace. We'll come back to ${prevName}.`;
      break;
    case "ease":
      return easier ? "Stepping down to a simpler one of these to rebuild it." : "Another one at this level, to rebuild it.";
    case "abstain":
      return "I can't tell yet if that was a slip or a gap, so here's one more like it.";
  }
  if (!same) return `Next: ${name}.`;
  if (firstRight) return harder ? "The next one is a step harder." : easier ? "The next one is a bit simpler." : "One more at this level.";
  return easier ? "Here's a simpler one like it. Try it using the steps above." : "Here's another one like it. Try it using the steps above.";
}

function proceed() {
  const d = state.pending;
  if (d.action === "break") { state.segment = 0; showBreak("tutor"); return; }
  if (state.heldMastered >= 2) { state.heldMastered = 0; state.segment = 0; showBreak("app"); return; }
  if (state.segment >= SEGMENT) { state.segment = 0; renderCheckpoint(); show("checkpoint"); $("keep-going").focus(); return; }
  continuePractice();
}

// The tutor's own break already tells the engine attention has recovered. A break the
// app suggests, or one the student picks at a checkpoint, has to tell it here.
function showBreak(by) {
  state.breakBy = by;
  $("break-msg").textContent = by === "tutor"
    ? "Your last few answers suggest your focus is dipping, which is normal after a stretch of problems. Stand up, stretch, look out a window for a minute."
    : by === "app"
      ? `You've got ${lc(SKILLS[state.item.skillId].name)}. Take a minute away from the screen before the next skill, so you start it fresh.`
      : "Stand up, stretch, look out a window for a minute.";
  show("break");
  $("resume").focus();
}

function endBreak() {
  if (state.breakBy !== "tutor") { state.tracer.onBreak(); state.tutor.stepsSinceBreak = 0; }
  continuePractice();
}

function continuePractice() {
  prepareItem(state.pending.item);
  show("practice");
  renderItem();
}

// --- summaries -----------------------------------------------------------------------

function skillRows(box, sids) {
  box.innerHTML = "";
  for (const sid of sids) {
    const m = state.tracer.masteryMean(sid), st = status(m);
    const li = document.createElement("li");
    const nm = document.createElement("span"); nm.textContent = SKILLS[sid].name;
    const pill = document.createElement("span"); pill.className = "pill " + st.cls; pill.textContent = st.label;
    li.append(nm, pill); box.appendChild(li);
  }
}

function touchedOrChosen() {
  const chosen = chosenSkills(state.grade, state.topic);
  const extra = state.scope.filter(s => !chosen.includes(s) && state.tracer.masteryMean(s) < 0.8);
  return [...extra, ...chosen];
}

function renderCheckpoint() {
  $("checkpoint-msg").textContent = `That's ${state.total} problems so far. Here's where things stand.`;
  skillRows($("checkpoint-skills"), touchedOrChosen());
}

function endSession() {
  if (state.tracer) saveProfile(state.name, state.tracer.exportProfile());
  const t = state.total;
  $("end-msg").textContent = t === 0
    ? "No problems done this time. See you next time."
    : `You worked through ${t} problem${t === 1 ? "" : "s"} and got ${state.firstTry} right on the first try without a hint.`;
  const gained = state.scope.filter(s => state.startMastery[s] < 0.8 && state.tracer.masteryMean(s) >= 0.8);
  const closer = state.scope.filter(s => !gained.includes(s) && state.tracer.masteryMean(s) - state.startMastery[s] >= 0.1);
  const again = Object.entries(state.misses).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s)
    .filter(s => state.tracer.masteryMean(s) < 0.8);
  const box = $("end-list"); box.innerHTML = "";
  const block = (title, sids) => {
    if (!sids.length) return;
    const h = document.createElement("h3"); h.textContent = title;
    const ul = document.createElement("ul"); ul.className = "skills";
    box.append(h, ul); skillRows(ul, sids);
  };
  block("New today", gained);
  block("Getting closer", closer);
  block("Worth another look next time", again);
  show("end");
}

// --- wiring ----------------------------------------------------------------------------

$("name").addEventListener("input", refreshWelcome);
$("start-form").addEventListener("submit", e => { e.preventDefault(); startSession(); });
$("fresh").addEventListener("click", () => { clearProfile($("name").value); refreshWelcome(); });

$("check-form").addEventListener("submit", e => {
  e.preventDefault();
  const item = state.check.items[state.check.i], res = gradeResponse(item, $("check-answer").value);
  if (res.status === "empty") { $("check-note").textContent = "Type an answer, or tap Not sure."; $("check-note").hidden = false; return; }
  recordCheck(res.status === "right" || res.status === "almost");
});
$("check-skip").addEventListener("click", () => recordCheck(false));
$("placed-go").addEventListener("click", () => { show("practice"); renderItem(); });

$("answer-form").addEventListener("submit", e => { e.preventDefault(); onCheck(); });
$("hint").addEventListener("click", onHint);
$("show-steps").addEventListener("click", () => { revealStep(lesson(state.item).steps.length - 1); $("show-steps").hidden = true; });
$("next").addEventListener("click", proceed);
$("done").addEventListener("click", endSession);

$("resume").addEventListener("click", endBreak);
$("keep-going").addEventListener("click", continuePractice);
$("cp-break").addEventListener("click", () => showBreak("student"));
$("restart").addEventListener("click", () => { show("start"); refreshWelcome(); });

// open with ?debug to inspect the session from the browser console as window.lilt
if (new URLSearchParams(location.search).has("debug")) window.lilt = state;

buildGradeChips();
buildTopics();
show("start");

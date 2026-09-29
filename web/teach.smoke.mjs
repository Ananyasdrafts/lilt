// A smoke test for the teaching layer and the placement check, run with:
//   node web/teach.smoke.mjs
// For every generator it checks that each item parses, that the worked steps
// recompute the engine's answer on their own, that the engine's answer grades as
// right, and that the answer only shows up in the last step. Then it checks a few
// known wrong answers get the right diagnosis, and that placement starts a strong
// student at their grade and a struggling one a level down.

import { SKILLS, SKILL_LIST, generateItem, mulberry32, Tracer, Tutor, buildScope } from "./engine.js";
import { lesson, grade } from "./teach.js";
import { placementSkills, priorFromPlacement, chosenSkills, practiceOrder } from "./placement.js";

let fails = 0;
const fail = (...msg) => { fails++; if (fails <= 40) console.log("  FAIL", ...msg); };
const MINUS = "−";

// --- every generated item -------------------------------------------------------

const rng = mulberry32(7);
let total = 0;
for (const sid of Object.keys(SKILLS)) {
  for (let i = 0; i < 300; i++) {
    const it = generateItem(sid, i / 299, rng), L = lesson(it);
    total++;
    if (!L.ok) { fail(sid, "does not parse:", it.prompt); continue; }
    if (L.answer !== it.answer) fail(sid, "steps give", L.answer, "engine says", it.answer, "|", it.prompt);
    if (grade(it, it.answer).status !== "right") fail(sid, "engine answer not graded right:", it.answer, "|", it.prompt);
    const last = L.steps[L.steps.length - 1], shown = it.answer.replace(/^-/, MINUS);
    if (!last.includes(shown) && !last.includes(it.answer)) fail(sid, "last step does not state the answer:", last);
    for (const s of L.steps) if (/undefined|NaN|Infinity|\[object/.test(s)) fail(sid, "bad step text:", s);
    if (/[–—]/.test(L.display + L.steps.join(" "))) fail(sid, "dash in text");
  }
}
console.log(`teaching self-check: ${total} items across ${Object.keys(SKILLS).length} skills`);

// --- grading and diagnosis ------------------------------------------------------

const item = (skillId, prompt, answer) => ({ skillId, prompt, answer, difficulty: 0, level: 0.5 });
const expect = (it, response, status, noteHas) => {
  const g = grade(it, response);
  if (g.status !== status) return fail(it.skillId, `"${response}" graded ${g.status}, expected ${status}`);
  if (noteHas && !(g.note || "").includes(noteHas)) fail(it.skillId, `"${response}" note was "${g.note}", expected it to mention "${noteHas}"`);
};

const eq = item("fraction_equiv", "Write 4/12 in simplest form.", "1/3");
expect(eq, "1/3", "right");
expect(eq, " 1 / 3 ", "right");
expect(eq, "2/6", "almost", "simplest form");
expect(eq, "3/1", "wrong", "upside down");
expect(eq, "", "empty");

const add = item("fraction_add_sub", "1/4 + 1/4 = ?  (simplest form)", "1/2");
expect(add, "2/8", "wrong", "bottoms too");
expect(add, "2/4", "almost");

const div = item("fraction_mul_div", "2/3 / 4/5 = ?  (simplest form)", "5/6");
expect(div, "8/15", "wrong", "without flipping");

const int = item("integer_add_sub", "-4 - (-23) = ?", "19");
expect(int, "-19", "wrong", "wrong sign");
expect(int, "−19", "wrong", "wrong sign");
expect(int, "-27", "wrong", "added instead");

const ratio = item("ratios", "A mix uses 6 parts red to 12 parts blue. Write the ratio of red to blue in simplest form (a:b).", "1:2");
expect(ratio, "2:1", "wrong", "blue to red");
expect(ratio, "3:6", "almost", "simplified");
expect(ratio, "1/2", "almost", "colon");

const like = item("combine_like_terms", "Simplify: 2x + 5 + 3x + 7", "5x + 12");
expect(like, "12 + 5x", "right");
expect(like, "5x+12", "right");
expect(like, "17", "wrong", "can't be added");
expect(like, "5x + 11", "wrong", "x part is right");

const order = item("evaluate_expr", "Evaluate 2 + 3 x 4", "14");
expect(order, "20", "wrong", "left to right");

const pow = item("exponents", "Evaluate 3^4", "81");
expect(pow, "12", "wrong", "how many copies");

const rules = item("exponent_rules", "2^3 * 2^4 = 2^?   (give the exponent)", "7");
expect(rules, "12", "wrong", "add the exponents");
expect(rules, "128", "wrong", "only wants the exponent");

const two = item("two_step_eq", "Solve for x:  3x + 4 = 19", "5");
expect(two, "23/3", "wrong");
expect(two, "15", "wrong", "divide by 3");

const sale = item("percent_apps", "A $40 item is 25% off. What is the sale price, in dollars?", "30");
expect(sale, "$30", "right");
expect(sale, "30.00", "right");
expect(sale, "10", "wrong", "discount itself");

const gcf = item("gcf_lcm", "Find the GCF of 12 and 18.", "6");
expect(gcf, "36", "wrong", "least common multiple");
expect(gcf, "3", "wrong", "bigger number");
console.log("grading and diagnosis checked");

// --- placement ------------------------------------------------------------------

for (const g of [6, 7, 8]) {
  const tops = placementSkills(g, "All");
  if (!tops.length || tops.length > 6) fail("placement grade", g, "asks", tops.length, "questions");
  for (const s of tops) if (SKILLS[s].grade !== g) fail("placement grade", g, "asks about", s);
}

function firstSkill(grade, results) {
  let scope = buildScope(grade);
  const prior = priorFromPlacement(scope, grade, "All", results);
  scope = practiceOrder(scope, prior);
  const tutor = new Tutor({ grade, scope, estimator: new Tracer(300, 3, prior), seed: 3 });
  return tutor.start().skillId;
}

for (const g of [6, 7, 8]) {
  const tops = placementSkills(g, "All");
  const allPass = firstSkill(g, tops.map(s => ({ skillId: s, passed: true })));
  if (SKILLS[allPass].grade !== g) fail(`grade ${g}, every check passed: starts on ${allPass} (grade ${SKILLS[allPass].grade})`);
  const missOne = tops[tops.length - 1];
  const start = firstSkill(g, tops.map(s => ({ skillId: s, passed: s !== missOne })));
  const expected = [missOne, ...SKILLS[missOne].prereqs];  // the skill itself when its prerequisites were shown elsewhere
  if (!expected.includes(start)) fail(`grade ${g}, missed ${missOne}: starts on ${start}, expected one of ${expected}`);
}

// missing every check drops one level below each missed skill, not to the bottom
for (const g of [6, 7, 8]) {
  const tops = placementSkills(g, "All");
  const start = firstSkill(g, tops.map(s => ({ skillId: s, passed: false })));
  const oneDown = new Set(tops.flatMap(s => SKILLS[s].prereqs.length ? SKILLS[s].prereqs : [s]));
  if (!oneDown.has(start)) fail(`grade ${g}, every check missed: starts on ${start}, expected one of ${[...oneDown]}`);
}
console.log("placement checked");

// every skill in the list is covered by the teaching layer
for (const s of SKILL_LIST) if (!lesson(generateItem(s.id, 0.5, rng)).ok) fail("no teaching for", s.id);
for (const g of [6, 7, 8]) if (!chosenSkills(g, "All").length) fail("no skills in grade", g);

if (fails > 0) {
  console.log(`TEACH SMOKE FAILED (${fails})`);
  if (typeof process !== "undefined") process.exit(1);
} else console.log("TEACH SMOKE OK");

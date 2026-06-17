// A smoke test for the ported engine, run with: node web/engine.smoke.mjs
// It re-derives the answer for the porting-risk generators (so a porting bug shows
// up), checks the rest produce well-formed output, and runs a full tutor loop.

import { SKILLS, generateItem, checkAnswer, Tutor, mulberry32 } from "./engine.js";

const rng = mulberry32(1);
let total = 0, fails = 0;

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; }

function recheck(it) {
  const { skillId: s, prompt: p, answer: ans } = it;
  if (s === "integer_add_sub") return eval(p.split(" = ")[0].replace(/[()]/g, "")) === Number(ans);
  if (s === "integer_mul_div") return eval(p.split(" = ")[0].replace(/x/g, "*").replace(/[()]/g, "")) === Number(ans);
  if (s === "gcf_lcm") { const m = p.match(/(GCF|LCM) of (\d+) and (\d+)/); const a = +m[2], b = +m[3]; return Number(ans) === (m[1] === "GCF" ? gcd(a, b) : a * b / gcd(a, b)); }
  if (s === "percent") { const pct = +p.match(/(\d+)%/)[1], whole = +p.match(/of (\d+)/)[1]; return Number(ans) === pct * whole / 100; }
  if (s === "exponents") { const m = p.match(/Evaluate (\d+)\^(\d+)/); return Number(ans) === (+m[1]) ** (+m[2]); }
  if (s === "evaluate_expr") return eval(p.replace("Evaluate ", "").replace(/x/g, "*")) === Number(ans);
  if (s === "exponent_rules") { const m = p.match(/(\d+)\^(\d+) ([*/]) \d+\^(\d+)/); return Number(ans) === (m[3] === "*" ? +m[2] + +m[4] : +m[2] - +m[4]); }
  if (s === "combine_like_terms") { const body = p.split("Simplify:")[1]; let cx = 0, kk = 0; for (let t of body.split("+")) { t = t.trim(); if (t.endsWith("x")) cx += +t.slice(0, -1); else kk += +t; } return ans === `${cx}x + ${kk}`; }
  if (["one_step_eq", "two_step_eq", "multi_step_eq"].includes(s)) {
    const x = +ans, body = p.split("Solve for x:")[1], [lhs, rhs] = body.split("=");
    const sub = side => eval(side.replace(/(\d+)x/g, (_, c) => `(${c}*${x})`).replace(/\s/g, ""));
    return sub(lhs) === sub(rhs);
  }
  if (s === "proportions") return /^-?\d+$/.test(ans);
  // ratios / fractions / decimals / unit_rate: format-only check
  return ans.length > 0 && checkAnswer(it, ans);
}

for (const sid of Object.keys(SKILLS)) {
  for (let i = 0; i < 40; i++) {
    const it = generateItem(sid, [0.1, 0.5, 0.9][i % 3], rng);
    total++;
    if (!recheck(it)) { fails++; if (fails <= 8) console.log("  MISMATCH", sid, "|", it.prompt, "->", it.answer); }
  }
}
console.log(`item self-check: ${total - fails}/${total} correct`);

// a full tutor loop driven by a crude internal student, just to confirm it runs and
// the belief moves
const t = new Tutor({ grade: 6, seed: 0, nParticles: 200 });
let item = t.start();
const actions = {};
const srng = mulberry32(99);
for (let i = 0; i < 150; i++) {
  const correct = srng() < 0.72;
  const obs = { correct, responseTime: 2 + srng() * 4, helpRequested: srng() < 0.1, skillId: item.skillId, itemDifficulty: item.difficulty };
  const d = t.observe(obs);
  actions[d.action] = (actions[d.action] || 0) + 1;
  if (d.action === "break") { /* the app would let the student rest here */ }
  item = d.item;
}
const bel = t.tracer.belief();
const best = Math.max(...Object.values(bel.mastery));
console.log("tutor loop actions:", actions);
console.log("best mastery belief:", best.toFixed(3), " attention:", bel.attention.toFixed(3));

if (fails > 0) { console.log("SMOKE FAILED"); process.exit(1); }
console.log("SMOKE OK");

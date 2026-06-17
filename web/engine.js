// engine.js - the Lilt engine in the browser.
//
// A faithful port of the Python package: the same middle-school math skill graph and
// item generators (items.py), the same particle filter over knowledge, attention, and
// frustration (tracing.py), and the same policy (tutor.py). The point of the port is
// that the engine is identical whether its inputs come from the simulator or from a
// real student: both produce { correct, responseTime, helpRequested } per step, so the
// app in the next phase runs this same code live on a real student's answers.
//
// The Python side stays the source of truth and is what the honest evaluation runs
// against; this file mirrors it.

// --- small math + rng helpers ---------------------------------------------

function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; }

// a seedable PRNG (mulberry32) so sessions are reproducible
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function ri(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo)); }  // [lo, hi)
function uni(rng, lo, hi) { return lo + rng() * (hi - lo); }
function choice(rng, arr) { return arr[ri(rng, 0, arr.length)]; }
function norm(rng, mu, sig) {
  const u = 1 - rng(), v = 1 - rng();
  return mu + sig * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// fractions as [num, den]
function frac(n, d) { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); return [n / g, d / g]; }
function fAdd(a, b) { return frac(a[0] * b[1] + b[0] * a[1], a[1] * b[1]); }
function fSub(a, b) { return frac(a[0] * b[1] - b[0] * a[1], a[1] * b[1]); }
function fMul(a, b) { return frac(a[0] * b[0], a[1] * b[1]); }
function fDiv(a, b) { return frac(a[0] * b[1], a[1] * b[0]); }
function fmtFrac(f) { return f[1] === 1 ? String(f[0]) : `${f[0]}/${f[1]}`; }
function fmtMoney(v) { return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2); }

// --- the skill graph, by grade and topic -----------------------------------

export const NUMBER_SYSTEM = "Number System";
export const RATIOS = "Ratios and Proportions";
export const EXPRESSIONS = "Expressions and Equations";
export const TOPIC_ORDER = [NUMBER_SYSTEM, RATIOS, EXPRESSIONS];
export const LEVEL_SPREAD = 2.0;

export const SKILL_LIST = [
  { id: "fraction_equiv", name: "Equivalent fractions and simplifying", grade: 6, topic: NUMBER_SYSTEM, prereqs: [], difficulty: -1.2 },
  { id: "fraction_add_sub", name: "Adding and subtracting fractions", grade: 6, topic: NUMBER_SYSTEM, prereqs: ["fraction_equiv"], difficulty: -0.6 },
  { id: "fraction_mul_div", name: "Multiplying and dividing fractions", grade: 6, topic: NUMBER_SYSTEM, prereqs: ["fraction_equiv"], difficulty: -0.4 },
  { id: "decimals_ops", name: "Decimal arithmetic", grade: 6, topic: NUMBER_SYSTEM, prereqs: [], difficulty: -0.6 },
  { id: "gcf_lcm", name: "Greatest common factor and least common multiple", grade: 6, topic: NUMBER_SYSTEM, prereqs: [], difficulty: -0.5 },
  { id: "ratios", name: "Ratios", grade: 6, topic: RATIOS, prereqs: ["fraction_equiv"], difficulty: -0.2 },
  { id: "unit_rate", name: "Unit rates", grade: 6, topic: RATIOS, prereqs: ["ratios", "fraction_mul_div"], difficulty: 0.1 },
  { id: "percent", name: "Percentages", grade: 6, topic: RATIOS, prereqs: ["fraction_mul_div", "decimals_ops"], difficulty: 0.3 },
  { id: "exponents", name: "Whole-number exponents", grade: 6, topic: EXPRESSIONS, prereqs: [], difficulty: -0.3 },
  { id: "evaluate_expr", name: "Order of operations", grade: 6, topic: EXPRESSIONS, prereqs: ["exponents"], difficulty: 0.0 },
  { id: "one_step_eq", name: "One-step equations", grade: 6, topic: EXPRESSIONS, prereqs: ["fraction_mul_div"], difficulty: 0.3 },
  { id: "integer_add_sub", name: "Adding and subtracting integers", grade: 7, topic: NUMBER_SYSTEM, prereqs: [], difficulty: -0.8 },
  { id: "integer_mul_div", name: "Multiplying and dividing integers", grade: 7, topic: NUMBER_SYSTEM, prereqs: ["integer_add_sub"], difficulty: -0.4 },
  { id: "proportions", name: "Solving proportions", grade: 7, topic: RATIOS, prereqs: ["unit_rate", "one_step_eq"], difficulty: 0.7 },
  { id: "percent_apps", name: "Percent applications (tax, tip, discount)", grade: 7, topic: RATIOS, prereqs: ["percent"], difficulty: 0.8 },
  { id: "combine_like_terms", name: "Combining like terms", grade: 7, topic: EXPRESSIONS, prereqs: ["evaluate_expr"], difficulty: 0.5 },
  { id: "two_step_eq", name: "Two-step equations", grade: 7, topic: EXPRESSIONS, prereqs: ["one_step_eq", "combine_like_terms", "integer_add_sub"], difficulty: 0.9 },
  { id: "exponent_rules", name: "Laws of exponents", grade: 8, topic: EXPRESSIONS, prereqs: ["exponents"], difficulty: 0.7 },
  { id: "multi_step_eq", name: "Equations with variables on both sides", grade: 8, topic: EXPRESSIONS, prereqs: ["two_step_eq"], difficulty: 1.2 },
];

export const SKILLS = Object.fromEntries(SKILL_LIST.map(s => [s.id, s]));
export const GRADES = [...new Set(SKILL_LIST.map(s => s.grade))].sort((a, b) => a - b);

export function skillsInGrade(g) { return SKILL_LIST.filter(s => s.grade === g).map(s => s.id); }
export function skillsInTopic(t) { return SKILL_LIST.filter(s => s.topic === t).map(s => s.id); }
export function topicsInGrade(g) {
  const present = new Set(SKILL_LIST.filter(s => s.grade === g).map(s => s.topic));
  return TOPIC_ORDER.filter(t => present.has(t));
}
export function topologicalOrder() {
  const order = [], seen = new Set();
  const visit = sid => { if (seen.has(sid)) return; seen.add(sid); for (const p of SKILLS[sid].prereqs) visit(p); order.push(sid); };
  for (const s of SKILL_LIST) visit(s.id);
  return order;
}
export function allPrerequisites(sid) {
  const out = new Set();
  for (const p of SKILLS[sid].prereqs) { out.add(p); for (const q of allPrerequisites(p)) out.add(q); }
  return out;
}

// --- procedural item generators -------------------------------------------

function mag(level, lo, hi) { return Math.round(lo + (hi - lo) * level); }
function randFraction(rng, maxDen) { const den = ri(rng, 2, maxDen + 1); return frac(ri(rng, 1, den * 2), den); }

const GENERATORS = {
  integer_add_sub(level, rng) {
    const cap = mag(level, 9, 99), a = ri(rng, -cap, cap + 1), b = ri(rng, -cap, cap + 1);
    const op = choice(rng, ["+", "-"]); const ans = op === "+" ? a + b : a - b;
    return [`${a} ${op} ${b < 0 ? `(${b})` : b} = ?`, String(ans)];
  },
  integer_mul_div(level, rng) {
    const cap = mag(level, 6, 20);
    if (rng() < 0.5) { const a = ri(rng, -cap, cap + 1), b = ri(rng, -cap, cap + 1); return [`${a < 0 ? `(${a})` : a} x ${b < 0 ? `(${b})` : b} = ?`, String(a * b)]; }
    const pool = []; for (let n = -cap; n <= cap; n++) if (n !== 0) pool.push(n);
    const b = choice(rng, pool), q = ri(rng, -cap, cap + 1);
    return [`${b * q} / ${b < 0 ? `(${b})` : b} = ?`, String(q)];
  },
  fraction_equiv(level, rng) {
    const base = randFraction(rng, mag(level, 6, 12)), factor = ri(rng, 2, mag(level, 4, 9) + 1);
    const num = base[0] * factor, den = base[1] * factor;
    return [`Write ${num}/${den} in simplest form.`, fmtFrac(frac(num, den))];
  },
  fraction_add_sub(level, rng) {
    const maxDen = mag(level, 4, 12); let a, b;
    if (level < 0.5) { const den = ri(rng, 2, maxDen + 1); a = frac(ri(rng, 1, den), den); b = frac(ri(rng, 1, den), den); }
    else { a = randFraction(rng, maxDen); b = randFraction(rng, maxDen); }
    const op = choice(rng, ["+", "-"]); const ans = op === "+" ? fAdd(a, b) : fSub(a, b);
    return [`${fmtFrac(a)} ${op} ${fmtFrac(b)} = ?  (simplest form)`, fmtFrac(ans)];
  },
  fraction_mul_div(level, rng) {
    const maxDen = mag(level, 4, 10), a = randFraction(rng, maxDen), b = randFraction(rng, maxDen);
    const op = choice(rng, ["x", "/"]); const ans = op === "x" ? fMul(a, b) : fDiv(a, b);
    return [`${fmtFrac(a)} ${op} ${fmtFrac(b)} = ?  (simplest form)`, fmtFrac(ans)];
  },
  decimals_ops(level, rng) {
    const places = level < 0.5 ? 1 : 2, scale = 10 ** places, cap = mag(level, 50, 500);
    const a = ri(rng, 1, cap) / scale, b = ri(rng, 1, cap) / scale, op = choice(rng, ["+", "-"]);
    const ans = Number((op === "+" ? a + b : a - b).toFixed(places));
    return [`${a.toFixed(places)} ${op} ${b.toFixed(places)} = ?`, ans.toFixed(places)];
  },
  gcf_lcm(level, rng) {
    const a = ri(rng, 2, mag(level, 14, 40) + 1), b = ri(rng, 2, mag(level, 14, 40) + 1);
    if (rng() < 0.5) return [`Find the GCF of ${a} and ${b}.`, String(gcd(a, b))];
    return [`Find the LCM of ${a} and ${b}.`, String(a * b / gcd(a, b))];
  },
  ratios(level, rng) {
    const a = ri(rng, 2, mag(level, 5, 9) + 1), b = ri(rng, 2, mag(level, 5, 9) + 1), factor = ri(rng, 2, mag(level, 4, 9) + 1), g = gcd(a, b);
    return [`A mix uses ${a * factor} parts red to ${b * factor} parts blue. Write the ratio of red to blue in simplest form (a:b).`, `${a / g}:${b / g}`];
  },
  unit_rate(level, rng) {
    const rate = ri(rng, 2, mag(level, 6, 15) + 1), qty = ri(rng, 2, mag(level, 5, 12) + 1);
    return [`${rate * qty} dollars for ${qty} pounds. What is the price per pound, in dollars?`, String(rate)];
  },
  percent(level, rng) {
    const pct = choice(rng, [10, 20, 25, 50, 5, 15, 40, 75]), whole = ri(rng, 2, mag(level, 10, 40) + 1) * 4;
    return [`What is ${pct}% of ${whole}?`, fmtMoney(pct * whole / 100)];
  },
  percent_apps(level, rng) {
    const price = ri(rng, 10, mag(level, 40, 120) + 1), rate = choice(rng, [5, 10, 15, 20, 25]);
    if (rng() < 0.5) return [`A $${price} item is ${rate}% off. What is the sale price, in dollars?`, fmtMoney(price * (1 - rate / 100))];
    const kind = choice(rng, ["tax", "tip"]);
    return [`A $${price} bill with a ${rate}% ${kind}. What is the total, in dollars?`, fmtMoney(price * (1 + rate / 100))];
  },
  exponents(level, rng) {
    const base = ri(rng, 2, mag(level, 5, 9) + 1), power = 2 + Math.round(level * 2);
    return [`Evaluate ${base}^${power}`, String(base ** power)];
  },
  evaluate_expr(level, rng) {
    const cap = mag(level, 5, 12), a = ri(rng, 2, cap + 1), b = ri(rng, 2, cap + 1), c = ri(rng, 2, cap + 1);
    if (level < 0.5) return [`Evaluate ${a} + ${b} x ${c}`, String(a + b * c)];
    return [`Evaluate ${a} x (${b} + ${c})`, String(a * (b + c))];
  },
  combine_like_terms(level, rng) {
    const c1 = ri(rng, 1, mag(level, 4, 9) + 1), c2 = ri(rng, 1, mag(level, 4, 9) + 1), k1 = ri(rng, 1, mag(level, 6, 15) + 1), k2 = ri(rng, 0, mag(level, 6, 15) + 1);
    return [`Simplify: ${c1}x + ${k1} + ${c2}x + ${k2}`, `${c1 + c2}x + ${k1 + k2}`];
  },
  exponent_rules(level, rng) {
    const base = choice(rng, [2, 3, 5, 10]); let m = ri(rng, 2, 5), n = ri(rng, 2, 5);
    if (level >= 0.5 && rng() < 0.5) { if (m <= n) { const om = m; m = n + 1; n = om; } return [`${base}^${m} / ${base}^${n} = ${base}^?   (give the exponent)`, String(m - n)]; }
    return [`${base}^${m} * ${base}^${n} = ${base}^?   (give the exponent)`, String(m + n)];
  },
  one_step_eq(level, rng) {
    const cap = mag(level, 8, 20), x = ri(rng, 0, cap + 1);
    if (rng() < 0.5) { const k = ri(rng, 1, mag(level, 9, 20) + 1); return [`Solve for x:  x + ${k} = ${x + k}`, String(x)]; }
    const m = ri(rng, 2, mag(level, 5, 9) + 1); return [`Solve for x:  ${m}x = ${m * x}`, String(x)];
  },
  two_step_eq(level, rng) {
    const x = ri(rng, -mag(level, 6, 15), mag(level, 6, 15) + 1), m = ri(rng, 2, mag(level, 5, 9) + 1), k = ri(rng, 1, mag(level, 9, 20) + 1), op = choice(rng, ["+", "-"]);
    const rhs = op === "+" ? m * x + k : m * x - k;
    return [`Solve for x:  ${m}x ${op} ${k} = ${rhs}`, String(x)];
  },
  multi_step_eq(level, rng) {
    const x = ri(rng, 1, mag(level, 6, 15) + 1), a = ri(rng, 3, mag(level, 6, 10) + 1), b = ri(rng, 1, a), c = ri(rng, 1, mag(level, 8, 20) + 1);
    const d = (a - b) * x + c;
    return [`Solve for x:  ${a}x + ${c} = ${b}x + ${d}`, String(x)];
  },
  proportions(level, rng) {
    const a = ri(rng, 2, mag(level, 5, 9) + 1), b = ri(rng, 2, mag(level, 5, 9) + 1), k = ri(rng, 2, mag(level, 5, 10) + 1);
    return [`Solve for x:  ${a}/${b} = ${a * k}/x`, String(b * k)];
  },
};

export function itemDifficulty(skillId, level) { return SKILLS[skillId].difficulty + (level - 0.5) * LEVEL_SPREAD; }

export function generateItem(skillId, level, rng) {
  level = clamp(level, 0, 1);
  const [prompt, answer] = GENERATORS[skillId](level, rng);
  return { skillId, difficulty: itemDifficulty(skillId, level), prompt, answer, level };
}

// grade a free-text response against an item's answer
export function checkAnswer(item, response) {
  const a = String(item.answer).trim(), r = String(response).trim();
  if (a === r) return true;
  if (a.includes(":")) {
    const simp = x => { const [p, q] = x.split(":").map(Number); if (!q) return x; const g = gcd(p, q); return `${p / g}:${q / g}`; };
    return simp(a) === simp(r);
  }
  if (/x/.test(a)) return a.replace(/\s+/g, "") === r.replace(/\s+/g, "");
  const num = s => { s = s.trim(); if (/^-?\d+\/-?\d+$/.test(s)) { const [n, d] = s.split("/").map(Number); return n / d; } return /^-?\d*\.?\d+$/.test(s) ? Number(s) : null; };
  const na = num(a), nr = num(r);
  return na !== null && nr !== null && Math.abs(na - nr) < 1e-6;
}

// --- the belief filter -----------------------------------------------------

const KNOW_SCALE = 4.0, DISCRIM = 1.0, SLIP_MAX = 0.45, FRUST_PEN = 0.35, BOREDOM_DECAY = 0.04;
const RT_BASE = 1.4, RT_EFFORT = 0.9, RT_HASTE = 0.7, RT_SIGMA = 0.35, RT_FRUST_VAR = 0.6;
const HELP_BASE = 0.02, HELP_CONFUSION = 0.35, HELP_FRUST = 0.25, HELP_DISENGAGE = 0.30;
const sigmoid = z => 1 / (1 + Math.exp(-z));

export class Tracer {
  constructor(nParticles = 500, seed = 12345) {
    this.rng = mulberry32(seed >>> 0); this.n = nParticles;
    this.skillIds = SKILL_LIST.map(s => s.id);
    this.idx = {}; this.skillIds.forEach((s, i) => this.idx[s] = i);
    this.S = this.skillIds.length;
    const r = this.rng, n = this.n;
    const fill = f => Float64Array.from({ length: n }, f);
    this.ability = fill(() => norm(r, 0, 0.8));
    this.learnRate = fill(() => uni(r, 0.12, 0.26));
    this.distract = fill(() => uni(r, 0.03, 0.16));
    this.attnRecover = fill(() => uni(r, 0.45, 0.70));
    this.frustGain = fill(() => uni(r, 0.08, 0.24));
    this.frustRecover = fill(() => uni(r, 0.12, 0.24));
    this.mastery = Array.from({ length: n }, () => Float64Array.from({ length: this.S }, () => clamp(norm(r, 0.12, 0.08), 0.01, 0.99)));
    this.attention = fill(() => clamp(norm(r, 0.95, 0.05), 0, 1));
    this.frustration = fill(() => clamp(norm(r, 0.05, 0.05), 0, 1));
    this.weights = fill(() => 1 / n);
  }

  observe(obs) {
    const i = this.idx[obs.skillId], b = obs.itemDifficulty, n = this.n;
    const lik = new Float64Array(n); let total = 0;
    for (let p = 0; p < n; p++) {
      const m = this.mastery[p][i], a = this.attention[p], f = this.frustration[p];
      const theta = this.ability[p] + KNOW_SCALE * (m - 0.5);
      let pc = sigmoid(DISCRIM * (theta - b)); pc *= (1 - SLIP_MAX * (1 - a)) * (1 - FRUST_PEN * f); pc = clamp(pc, 0.01, 0.99);
      let l = obs.correct ? pc : (1 - pc);
      const mu = RT_BASE + RT_EFFORT * (1 - m) - RT_HASTE * (1 - a), sigma = RT_SIGMA + RT_FRUST_VAR * f;
      const z = (Math.log(obs.responseTime) - mu) / sigma;
      l *= Math.exp(-0.5 * z * z) / (obs.responseTime * sigma * Math.sqrt(2 * Math.PI));
      const ph = clamp(HELP_BASE + HELP_CONFUSION * (1 - m) + HELP_FRUST * f - HELP_DISENGAGE * (1 - a), 0, 0.95);
      l *= obs.helpRequested ? ph : (1 - ph);
      const wp = this.weights[p] * l; lik[p] = wp; total += wp;
    }
    if (total <= 0) { for (let p = 0; p < n; p++) this.weights[p] = 1 / n; }
    else { for (let p = 0; p < n; p++) this.weights[p] = lik[p] / total; }
    let sumsq = 0; for (let p = 0; p < n; p++) sumsq += this.weights[p] * this.weights[p];
    if (1 / sumsq < n / 2) this._resample();
    this._transition(i, b, obs.correct);
  }

  _resample() {
    const n = this.n, r = this.rng, off = r();
    const cumsum = new Float64Array(n); let c = 0;
    for (let p = 0; p < n; p++) { c += this.weights[p]; cumsum[p] = c; } cumsum[n - 1] = 1.0;
    const pick = new Int32Array(n); let j = 0;
    for (let p = 0; p < n; p++) { const pos = (off + p) / n; while (j < n - 1 && pos > cumsum[j]) j++; pick[p] = j; }
    const newM = Array.from({ length: n }, (_, p) => { const src = this.mastery[pick[p]], arr = new Float64Array(this.S); for (let s = 0; s < this.S; s++) arr[s] = clamp(src[s] + norm(r, 0, 0.01), 0, 1); return arr; });
    const re = (src, jit, lo, hi) => { const out = new Float64Array(n); for (let p = 0; p < n; p++) out[p] = lo === undefined ? src[pick[p]] + norm(r, 0, jit) : clamp(src[pick[p]] + norm(r, 0, jit), lo, hi); return out; };
    this.ability = re(this.ability, 0.03);
    this.learnRate = re(this.learnRate, 0.005, 0.05, 0.35);
    this.distract = re(this.distract, 0.005, 0.01, 0.25);
    this.attnRecover = re(this.attnRecover, 0.01, 0.3, 0.8);
    this.frustGain = re(this.frustGain, 0.01, 0.04, 0.3);
    this.frustRecover = re(this.frustRecover, 0.01, 0.08, 0.3);
    this.attention = re(this.attention, 0.02, 0, 1);
    this.frustration = re(this.frustration, 0.02, 0, 1);
    this.mastery = newM;
    for (let p = 0; p < n; p++) this.weights[p] = 1 / n;
  }

  _transition(i, b, correct) {
    const n = this.n, r = this.rng;
    for (let p = 0; p < n; p++) {
      const m = this.mastery[p][i], a = this.attention[p], f = this.frustration[p];
      const engagement = a * (1 - 0.5 * f);
      let mNew = correct ? m + this.learnRate[p] * (1 - m) * engagement : m;
      mNew = clamp(mNew + norm(r, 0, 0.005), 0, 1);
      const theta = this.ability[p] + KNOW_SCALE * (m - 0.5), tooHard = Math.max(0, b - theta) / KNOW_SCALE;
      const fNew = correct ? Math.max(0, f - this.frustRecover[p]) : Math.min(1, f + this.frustGain[p] * (1 + tooHard));
      const decay = this.distract[p] + (theta - b > 1.5 ? BOREDOM_DECAY : 0);
      this.mastery[p][i] = mNew;
      this.frustration[p] = clamp(fNew + norm(r, 0, 0.01), 0, 1);
      this.attention[p] = clamp(a * Math.exp(-decay) + norm(r, 0, 0.01), 0, 1);
    }
  }

  onBreak() {
    for (let p = 0; p < this.n; p++) {
      this.attention[p] = clamp(this.attention[p] + this.attnRecover[p] * (1 - this.attention[p]), 0, 1);
      this.frustration[p] = Math.max(0, this.frustration[p] - this.frustRecover[p]);
    }
  }

  masteryMean(sid) { const i = this.idx[sid]; let s = 0; for (let p = 0; p < this.n; p++) s += this.weights[p] * this.mastery[p][i]; return s; }
  masteryStd(sid) { const i = this.idx[sid], mean = this.masteryMean(sid); let v = 0; for (let p = 0; p < this.n; p++) { const d = this.mastery[p][i] - mean; v += this.weights[p] * d * d; } return Math.sqrt(Math.max(0, v)); }
  attentionMean() { let s = 0; for (let p = 0; p < this.n; p++) s += this.weights[p] * this.attention[p]; return s; }
  frustrationMean() { let s = 0; for (let p = 0; p < this.n; p++) s += this.weights[p] * this.frustration[p]; return s; }
  effectiveTheta(sid) { const i = this.idx[sid]; let s = 0; for (let p = 0; p < this.n; p++) s += this.weights[p] * (this.ability[p] + KNOW_SCALE * (this.mastery[p][i] - 0.5)); return s; }
  belief() { const mastery = {}, std = {}; for (const sid of this.skillIds) { mastery[sid] = this.masteryMean(sid); std[sid] = this.masteryStd(sid); } return { mastery, masteryStd: std, attention: this.attentionMean(), frustration: this.frustrationMean() }; }
}

// --- the policy ------------------------------------------------------------

export const ACTIONS = { ADVANCE: "advance", HOLD: "hold", EASE: "ease", SWITCH: "switch", BREAK: "break", ABSTAIN: "abstain" };
const A = ACTIONS;
const MASTERED = 0.80, UNLOCK = 0.60, BREAK_ATTENTION = 0.30, FRUST_HIGH = 0.55, ATTENTION_LOW = 0.50;
const AMBIGUOUS_STD = 0.18, GOOD_ATTENTION = 0.55, LOW_FRUST = 0.40, MIN_STEPS_BETWEEN_BREAKS = 8, REVIEW_PROB = 0.2;

export function buildScope(grade) {
  let chosen;
  if (grade == null) chosen = new Set(SKILL_LIST.map(s => s.id));
  else { chosen = new Set(skillsInGrade(grade)); for (const sid of [...chosen]) for (const p of allPrerequisites(sid)) chosen.add(p); }
  return topologicalOrder().filter(sid => chosen.has(sid));
}

function levelForTarget(theta, skillId, targetP) {
  const b = theta - Math.log(targetP / (1 - targetP)) / DISCRIM;
  return clamp(0.5 + (b - SKILLS[skillId].difficulty) / LEVEL_SPREAD, 0, 1);
}

export class Tutor {
  constructor({ grade = null, seed = 12345, nParticles = 500, targetP = 0.75, estimator = null } = {}) {
    this.tracer = estimator || new Tracer(nParticles, seed);
    this.rng = mulberry32((seed >>> 0) + 7);
    this.targetP = targetP;
    this.active = null;
    this.stepsSinceBreak = MIN_STEPS_BETWEEN_BREAKS;
    this.scope = buildScope(grade);
  }

  _mastery(sid) { return this.tracer.masteryMean(sid); }
  _unlocked(sid) { return SKILLS[sid].prereqs.every(p => this._mastery(p) >= UNLOCK); }
  _frontier() { return this.scope.filter(sid => this._unlocked(sid) && this._mastery(sid) < MASTERED); }
  _mastered() { return this.scope.filter(sid => this._mastery(sid) >= MASTERED); }
  _pickActive() { const f = this._frontier(); if (f.length) return f[0]; const m = this._mastered(); return m.length ? m[m.length - 1] : this.scope[0]; }
  _makeItem(sid, targetP) { return generateItem(sid, levelForTarget(this.tracer.effectiveTheta(sid), sid, targetP), this.rng); }

  start() { this.active = this._pickActive(); return this._makeItem(this.active, 0.80); }

  observe(obs) {
    this.tracer.observe(obs);
    this.stepsSinceBreak++;
    const attention = this.tracer.attentionMean(), frustration = this.tracer.frustrationMean();
    const std = this.tracer.masteryStd(this.active), mastery = this._mastery(this.active);

    if (attention < BREAK_ATTENTION && this.stepsSinceBreak >= MIN_STEPS_BETWEEN_BREAKS) {
      this.tracer.onBreak(); this.stepsSinceBreak = 0;
      return { action: A.BREAK, item: this._makeItem(this.active, 0.80), feedback: "Let's take a quick breather, then keep going.", activeSkill: this.active };
    }
    if (frustration > FRUST_HIGH)
      return { action: A.EASE, item: this._makeItem(this.active, 0.85), feedback: "That one was tricky. Here is a friendlier one, you've got this.", activeSkill: this.active };
    if (attention < ATTENTION_LOW) {
      const ns = this._noveltySkill(); this.active = ns;
      return { action: A.SWITCH, item: this._makeItem(ns, 0.80), feedback: "Let's try something a bit different.", activeSkill: ns };
    }
    if (!obs.correct && std > AMBIGUOUS_STD)
      return { action: A.ABSTAIN, item: this._makeItem(this.active, this.targetP), feedback: "Let's try one more like that.", activeSkill: this.active };
    if (mastery >= MASTERED && frustration < LOW_FRUST && attention > GOOD_ATTENTION)
      return this._advance();
    return { action: A.HOLD, item: this._makeItem(this.active, this.targetP), feedback: obs.correct ? "Nice, correct." : "Not quite, let's keep at it.", activeSkill: this.active };
  }

  _advance() {
    const m = this._mastered();
    if (m.length && this.rng() < REVIEW_PROB) {
      const rev = m[ri(this.rng, 0, m.length)];
      return { action: A.ADVANCE, item: this._makeItem(rev, this.targetP), feedback: "Quick review to keep it fresh.", activeSkill: rev };
    }
    this.active = this._pickActive();
    return { action: A.ADVANCE, item: this._makeItem(this.active, 0.80), feedback: "You've got that one. Let's move on.", activeSkill: this.active };
  }

  _noveltySkill() {
    const f = this._frontier().filter(s => s !== this.active);
    if (f.length) return f[ri(this.rng, 0, f.length)];
    const m = this._mastered();
    return m.length ? m[ri(this.rng, 0, m.length)] : this.active;
  }
}

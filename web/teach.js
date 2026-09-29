// teach.js - the teaching layer for the Lilt app.
//
// The engine decides what to practice next. This file is what the student learns
// from: a readable version of each problem, a worked solution broken into steps (the
// hint button walks through them one at a time, and the answer only appears in the
// last step), a check that tells "right value, not simplified yet" apart from wrong,
// and a diagnosis of the most common wrong answers for each kind of problem.
//
// Each item is parsed back from its prompt and the steps recompute the answer on
// their own, so teach.smoke.mjs can confirm the worked steps agree with the engine
// for every generator.

import { checkAnswer } from "./engine.js";

// --- helpers ----------------------------------------------------------------

const MINUS = "\u2212", TIMES = "\u00d7", DIVIDE = "\u00f7";
const SUP = "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079";

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; }
const lcm = (a, b) => Math.abs(a * b) / gcd(a, b);
const sup = n => String(n).split("").map(c => SUP[+c]).join("");
const num = n => (n < 0 ? MINUS + (-n) : String(n));          // a number for display
const par = n => (n < 0 ? `(${num(n)})` : String(n));          // wrapped when negative
const opch = op => (op === "-" ? MINUS : op === "+" ? "+" : op === "x" || op === "*" ? TIMES : DIVIDE);
const lc = s => s[0].toLowerCase() + s.slice(1);

function F(s) { const [n, d = "1"] = s.split("/"); return [Number(n), Number(d)]; }
function red([n, d]) { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); return [n / g, d / g]; }
const fstr = ([n, d]) => (d === 1 ? String(n) : `${n}/${d}`);
const fshow = f => num(f[0]) + (f[1] === 1 ? "" : "/" + f[1]);
const money = v => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2));
const close = (a, b) => a !== null && Math.abs(a - b) < 0.005;
const xterm = c => (c === 1 ? "x" : `${c}x`);

// a typed response as a number, accepting fractions and decimals
export function toNumber(s) {
  s = String(s).trim();
  if (/^-?\d+\/-?\d+$/.test(s)) { const [n, d] = s.split("/").map(Number); return d === 0 ? null : n / d; }
  return /^-?\d*\.?\d+$/.test(s) ? Number(s) : null;
}

function factors(n) { const out = []; for (let i = 1; i <= n; i++) if (n % i === 0) out.push(i); return out; }

// --- per-skill teaching -----------------------------------------------------
//
// parse(prompt) -> params, or null if the prompt is not in this skill's format
// show(p)       -> the problem as the student sees it
// solve(p)      -> { answer, steps }, the answer recomputed from the params
// diagnose(p, r, n) -> a short note for a known wrong answer, or null
//                  (r is the normalized response, n is it as a number or null)

const SKILL_TEACH = {
  integer_add_sub: {
    placeholder: "A whole number, like -12",
    parse: p => { const m = p.match(/^(-?\d+) ([+-]) \(?(-?\d+)\)? = \?$/); return m && { a: +m[1], op: m[2], b: +m[3] }; },
    show: ({ a, op, b }) => `${num(a)} ${opch(op)} ${par(b)} = ?`,
    solve(q) {
      const { a, op, b } = q, steps = [];
      const y = op === "-" ? -b : b, sum = a + y;
      if (op === "-") steps.push(`Subtracting a number is the same as adding its opposite, so ${num(a)} ${MINUS} ${par(b)} becomes ${num(a)} + ${par(-b)}.`);
      if (a === 0 || y === 0) steps.push(`Adding 0 changes nothing.`);
      else if ((a < 0) === (y < 0)) steps.push(`Both numbers are ${a < 0 ? "negative" : "positive"}, so add their sizes, ${Math.abs(a)} + ${Math.abs(y)} = ${Math.abs(sum)}, and keep the ${a < 0 ? "negative" : "positive"} sign.`);
      else {
        const hi = Math.max(Math.abs(a), Math.abs(y)), lo = Math.min(Math.abs(a), Math.abs(y));
        const big = Math.abs(a) >= Math.abs(y) ? a : y;
        steps.push(sum === 0
          ? `The signs are different and the sizes match, so they cancel out.`
          : `The signs are different, so subtract the smaller size from the larger: ${hi} ${MINUS} ${lo} = ${hi - lo}. The answer takes the sign of ${num(big)}, the one with the larger size.`);
      }
      steps.push(`So ${this.show(q).replace(" = ?", "")} = ${num(sum)}.`);
      return { answer: String(sum), steps };
    },
    diagnose({ a, op, b }, r, n) {
      const ans = op === "-" ? a - b : a + b;
      if (n === -ans && ans !== 0) return "Right size, wrong sign. The answer takes the sign of the number with the larger size.";
      if (op === "-" && n === a + b) return "It looks like you added instead of subtracting. Subtracting means adding the opposite.";
      if (op === "+" && n === a - b) return "It looks like you subtracted. This one is adding.";
      return null;
    },
  },

  integer_mul_div: {
    placeholder: "A whole number, like -24",
    parse: p => { const m = p.match(/^\(?(-?\d+)\)? (x|\/) \(?(-?\d+)\)? = \?$/); return m && { a: +m[1], op: m[2], b: +m[3] }; },
    show: ({ a, op, b }) => `${par(a)} ${opch(op)} ${par(b)} = ?`,
    solve(q) {
      const { a, op, b } = q, v = op === "x" ? a * b : a / b, steps = [];
      if (a === 0 || (op === "x" && b === 0)) steps.push(op === "x" ? `Anything times 0 is 0.` : `0 divided by any number is 0.`);
      else {
        steps.push(`Ignore the signs first: ${Math.abs(a)} ${opch(op)} ${Math.abs(b)} = ${Math.abs(v)}.`);
        steps.push((a < 0) === (b < 0)
          ? `The signs are the same, so the answer is positive.`
          : `The signs are different, so the answer is negative.`);
      }
      steps.push(`So ${this.show(q).replace(" = ?", "")} = ${num(v)}.`);
      return { answer: String(v), steps };
    },
    diagnose({ a, op, b }, r, n) {
      const ans = op === "x" ? a * b : a / b;
      if (n === -ans && ans !== 0) return "Right size, wrong sign. Same signs give a positive answer, different signs give a negative one.";
      if (op === "/" && n === a * b) return "That's multiplying. This one is dividing.";
      return null;
    },
  },

  fraction_equiv: {
    placeholder: "A fraction, like 3/4",
    parse: p => { const m = p.match(/^Write (\d+)\/(\d+) in simplest form\.$/); return m && { n: +m[1], d: +m[2] }; },
    show: ({ n, d }) => `Write ${n}/${d} in simplest form.`,
    solve({ n, d }) {
      const g = gcd(n, d), f = [n / g, d / g];
      const steps = [
        `Find the largest number that divides both ${n} and ${d}. That's ${g}.`,
        `Divide the top and the bottom by ${g}: ${n} ${DIVIDE} ${g} = ${f[0]} and ${d} ${DIVIDE} ${g} = ${f[1]}.`,
        f[1] === 1 ? `${f[0]}/1 is just ${f[0]}, so ${n}/${d} = ${f[0]}.` : `So ${n}/${d} = ${fstr(f)}.`,
      ];
      return { answer: fstr(f), steps };
    },
    diagnose({ n, d }, r) {
      if (!/^\d+\/\d+$/.test(r)) return null;
      const [rn, rd] = F(r);
      if (rn * n === rd * d || (rn === d && rd === n)) return "That's upside down. The top number stays on top.";
      return "Whatever you divide the top by, divide the bottom by the same number, so the value stays the same.";
    },
  },

  fraction_add_sub: {
    placeholder: "A fraction, like 3/4",
    parse: p => { const m = p.match(/^(-?\d+(?:\/\d+)?) ([+-]) (-?\d+(?:\/\d+)?) = \?\s+\(simplest form\)$/); return m && { A: F(m[1]), op: m[2], B: F(m[3]) }; },
    show: ({ A, op, B }) => `${fshow(A)} ${opch(op)} ${fshow(B)} = ?`,
    solve(q) {
      const { A, op, B } = q, L = lcm(A[1], B[1]), steps = [];
      const na = A[0] * (L / A[1]), nb = B[0] * (L / B[1]);
      if (A[1] === B[1]) steps.push(`The bottoms already match (${L}), so you only need to ${op === "+" ? "add" : "subtract"} the tops.`);
      else {
        steps.push(`The bottoms are different, so find a common one. The smallest number both ${A[1]} and ${B[1]} go into is ${L}.`);
        steps.push(`Rewrite both over ${L}: ${fshow(A)} = ${num(na)}/${L} and ${fshow(B)} = ${num(nb)}/${L}.`);
      }
      const top = op === "+" ? na + nb : na - nb, f = red([top, L]);
      steps.push(`${op === "+" ? "Add" : "Subtract"} the tops and keep the bottom: ${num(na)} ${opch(op)} ${par(nb)} = ${num(top)}, which gives ${num(top)}/${L}.`);
      if (f[1] !== L) steps.push(top === 0 ? `0 over anything is 0.` : `Simplify: ${Math.abs(top)} and ${L} share a factor of ${gcd(top, L)}, so ${num(top)}/${L} = ${fshow(f)}.`);
      steps.push(`So ${this.show(q).replace(" = ?", "")} = ${fshow(f)}.`);
      return { answer: fstr(f), steps };
    },
    diagnose({ A, op, B }, r, n) {
      if (n === null) return null;
      const ans = op === "+" ? A[0] / A[1] + B[0] / B[1] : A[0] / A[1] - B[0] / B[1];
      const botSum = A[1] + B[1], topSum = op === "+" ? A[0] + B[0] : A[0] - B[0];
      if (Math.abs(n - topSum / botSum) < 1e-9) return `It looks like you ${op === "+" ? "added" : "subtracted"} the bottoms too. Once the bottoms match, only the tops change; the bottom stays the same.`;
      if (ans !== 0 && Math.abs(n + ans) < 1e-9) return "Right size, wrong sign. Check which fraction is bigger.";
      if (A[1] !== B[1] && Math.abs(n - topSum / lcm(A[1], B[1])) < 1e-9) return "Before you combine the tops, rewrite each fraction over the common bottom. The tops change when you do.";
      return null;
    },
  },

  fraction_mul_div: {
    placeholder: "A fraction, like 3/4",
    parse: p => { const m = p.match(/^(-?\d+(?:\/\d+)?) (x|\/) (-?\d+(?:\/\d+)?) = \?\s+\(simplest form\)$/); return m && { A: F(m[1]), op: m[2], B: F(m[3]) }; },
    show: ({ A, op, B }) => `${fshow(A)} ${opch(op)} ${fshow(B)} = ?`,
    solve(q) {
      const { A, op, B } = q, steps = [];
      const whole = [A, B].filter(f => f[1] === 1);
      if (whole.length) steps.push(`A whole number is itself over 1, so ${whole.map(f => `${f[0]} = ${f[0]}/1`).join(" and ")}.`);
      let C = B;
      if (op === "/") {
        C = [B[1], B[0]];
        steps.push(`Dividing by a fraction is the same as multiplying by its flip. The flip of ${B[0]}/${B[1]} is ${C[0]}/${C[1]}, so this becomes ${A[0]}/${A[1]} ${TIMES} ${C[0]}/${C[1]}.`);
      }
      const N = A[0] * C[0], D = A[1] * C[1], f = red([N, D]);
      steps.push(`Multiply the tops, ${A[0]} ${TIMES} ${C[0]} = ${N}, and the bottoms, ${A[1]} ${TIMES} ${C[1]} = ${D}. That gives ${N}/${D}.`);
      if (f[1] !== D) steps.push(`Simplify: ${N} and ${D} share a factor of ${gcd(N, D)}, so ${N}/${D} = ${fstr(f)}.`);
      steps.push(`So ${this.show(q).replace(" = ?", "")} = ${fstr(f)}.`);
      return { answer: fstr(f), steps };
    },
    diagnose({ A, op, B }, r, n) {
      if (n === null) return null;
      const prod = (A[0] * B[0]) / (A[1] * B[1]);
      if (op === "/" && Math.abs(n - prod) < 1e-9) return "It looks like you multiplied without flipping the second fraction first.";
      if (op === "/" && Math.abs(n - (A[1] * B[0]) / (A[0] * B[1])) < 1e-9) return "You flipped the first fraction. Keep the first one as it is and flip the second.";
      return null;
    },
  },

  decimals_ops: {
    placeholder: "A decimal, like 4.25",
    parse: p => { const m = p.match(/^(\d+\.(\d+)) ([+-]) (\d+\.\d+) = \?$/); return m && { a: m[1], b: m[4], op: m[3], places: m[2].length }; },
    show: ({ a, op, b }) => `${a} ${opch(op)} ${b} = ?`,
    solve(q) {
      const { a, b, op, places } = q, scale = 10 ** places, unit = places === 1 ? "tenths" : "hundredths";
      const A = Math.round(Number(a) * scale), B = Math.round(Number(b) * scale), R = op === "+" ? A + B : A - B;
      const ans = (R / scale).toFixed(places), steps = [];
      steps.push(`Line up the decimal points. Both numbers have ${places} decimal place${places > 1 ? "s" : ""}, so count in ${unit}: ${a} is ${A} ${unit} and ${b} is ${B} ${unit}.`);
      if (op === "+") steps.push(`Add: ${A} + ${B} = ${R} ${unit}.`);
      else if (R >= 0) steps.push(`Subtract: ${A} ${MINUS} ${B} = ${R} ${unit}.`);
      else steps.push(`${b} is bigger than ${a}, so the answer is negative. ${B} ${MINUS} ${A} = ${-R}, so it's ${num(R)} ${unit}.`);
      steps.push(`Put the decimal point back: ${num(R)} ${unit} is ${ans.replace("-", MINUS)}. So ${a} ${opch(op)} ${b} = ${ans.replace("-", MINUS)}.`);
      return { answer: ans, steps };
    },
    diagnose({ a, b, op }, r, n) {
      if (n === null) return null;
      const ans = op === "+" ? Number(a) + Number(b) : Number(a) - Number(b);
      if (Math.abs(n + ans) < 1e-9 && ans !== 0) return "Right size, wrong sign. The second number is bigger, so the answer is negative.";
      if (Math.abs(n * 10 - ans) < 1e-9 || Math.abs(n / 10 - ans) < 1e-9 || Math.abs(n * 100 - ans) < 1e-9 || Math.abs(n / 100 - ans) < 1e-9)
        return "The digits are right but the decimal point is in the wrong place. Line the points up before you start.";
      return null;
    },
  },

  gcf_lcm: {
    placeholder: "A whole number",
    parse: p => { const m = p.match(/^Find the (GCF|LCM) of (\d+) and (\d+)\.$/); return m && { kind: m[1], a: +m[2], b: +m[3] }; },
    show: ({ kind, a, b }) => `Find the ${kind === "GCF" ? "greatest common factor" : "least common multiple"} of ${a} and ${b}.`,
    solve({ kind, a, b }) {
      const g = gcd(a, b), L = lcm(a, b), steps = [];
      if (kind === "GCF") {
        const fa = factors(a), fb = factors(b), common = fa.filter(x => fb.includes(x));
        steps.push(`List the numbers that divide ${a}: ${fa.join(", ")}.`);
        steps.push(`List the numbers that divide ${b}: ${fb.join(", ")}.`);
        steps.push(`They share ${common.join(", ")}. The greatest is ${g}, so the GCF is ${g}.`);
        return { answer: String(g), steps };
      }
      const big = Math.max(a, b), small = Math.min(a, b), count = L / big;
      if (count <= 10) {
        const mult = Array.from({ length: count }, (_, i) => big * (i + 1));
        steps.push(`List multiples of the bigger number, ${big}: ${mult.join(", ")}.`);
        steps.push(`Look for the first one that ${small} also divides evenly.`);
        steps.push(`${L} ${DIVIDE} ${small} = ${L / small}, a whole number, so the LCM is ${L}.`);
      } else {
        steps.push(`Listing multiples would take a while here, so use the shortcut. First find the GCF: the greatest number dividing both ${a} and ${b} is ${g}.`);
        steps.push(`The LCM is ${a} ${TIMES} ${b} ${DIVIDE} GCF = ${a * b} ${DIVIDE} ${g}.`);
        steps.push(`${a * b} ${DIVIDE} ${g} = ${L}. Check: ${L} ${DIVIDE} ${a} = ${L / a} and ${L} ${DIVIDE} ${b} = ${L / b}. So the LCM is ${L}.`);
      }
      return { answer: String(L), steps };
    },
    diagnose({ kind, a, b }, r, n) {
      if (n === null || !Number.isInteger(n) || n <= 0) return null;
      const g = gcd(a, b), L = lcm(a, b);
      if (kind === "GCF") {
        if (n === L) return "That's the least common multiple. The GCF is the largest number that divides into both.";
        if (a % n === 0 && b % n === 0) return `${n} does divide both, but there's a bigger number that does too.`;
        return `${n} doesn't divide evenly into both ${a} and ${b}.`;
      }
      if (n === g) return "That's the greatest common factor. The LCM is the smallest number both go into.";
      if (n % a === 0 && n % b === 0) return `${n} is a multiple of both, but there's a smaller one.`;
      return `${n} isn't a multiple of both ${a} and ${b}.`;
    },
  },

  ratios: {
    placeholder: "A ratio, like 2:3",
    parse: p => { const m = p.match(/^A mix uses (\d+) parts red to (\d+) parts blue\./); return m && { A: +m[1], B: +m[2] }; },
    show: ({ A, B }) => `A paint mix uses ${A} parts red to ${B} parts blue. Write the ratio of red to blue in simplest form.`,
    solve({ A, B }) {
      const g = gcd(A, B);
      return {
        answer: `${A / g}:${B / g}`,
        steps: [
          `Red comes first, so start with ${A}:${B}.`,
          `The largest number that divides both ${A} and ${B} is ${g}.`,
          `Divide both by ${g}: ${A} ${DIVIDE} ${g} = ${A / g} and ${B} ${DIVIDE} ${g} = ${B / g}. So the ratio is ${A / g}:${B / g}.`,
        ],
      };
    },
    diagnose({ A, B }, r) {
      const m = r.replace(/\s/g, "").match(/^(\d+):(\d+)$/);
      if (m && +m[1] * A === +m[2] * B) return "That's blue to red. The question asks for red first.";
      if (!m) return "Write it with a colon between the two numbers, like 2:3.";
      return "Divide both numbers by the same thing so the ratio stays the same.";
    },
  },

  unit_rate: {
    placeholder: "Dollars, like 4",
    parse: p => { const m = p.match(/^(\d+) dollars for (\d+) pounds\./); return m && { T: +m[1], q: +m[2] }; },
    show: ({ T, q }) => `${q} pounds cost $${T}. What is the price per pound, in dollars?`,
    solve({ T, q }) {
      return {
        answer: String(T / q),
        steps: [
          `"Per pound" means the price of 1 pound, so split the total evenly across the ${q} pounds: divide the dollars by the pounds.`,
          `${T} ${DIVIDE} ${q} = ${T / q}. So it's $${T / q} per pound.`,
        ],
      };
    },
    diagnose({ T, q }, r, n) {
      if (n === T * q) return "That's multiplying. To get the price of one pound, divide.";
      if (close(n, q / T)) return "That's pounds per dollar. Divide the dollars by the pounds instead.";
      return null;
    },
  },

  percent: {
    placeholder: "A number, like 12",
    parse: p => { const m = p.match(/^What is (\d+)% of (\d+)\?$/); return m && { pct: +m[1], whole: +m[2] }; },
    show: ({ pct, whole }) => `What is ${pct}% of ${whole}?`,
    solve({ pct, whole }) {
      const ans = money(pct * whole / 100);
      return {
        answer: ans,
        steps: [
          `A percent is out of 100, so ${pct}% is ${pct}/100, which is ${pct / 100} as a decimal.`,
          `"Of" means multiply: ${pct / 100} ${TIMES} ${whole}.`,
          `${pct / 100} ${TIMES} ${whole} = ${ans}. So ${pct}% of ${whole} is ${ans}.`,
        ],
      };
    },
    diagnose({ pct, whole }, r, n) {
      if (n === pct * whole) return "Don't forget that a percent is out of 100. Divide by 100 as well.";
      if (close(n, whole - pct * whole / 100)) return `That's what's left after taking ${pct}% away. The question asks for the ${pct}% itself.`;
      return null;
    },
  },

  percent_apps: {
    placeholder: "Dollars, like 18.50",
    parse(p) {
      let m = p.match(/^A \$(\d+) item is (\d+)% off\./);
      if (m) return { price: +m[1], rate: +m[2], kind: "off" };
      m = p.match(/^A \$(\d+) bill with a (\d+)% (tax|tip)\./);
      return m && { price: +m[1], rate: +m[2], kind: m[3] };
    },
    show: ({ price, rate, kind }) => (kind === "off"
      ? `A $${price} item is ${rate}% off. What is the sale price, in dollars?`
      : `A $${price} bill has a ${rate}% ${kind} added. What is the total, in dollars?`),
    solve({ price, rate, kind }) {
      const part = money(price * rate / 100);
      if (kind === "off") {
        const ans = money(price * (1 - rate / 100));
        return {
          answer: ans,
          steps: [
            `First find the discount: ${rate}% of ${price} is ${rate / 100} ${TIMES} ${price} = ${part} dollars.`,
            `A discount comes off the price, so subtract it.`,
            `${price} ${MINUS} ${part} = ${ans}. So the sale price is $${ans}.`,
          ],
        };
      }
      const ans = money(price * (1 + rate / 100));
      return {
        answer: ans,
        steps: [
          `First find the ${kind}: ${rate}% of ${price} is ${rate / 100} ${TIMES} ${price} = ${part} dollars.`,
          `A ${kind} is added on top of the bill.`,
          `${price} + ${part} = ${ans}. So the total is $${ans}.`,
        ],
      };
    },
    diagnose({ price, rate, kind }, r, n) {
      const part = price * rate / 100;
      if (kind === "off") {
        if (close(n, part)) return "That's the discount itself. The sale price is what's left after taking it off.";
        if (close(n, price + part)) return "A sale makes the price go down, so subtract the discount.";
      } else {
        if (close(n, part)) return `That's just the ${kind}. Add it to the bill to get the total.`;
        if (close(n, price - part)) return `A ${kind} is added on, so the total goes up.`;
      }
      if (close(n, price * rate) || close(n, price - rate) || close(n, price + rate)) return `Find ${rate}% of ${price} first. ${rate}% means ${rate} out of 100, not ${rate} dollars.`;
      return null;
    },
  },

  exponents: {
    placeholder: "A number",
    parse: p => { const m = p.match(/^Evaluate (\d+)\^(\d+)$/); return m && { base: +m[1], power: +m[2] }; },
    show: ({ base, power }) => `Evaluate ${base}${sup(power)}`,
    solve({ base, power }) {
      const chain = []; let v = base;
      for (let i = 1; i < power; i++) { chain.push(`${v} ${TIMES} ${base} = ${v * base}`); v *= base; }
      return {
        answer: String(v),
        steps: [
          `${base}${sup(power)} means ${power} copies of ${base} multiplied together: ${Array(power).fill(base).join(` ${TIMES} `)}.`,
          `Multiply one at a time: ${chain.slice(0, -1).join(", then ") || "just one step"}.`,
          `${chain[chain.length - 1]}. So ${base}${sup(power)} = ${v}.`,
        ].filter((s, i) => !(i === 1 && power === 2)),
      };
    },
    diagnose({ base, power }, r, n) {
      if (n === base * power) return `That's ${base} ${TIMES} ${power}. The small number says how many copies of ${base} to multiply together.`;
      if (n === base ** (power - 1) || n === base ** (power + 1)) return `Count the copies again: there should be exactly ${power} of them.`;
      if (n === base + power) return `The small number isn't added on. It says how many copies of ${base} to multiply.`;
      return null;
    },
  },

  evaluate_expr: {
    placeholder: "A number",
    parse(p) {
      let m = p.match(/^Evaluate (\d+) \+ (\d+) x (\d+)$/);
      if (m) return { a: +m[1], b: +m[2], c: +m[3], form: "sum" };
      m = p.match(/^Evaluate (\d+) x \((\d+) \+ (\d+)\)$/);
      return m && { a: +m[1], b: +m[2], c: +m[3], form: "paren" };
    },
    show: ({ a, b, c, form }) => (form === "sum" ? `Evaluate ${a} + ${b} ${TIMES} ${c}` : `Evaluate ${a} ${TIMES} (${b} + ${c})`),
    solve({ a, b, c, form }) {
      if (form === "sum") {
        const ans = a + b * c;
        return { answer: String(ans), steps: [
          `Multiplication comes before addition, so start with ${b} ${TIMES} ${c}.`,
          `${b} ${TIMES} ${c} = ${b * c}.`,
          `Then add: ${a} + ${b * c} = ${ans}.`,
        ] };
      }
      const ans = a * (b + c);
      return { answer: String(ans), steps: [
        `Parentheses come first, so start with ${b} + ${c}.`,
        `${b} + ${c} = ${b + c}.`,
        `Then multiply: ${a} ${TIMES} ${b + c} = ${ans}.`,
      ] };
    },
    diagnose({ a, b, c, form }, r, n) {
      if (form === "sum" && n === (a + b) * c) return `That's what you get going left to right. Multiplication comes before addition, so do ${b} ${TIMES} ${c} first.`;
      if (form === "paren" && n === a * b + c) return `The ${a} multiplies everything inside the parentheses, so add ${b} + ${c} first.`;
      return null;
    },
  },

  combine_like_terms: {
    placeholder: "Like 5x + 3",
    parse: p => { const m = p.match(/^Simplify: (\d+)x \+ (\d+) \+ (\d+)x \+ (\d+)$/); return m && { c1: +m[1], k1: +m[2], c2: +m[3], k2: +m[4] }; },
    show: ({ c1, k1, c2, k2 }) => `Simplify: ${xterm(c1)} + ${k1} + ${xterm(c2)} + ${k2}`,
    solve({ c1, k1, c2, k2 }) {
      const C = c1 + c2, K = k1 + k2;
      return { answer: `${C}x + ${K}`, steps: [
        `Group the x terms: ${xterm(c1)} + ${xterm(c2)} = ${xterm(C)}.`,
        `Group the plain numbers: ${k1} + ${k2} = ${K}.`,
        `x terms and plain numbers can't be added to each other, so they stay as two parts: ${xterm(C)} + ${K}.`,
      ] };
    },
    diagnose({ c1, k1, c2, k2 }, r, n) {
      const C = c1 + c2, K = k1 + k2, L = parseLinear(r);
      if (n === C + K) return `x terms and plain numbers can't be added together. Keep them as two parts, like ${xterm(C)} + something.`;
      if (L && L.cx === C) return `Your x part is right. Check the plain numbers: ${k1} + ${k2}.`;
      if (L && L.k === K) return `Your number part is right. Check the x terms: ${xterm(c1)} + ${xterm(c2)}.`;
      if (!L) return "Write it as an x part plus a number, like 5x + 3.";
      return null;
    },
  },

  exponent_rules: {
    placeholder: "Just the exponent",
    parse: p => { const m = p.match(/^(\d+)\^(\d+) ([*/]) (\d+)\^(\d+) = \d+\^\?/); return m && { b: +m[1], m: +m[2], op: m[3], n: +m[5] }; },
    show: ({ b, m, op, n }) => `${b}${sup(m)} ${opch(op)} ${b}${sup(n)} = ${b} to what power?`,
    solve({ b, m, op, n }) {
      if (op === "*") return { answer: String(m + n), steps: [
        `${b}${sup(m)} is ${m} copies of ${b} multiplied together, and ${b}${sup(n)} is ${n} more copies.`,
        `Multiplying them puts all the copies together, so add the exponents: ${m} + ${n}.`,
        `${m} + ${n} = ${m + n}, so the answer is ${b}${sup(m + n)}. The exponent is ${m + n}.`,
      ] };
      return { answer: String(m - n), steps: [
        `${b}${sup(m)} is ${m} copies of ${b} on top, and ${b}${sup(n)} is ${n} copies on the bottom.`,
        `Each copy on the bottom cancels one on top, so subtract the exponents: ${m} ${MINUS} ${n}.`,
        `${m} ${MINUS} ${n} = ${m - n}, so the answer is ${b}${sup(m - n)}. The exponent is ${m - n}.`,
      ] };
    },
    diagnose({ b, m, op, n }, r, x) {
      const e = op === "*" ? m + n : m - n;
      if (x === b ** e) return `That's the full value of ${b}${sup(e)}. The question only wants the exponent.`;
      if (op === "*" && x === m * n) return "When you multiply powers with the same base, add the exponents. Multiplying them is a different rule.";
      if (op === "/" && x === m + n) return "When you divide, the exponents subtract, not add.";
      if (op === "/" && x === m / n) return "When you divide, subtract the exponents rather than dividing them.";
      return null;
    },
  },

  one_step_eq: {
    placeholder: "The value of x",
    parse(p) {
      let m = p.match(/^Solve for x:\s+x \+ (\d+) = (\d+)$/);
      if (m) return { form: "add", k: +m[1], r: +m[2] };
      m = p.match(/^Solve for x:\s+(\d+)x = (\d+)$/);
      return m && { form: "mul", k: +m[1], r: +m[2] };
    },
    show: ({ form, k, r }) => (form === "add" ? `Solve for x:   x + ${k} = ${r}` : `Solve for x:   ${k}x = ${r}`),
    solve({ form, k, r }) {
      if (form === "add") {
        const x = r - k;
        return { answer: String(x), steps: [
          `x has ${k} added to it. To get x alone, undo that by subtracting ${k} from both sides.`,
          `x = ${r} ${MINUS} ${k} = ${x}. Check: ${x} + ${k} = ${r}.`,
        ] };
      }
      const x = r / k;
      return { answer: String(x), steps: [
        `${k}x means ${k} times x. To get x alone, undo that by dividing both sides by ${k}.`,
        `x = ${r} ${DIVIDE} ${k} = ${x}. Check: ${k} ${TIMES} ${x} = ${r}.`,
      ] };
    },
    diagnose({ form, k, r }, s, n) {
      if (form === "add" && n === r + k) return `To undo + ${k}, subtract ${k}. Adding it again makes x too big.`;
      if (form === "mul" && n === r * k) return "To undo multiplying, divide.";
      if (form === "mul" && n === r - k) return `${k}x means ${k} times x, so divide by ${k} rather than subtracting.`;
      return null;
    },
  },

  two_step_eq: {
    placeholder: "The value of x",
    parse: p => { const m = p.match(/^Solve for x:\s+(\d+)x ([+-]) (\d+) = (-?\d+)$/); return m && { m: +m[1], op: m[2], k: +m[3], rhs: +m[4] }; },
    show: ({ m, op, k, rhs }) => `Solve for x:   ${m}x ${opch(op)} ${k} = ${num(rhs)}`,
    solve({ m, op, k, rhs }) {
      const R = op === "+" ? rhs - k : rhs + k, x = R / m;
      return { answer: String(x), steps: [
        `Work backwards. First undo the ${opch(op)} ${k}: ${op === "+" ? "subtract" : "add"} ${k} on both sides.`,
        `${num(rhs)} ${op === "+" ? MINUS : "+"} ${k} = ${num(R)}, so now ${m}x = ${num(R)}.`,
        `Then undo the ${TIMES} ${m} by dividing both sides by ${m}: x = ${num(R)} ${DIVIDE} ${m} = ${num(x)}. Check: ${m} ${TIMES} ${par(x)} ${opch(op)} ${k} = ${num(rhs)}.`,
      ] };
    },
    diagnose({ m, op, k, rhs }, s, n) {
      const x = (op === "+" ? rhs - k : rhs + k) / m;
      if (n === (op === "+" ? rhs + k : rhs - k) / m) return `To undo ${opch(op)} ${k}, ${op === "+" ? "subtract" : "add"} ${k} on both sides.`;
      if (n === -x && x !== 0) return "Right size, wrong sign. Check the signs in each step.";
      if (n === (op === "+" ? rhs / m - k : rhs / m + k)) return `Undo the ${opch(op)} ${k} before you divide. Dividing first only splits part of the equation.`;
      if (n === (op === "+" ? rhs - k : rhs + k)) return `That's ${m}x. One more step: divide by ${m} to get x.`;
      return null;
    },
  },

  multi_step_eq: {
    placeholder: "The value of x",
    parse: p => { const m = p.match(/^Solve for x:\s+(\d+)x \+ (\d+) = (\d+)x \+ (\d+)$/); return m && { a: +m[1], c: +m[2], b: +m[3], d: +m[4] }; },
    show: ({ a, c, b, d }) => `Solve for x:   ${xterm(a)} + ${c} = ${xterm(b)} + ${d}`,
    solve({ a, c, b, d }) {
      const e = a - b, x = (d - c) / e;
      const check = `Check: ${a} ${TIMES} ${x} + ${c} = ${a * x + c}, and ${b} ${TIMES} ${x} + ${d} = ${b * x + d}.`;
      return { answer: String(x), steps: [
        `Get the x terms on one side. Subtract ${xterm(b)} from both sides: ${xterm(a)} ${MINUS} ${xterm(b)} = ${xterm(e)}, so now ${xterm(e)} + ${c} = ${d}.`,
        `Subtract ${c} from both sides: ${d} ${MINUS} ${c} = ${d - c}, so ${xterm(e)} = ${d - c}.`,
        e === 1 ? `That already says x = ${x}. ${check}` : `Divide both sides by ${e}: x = ${d - c} ${DIVIDE} ${e} = ${x}. ${check}`,
      ] };
    },
    diagnose({ a, c, b, d }, s, n) {
      const e = a - b;
      if (n === (d - c) / (a + b)) return `To move ${xterm(b)} off the right side, subtract it from both sides. Adding it doesn't cancel it.`;
      if (n === (d + c) / e) return `Subtract ${c} from both sides to move it. Adding it doesn't cancel it.`;
      if (n === d - c && e !== 1) return `That's ${xterm(e)}. One more step: divide by ${e} to get x.`;
      return null;
    },
  },

  proportions: {
    placeholder: "The value of x",
    parse: p => { const m = p.match(/^Solve for x:\s+(\d+)\/(\d+) = (\d+)\/x$/); return m && { a: +m[1], b: +m[2], ak: +m[3] }; },
    show: ({ a, b, ak }) => `Solve for x:   ${a}/${b} = ${ak}/x`,
    solve({ a, b, ak }) {
      const k = ak / a, x = b * k;
      return { answer: String(x), steps: [
        `Compare the tops: ${a} became ${ak}. ${ak} ${DIVIDE} ${a} = ${k}, so the top was multiplied by ${k}.`,
        `Equal fractions scale the top and bottom the same way, so multiply the bottom by ${k} too.`,
        `x = ${b} ${TIMES} ${k} = ${x}. Check: ${a}/${b} and ${ak}/${x} both simplify to ${fstr(red([a, b]))}.`,
      ] };
    },
    diagnose({ a, b, ak }, s, n) {
      const k = ak / a;
      if (n === b + (ak - a)) return `The top was multiplied by ${k}, not increased by ${ak - a}. Multiply the bottom by ${k} as well.`;
      if (n === k) return `${k} is how much the top was multiplied by. Multiply the bottom by ${k} to get x.`;
      return null;
    },
  },
};

// --- public API ----------------------------------------------------------------

const cache = new WeakMap();

// the readable problem, the worked steps, and the parsed parameters for an item
export function lesson(item) {
  if (cache.has(item)) return cache.get(item);
  const T = SKILL_TEACH[item.skillId], params = T ? T.parse(item.prompt) : null;
  let out;
  if (!params) {
    out = { ok: false, display: item.prompt, steps: [`The answer is ${item.answer}.`], answer: item.answer, placeholder: "Your answer", skillName: null };
  } else {
    const { answer, steps } = T.solve(params);
    out = { ok: true, params, display: T.show(params), steps, answer, placeholder: T.placeholder };
  }
  cache.set(item, out);
  return out;
}

// clean up what a student typed: unicode minus signs, dollar signs, extra spaces
export function normalize(raw) {
  return String(raw).replace(/[\u2212\u2013\u2014]/g, "-").replace(/\$/g, "").replace(/\s+/g, " ").trim();
}

// "5x + 3" or "3 + 5x" (spaces optional) -> { cx, k }
export function parseLinear(r) {
  const s = r.replace(/\s/g, "").replace(/\*/g, "");
  let m = s.match(/^(\d*)x\+(\d+)$/);
  if (m) return { cx: m[1] === "" ? 1 : +m[1], k: +m[2] };
  m = s.match(/^(\d+)\+(\d*)x$/);
  if (m) return { cx: m[2] === "" ? 1 : +m[2], k: +m[1] };
  return null;
}

const SIMPLEST = new Set(["fraction_equiv", "fraction_add_sub", "fraction_mul_div", "ratios"]);

// grade a response: { status: "right" | "almost" | "wrong" | "empty", note }
// "almost" means the value is right but it isn't in the asked-for form yet; it does
// not count as an attempt.
export function grade(item, raw) {
  const r = normalize(raw), L = lesson(item), sid = item.skillId;
  if (!r) return { status: "empty" };
  const n = toNumber(r);

  let right;
  if (sid === "combine_like_terms") {
    const got = parseLinear(r), want = parseLinear(item.answer);
    right = !!got && got.cx === want.cx && got.k === want.k;
  } else if (SIMPLEST.has(sid)) {
    right = r.replace(/\s/g, "") === item.answer;
    if (!right) {
      const almost = almostNote(sid, r, item.answer);
      if (almost) return { status: "almost", note: almost };
    }
  } else {
    right = checkAnswer(item, r);
  }
  if (right) return { status: "right" };

  const T = SKILL_TEACH[sid];
  const note = L.ok && T.diagnose ? T.diagnose(L.params, r, n) : null;
  return { status: "wrong", note };
}

function almostNote(sid, r, answer) {
  const s = r.replace(/\s/g, "");
  if (sid === "ratios") {
    const [p, q] = answer.split(":").map(Number);
    const m = s.match(/^(\d+):(\d+)$/);
    if (m && +m[1] * q === +m[2] * p) return `That's the right ratio, but it can be simplified: ${m[1]} and ${m[2]} share a factor of ${gcd(+m[1], +m[2])}.`;
    const v = toNumber(s);
    if (v !== null && Math.abs(v - p / q) < 1e-9) return "Right value. Write it as a ratio with a colon, like 2:3.";
    return null;
  }
  const v = toNumber(s), want = toNumber(answer);
  if (v === null || want === null || Math.abs(v - want) > 1e-9) return null;
  if (/^-?\d+\/-?\d+$/.test(s)) {
    const [a, b] = s.split("/").map(Number), g = gcd(a, b);
    if (b === 1 || g === 1) return `Right value. Write it as ${answer}.`;
    return `That's the right value, but it isn't in simplest form yet: ${Math.abs(a)} and ${Math.abs(b)} share a factor of ${g}.`;
  }
  return `Right value. Write it as a fraction in simplest form, like ${answer.includes("/") ? "3/4" : answer}.`;
}

export { lc };

"""items.py - the middle-school math content for Lilt.

The math is organised the way the curriculum is: by grade (6, 7, 8) and by topic
(the strand, e.g. Number System, Ratios and Proportions, Expressions and
Equations). Each skill carries its grade and topic, a base difficulty on a
Rasch-style scale, and its prerequisites. Prerequisites never point forward a
grade, so the graph respects how the curriculum builds.

Three jobs:

1. The skill graph: middle-school math as a prerequisite DAG, grouped by grade and
   topic, that the tutor walks and the tracer keeps a belief over.
2. Grade and topic lookup, so the app can start a student in their grade and a
   chosen strand.
3. Procedural item generation: each skill produces real problems at a requested
   level. The same generators feed the simulator (which needs an item's difficulty)
   and the browser app (which needs the actual question and answer). One source of
   truth for the math.

Difficulty is on a Rasch-style scale (b): higher b means a harder item, realised by
larger operands, unlike denominators, negatives, and more steps. A skill has a base
difficulty; within a skill, a ``level`` in [0, 1] shifts items around that base.

Strands that do not autogenerate cleanly as single-answer problems (Geometry,
Statistics and Probability, Functions) are planned for later phases and are noted
in docs/DESIGN.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from math import gcd
from typing import Callable

import numpy as np

LEVEL_SPREAD = 2.0  # how far within-skill level shifts difficulty around the base

# topic (strand) names, in curriculum order
NUMBER_SYSTEM = "Number System"
RATIOS = "Ratios and Proportions"
EXPRESSIONS = "Expressions and Equations"
TOPIC_ORDER = (NUMBER_SYSTEM, RATIOS, EXPRESSIONS)


@dataclass(frozen=True)
class Skill:
    """A single math skill, placed in a grade and a topic."""

    id: str
    name: str
    grade: int
    topic: str
    prereqs: tuple[str, ...]
    difficulty: float  # base Rasch difficulty b


@dataclass(frozen=True)
class Item:
    """A concrete problem produced by a skill's generator."""

    skill_id: str
    difficulty: float  # Rasch b for this specific item
    prompt: str
    answer: str
    level: float  # the within-skill level it was generated at, in [0, 1]


# --- the skill graph, by grade and topic -----------------------------------

_SKILL_LIST = [
    # grade 6: Number System
    Skill("fraction_equiv", "Equivalent fractions and simplifying",
          6, NUMBER_SYSTEM, (), -1.2),
    Skill("fraction_add_sub", "Adding and subtracting fractions",
          6, NUMBER_SYSTEM, ("fraction_equiv",), -0.6),
    Skill("fraction_mul_div", "Multiplying and dividing fractions",
          6, NUMBER_SYSTEM, ("fraction_equiv",), -0.4),
    Skill("decimals_ops", "Decimal arithmetic", 6, NUMBER_SYSTEM, (), -0.6),
    Skill("gcf_lcm", "Greatest common factor and least common multiple",
          6, NUMBER_SYSTEM, (), -0.5),
    # grade 6: Ratios and Proportions
    Skill("ratios", "Ratios", 6, RATIOS, ("fraction_equiv",), -0.2),
    Skill("unit_rate", "Unit rates", 6, RATIOS,
          ("ratios", "fraction_mul_div"), 0.1),
    Skill("percent", "Percentages", 6, RATIOS,
          ("fraction_mul_div", "decimals_ops"), 0.3),
    # grade 6: Expressions and Equations
    Skill("exponents", "Whole-number exponents", 6, EXPRESSIONS, (), -0.3),
    Skill("evaluate_expr", "Order of operations", 6, EXPRESSIONS,
          ("exponents",), 0.0),
    Skill("one_step_eq", "One-step equations", 6, EXPRESSIONS,
          ("fraction_mul_div",), 0.3),

    # grade 7: Number System
    Skill("integer_add_sub", "Adding and subtracting integers",
          7, NUMBER_SYSTEM, (), -0.8),
    Skill("integer_mul_div", "Multiplying and dividing integers",
          7, NUMBER_SYSTEM, ("integer_add_sub",), -0.4),
    # grade 7: Ratios and Proportions
    Skill("proportions", "Solving proportions", 7, RATIOS,
          ("unit_rate", "one_step_eq"), 0.7),
    Skill("percent_apps", "Percent applications (tax, tip, discount)",
          7, RATIOS, ("percent",), 0.8),
    # grade 7: Expressions and Equations
    Skill("combine_like_terms", "Combining like terms", 7, EXPRESSIONS,
          ("evaluate_expr",), 0.5),
    Skill("two_step_eq", "Two-step equations", 7, EXPRESSIONS,
          ("one_step_eq", "combine_like_terms", "integer_add_sub"), 0.9),

    # grade 8: Expressions and Equations
    Skill("exponent_rules", "Laws of exponents", 8, EXPRESSIONS,
          ("exponents",), 0.7),
    Skill("multi_step_eq", "Equations with variables on both sides",
          8, EXPRESSIONS, ("two_step_eq",), 1.2),
]

SKILLS: dict[str, Skill] = {s.id: s for s in _SKILL_LIST}

GRADES: tuple[int, ...] = tuple(sorted({s.grade for s in _SKILL_LIST}))


# --- grade / topic lookup --------------------------------------------------

def skills_in_grade(grade: int) -> list[str]:
    return [s.id for s in _SKILL_LIST if s.grade == grade]


def skills_in_topic(topic: str) -> list[str]:
    return [s.id for s in _SKILL_LIST if s.topic == topic]


def topics_in_grade(grade: int) -> list[str]:
    present = {s.topic for s in _SKILL_LIST if s.grade == grade}
    return [t for t in TOPIC_ORDER if t in present]


def topological_order() -> list[str]:
    """Skill ids in an order where every prerequisite comes before its skill."""
    order: list[str] = []
    seen: set[str] = set()

    def visit(sid: str) -> None:
        if sid in seen:
            return
        seen.add(sid)
        for p in SKILLS[sid].prereqs:
            visit(p)
        order.append(sid)

    for sid in SKILLS:
        visit(sid)
    return order


def all_prerequisites(skill_id: str) -> set[str]:
    """Transitive set of prerequisites for a skill (not including itself)."""
    out: set[str] = set()
    for p in SKILLS[skill_id].prereqs:
        out.add(p)
        out |= all_prerequisites(p)
    return out


def is_unlocked(mastery: dict[str, float], skill_id: str,
                threshold: float = 0.6) -> bool:
    """A skill is unlocked once every prerequisite is at or above ``threshold``."""
    return all(mastery.get(p, 0.0) >= threshold
               for p in SKILLS[skill_id].prereqs)


# --- procedural item generators -------------------------------------------

Generator = Callable[[float, np.random.Generator], tuple[str, str]]


def _mag(level: float, lo: int, hi: int) -> int:
    """An operand cap that grows from lo to hi as level goes 0 to 1."""
    return int(round(lo + (hi - lo) * level))


def _fmt_frac(f: Fraction) -> str:
    return str(f.numerator) if f.denominator == 1 else f"{f.numerator}/{f.denominator}"


def _fmt_money(v: float) -> str:
    return str(int(round(v))) if abs(v - round(v)) < 1e-9 else f"{v:.2f}"


def _rand_fraction(rng: np.random.Generator, max_den: int) -> Fraction:
    den = int(rng.integers(2, max_den + 1))
    num = int(rng.integers(1, den * 2))
    return Fraction(num, den)


def _gen_integer_add_sub(level, rng):
    cap = _mag(level, 9, 99)
    a, b = int(rng.integers(-cap, cap + 1)), int(rng.integers(-cap, cap + 1))
    op = rng.choice(["+", "-"])
    ans = a + b if op == "+" else a - b
    return f"{a} {op} {f'({b})' if b < 0 else b} = ?", str(ans)


def _gen_integer_mul_div(level, rng):
    cap = _mag(level, 6, 20)
    if rng.random() < 0.5:
        a, b = int(rng.integers(-cap, cap + 1)), int(rng.integers(-cap, cap + 1))
        return f"{f'({a})' if a < 0 else a} x {f'({b})' if b < 0 else b} = ?", str(a * b)
    b = int(rng.choice([n for n in range(-cap, cap + 1) if n != 0]))
    q = int(rng.integers(-cap, cap + 1))
    return f"{b * q} / {f'({b})' if b < 0 else b} = ?", str(q)


def _gen_fraction_equiv(level, rng):
    base = _rand_fraction(rng, _mag(level, 6, 12))
    factor = int(rng.integers(2, _mag(level, 4, 9) + 1))
    num, den = base.numerator * factor, base.denominator * factor
    return f"Write {num}/{den} in simplest form.", _fmt_frac(Fraction(num, den))


def _gen_fraction_add_sub(level, rng):
    max_den = _mag(level, 4, 12)
    if level < 0.5:
        den = int(rng.integers(2, max_den + 1))
        a, b = Fraction(int(rng.integers(1, den)), den), Fraction(int(rng.integers(1, den)), den)
    else:
        a, b = _rand_fraction(rng, max_den), _rand_fraction(rng, max_den)
    op = rng.choice(["+", "-"])
    ans = a + b if op == "+" else a - b
    return f"{_fmt_frac(a)} {op} {_fmt_frac(b)} = ?  (simplest form)", _fmt_frac(ans)


def _gen_fraction_mul_div(level, rng):
    max_den = _mag(level, 4, 10)
    a, b = _rand_fraction(rng, max_den), _rand_fraction(rng, max_den)
    op = rng.choice(["x", "/"])
    ans = a * b if op == "x" else a / b
    return f"{_fmt_frac(a)} {op} {_fmt_frac(b)} = ?  (simplest form)", _fmt_frac(ans)


def _gen_decimals_ops(level, rng):
    places = 1 if level < 0.5 else 2
    scale, cap = 10 ** places, _mag(level, 50, 500)
    a, b = int(rng.integers(1, cap)) / scale, int(rng.integers(1, cap)) / scale
    op = rng.choice(["+", "-"])
    ans = round(a + b if op == "+" else a - b, places)
    return f"{a:.{places}f} {op} {b:.{places}f} = ?", f"{ans:.{places}f}"


def _gen_gcf_lcm(level, rng):
    a, b = int(rng.integers(2, _mag(level, 14, 40) + 1)), int(rng.integers(2, _mag(level, 14, 40) + 1))
    if rng.random() < 0.5:
        return f"Find the GCF of {a} and {b}.", str(gcd(a, b))
    return f"Find the LCM of {a} and {b}.", str(a * b // gcd(a, b))


def _gen_ratios(level, rng):
    a, b = int(rng.integers(2, _mag(level, 5, 9) + 1)), int(rng.integers(2, _mag(level, 5, 9) + 1))
    factor = int(rng.integers(2, _mag(level, 4, 9) + 1))
    g = gcd(a, b)
    return (f"A mix uses {a * factor} parts red to {b * factor} parts blue. "
            f"Write the ratio of red to blue in simplest form (a:b).",
            f"{a // g}:{b // g}")


def _gen_unit_rate(level, rng):
    rate = int(rng.integers(2, _mag(level, 6, 15) + 1))
    qty = int(rng.integers(2, _mag(level, 5, 12) + 1))
    return (f"{rate * qty} dollars for {qty} pounds. What is the price per pound, "
            f"in dollars?", str(rate))


def _gen_percent(level, rng):
    pct = int(rng.choice([10, 20, 25, 50, 5, 15, 40, 75]))
    whole = int(rng.integers(2, _mag(level, 10, 40) + 1)) * 4
    ans = pct * whole / 100
    return f"What is {pct}% of {whole}?", _fmt_money(ans)


def _gen_percent_apps(level, rng):
    price = int(rng.integers(10, _mag(level, 40, 120) + 1))
    rate = int(rng.choice([5, 10, 15, 20, 25]))
    if rng.random() < 0.5:
        return (f"A ${price} item is {rate}% off. What is the sale price, in dollars?",
                _fmt_money(price * (1 - rate / 100)))
    kind = rng.choice(["tax", "tip"])
    return (f"A ${price} bill with a {rate}% {kind}. What is the total, in dollars?",
            _fmt_money(price * (1 + rate / 100)))


def _gen_exponents(level, rng):
    base = int(rng.integers(2, _mag(level, 5, 9) + 1))
    power = 2 + int(round(level * 2))  # 2 to 4
    return f"Evaluate {base}^{power}", str(base ** power)


def _gen_evaluate_expr(level, rng):
    cap = _mag(level, 5, 12)
    a, b, c = (int(rng.integers(2, cap + 1)) for _ in range(3))
    if level < 0.5:
        return f"Evaluate {a} + {b} x {c}", str(a + b * c)
    return f"Evaluate {a} x ({b} + {c})", str(a * (b + c))


def _gen_combine_like_terms(level, rng):
    c1, c2 = int(rng.integers(1, _mag(level, 4, 9) + 1)), int(rng.integers(1, _mag(level, 4, 9) + 1))
    k1, k2 = int(rng.integers(1, _mag(level, 6, 15) + 1)), int(rng.integers(0, _mag(level, 6, 15) + 1))
    return f"Simplify: {c1}x + {k1} + {c2}x + {k2}", f"{c1 + c2}x + {k1 + k2}"


def _gen_exponent_rules(level, rng):
    base = int(rng.choice([2, 3, 5, 10]))
    m, n = int(rng.integers(2, 5)), int(rng.integers(2, 5))
    if level >= 0.5 and rng.random() < 0.5:
        if m <= n:
            m, n = n + 1, m
        return (f"{base}^{m} / {base}^{n} = {base}^?   (give the exponent)", str(m - n))
    return f"{base}^{m} * {base}^{n} = {base}^?   (give the exponent)", str(m + n)


def _gen_one_step_eq(level, rng):
    cap = _mag(level, 8, 20)
    x = int(rng.integers(0, cap + 1))
    if rng.random() < 0.5:
        k = int(rng.integers(1, _mag(level, 9, 20) + 1))
        return f"Solve for x:  x + {k} = {x + k}", str(x)
    m = int(rng.integers(2, _mag(level, 5, 9) + 1))
    return f"Solve for x:  {m}x = {m * x}", str(x)


def _gen_two_step_eq(level, rng):
    x = int(rng.integers(-_mag(level, 6, 15), _mag(level, 6, 15) + 1))
    m = int(rng.integers(2, _mag(level, 5, 9) + 1))
    k = int(rng.integers(1, _mag(level, 9, 20) + 1))
    op = rng.choice(["+", "-"])
    rhs = m * x + k if op == "+" else m * x - k
    return f"Solve for x:  {m}x {op} {k} = {rhs}", str(x)


def _gen_multi_step_eq(level, rng):
    x = int(rng.integers(1, _mag(level, 6, 15) + 1))
    a = int(rng.integers(3, _mag(level, 6, 10) + 1))
    b = int(rng.integers(1, a))  # b < a keeps a positive coefficient after moving
    c = int(rng.integers(1, _mag(level, 8, 20) + 1))
    d = (a - b) * x + c
    return f"Solve for x:  {a}x + {c} = {b}x + {d}", str(x)


def _gen_proportions(level, rng):
    a, b = int(rng.integers(2, _mag(level, 5, 9) + 1)), int(rng.integers(2, _mag(level, 5, 9) + 1))
    k = int(rng.integers(2, _mag(level, 5, 10) + 1))
    return f"Solve for x:  {a}/{b} = {a * k}/x", str(b * k)


_GENERATORS: dict[str, Generator] = {
    "fraction_equiv": _gen_fraction_equiv,
    "fraction_add_sub": _gen_fraction_add_sub,
    "fraction_mul_div": _gen_fraction_mul_div,
    "decimals_ops": _gen_decimals_ops,
    "gcf_lcm": _gen_gcf_lcm,
    "ratios": _gen_ratios,
    "unit_rate": _gen_unit_rate,
    "percent": _gen_percent,
    "exponents": _gen_exponents,
    "evaluate_expr": _gen_evaluate_expr,
    "one_step_eq": _gen_one_step_eq,
    "integer_add_sub": _gen_integer_add_sub,
    "integer_mul_div": _gen_integer_mul_div,
    "proportions": _gen_proportions,
    "percent_apps": _gen_percent_apps,
    "combine_like_terms": _gen_combine_like_terms,
    "two_step_eq": _gen_two_step_eq,
    "exponent_rules": _gen_exponent_rules,
    "multi_step_eq": _gen_multi_step_eq,
}


def item_difficulty(skill_id: str, level: float) -> float:
    """Rasch b for an item at ``level`` within a skill."""
    return SKILLS[skill_id].difficulty + (level - 0.5) * LEVEL_SPREAD


def generate_item(skill_id: str, level: float, rng: np.random.Generator) -> Item:
    """Produce a concrete problem for a skill at a within-skill level in [0, 1]."""
    level = float(min(1.0, max(0.0, level)))
    prompt, answer = _GENERATORS[skill_id](level, rng)
    return Item(skill_id=skill_id, difficulty=item_difficulty(skill_id, level),
                prompt=prompt, answer=answer, level=level)

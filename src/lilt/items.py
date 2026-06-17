"""items.py - the middle-school math content for Lilt.

Two jobs:

1. The skill graph. Middle-school math (roughly grades 6 to 8) as a prerequisite
   DAG. Each skill has a base difficulty on a Rasch-style scale, and the tutor
   walks this graph while the tracer keeps a belief about mastery per skill.

2. Procedural item generation. Each skill knows how to produce real problems at a
   requested level. The same generators feed the simulator (which only needs an
   item's difficulty) and, later, the browser app (which needs the actual question
   and answer). One source of truth for the math.

Difficulty is on a Rasch-style scale (b): higher b means a harder item, realised
here by larger operands, unlike denominators, negatives, and more steps. A skill
has a base difficulty; within a skill, a ``level`` in [0, 1] shifts the item up or
down around that base.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from math import gcd
from typing import Callable

import numpy as np

# How far within-skill level shifts item difficulty around the skill's base b.
LEVEL_SPREAD = 2.0


@dataclass(frozen=True)
class Skill:
    """A single math skill and its prerequisites."""

    id: str
    name: str
    prereqs: tuple[str, ...]
    difficulty: float  # base Rasch difficulty b for the skill


@dataclass(frozen=True)
class Item:
    """A concrete problem produced by a skill's generator."""

    skill_id: str
    difficulty: float  # Rasch b for this specific item
    prompt: str
    answer: str
    level: float  # the within-skill level it was generated at, in [0, 1]


# --- the skill graph -------------------------------------------------------

# A coherent middle-school spine: signed-integer and fraction arithmetic feeding
# ratios, percentages, expressions, and one- and two-step equations. Base
# difficulty rises roughly with where a skill sits in the curriculum.
_SKILL_LIST = [
    Skill("integer_add_sub", "Adding and subtracting integers", (), -1.5),
    Skill("integer_mul_div", "Multiplying and dividing integers",
          ("integer_add_sub",), -1.0),
    Skill("fraction_equiv", "Equivalent fractions and simplifying", (), -1.0),
    Skill("fraction_add_sub", "Adding and subtracting fractions",
          ("fraction_equiv",), -0.3),
    Skill("fraction_mul_div", "Multiplying and dividing fractions",
          ("fraction_equiv",), -0.3),
    Skill("decimals_ops", "Decimal arithmetic", ("integer_mul_div",), -0.3),
    Skill("ratios", "Ratios", ("fraction_equiv",), 0.0),
    Skill("unit_rate", "Unit rates", ("ratios", "fraction_mul_div"), 0.3),
    Skill("percent", "Percentages", ("fraction_mul_div", "decimals_ops"), 0.5),
    Skill("evaluate_expr", "Order of operations", ("integer_mul_div",), 0.2),
    Skill("one_step_eq", "One-step equations",
          ("integer_add_sub", "fraction_mul_div"), 0.5),
    Skill("two_step_eq", "Two-step equations",
          ("one_step_eq", "evaluate_expr"), 1.0),
    Skill("proportions", "Solving proportions",
          ("unit_rate", "one_step_eq"), 1.0),
]

SKILLS: dict[str, Skill] = {s.id: s for s in _SKILL_LIST}


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

# Each generator takes a within-skill level in [0, 1] and a numpy Generator, and
# returns (prompt, answer). The registry below wires them to skills; generate_item
# wraps the result with the Rasch difficulty for the chosen level.

Generator = Callable[[float, np.random.Generator], tuple[str, str]]


def _mag(level: float, lo: int, hi: int) -> int:
    """An operand cap that grows from lo to hi as level goes 0 to 1."""
    return int(round(lo + (hi - lo) * level))


def _fmt_frac(f: Fraction) -> str:
    if f.denominator == 1:
        return str(f.numerator)
    return f"{f.numerator}/{f.denominator}"


def _gen_integer_add_sub(level: float, rng: np.random.Generator) -> tuple[str, str]:
    cap = _mag(level, 9, 99)
    a = int(rng.integers(-cap, cap + 1))
    b = int(rng.integers(-cap, cap + 1))
    op = rng.choice(["+", "-"])
    ans = a + b if op == "+" else a - b
    b_str = f"({b})" if b < 0 else f"{b}"
    return f"{a} {op} {b_str} = ?", str(ans)


def _gen_integer_mul_div(level: float, rng: np.random.Generator) -> tuple[str, str]:
    cap = _mag(level, 6, 20)
    if rng.random() < 0.5:
        a = int(rng.integers(-cap, cap + 1))
        b = int(rng.integers(-cap, cap + 1))
        return f"{a if a >= 0 else f'({a})'} x {b if b >= 0 else f'({b})'} = ?", str(a * b)
    # division with an integer result: build b * q then ask (b*q) / b
    b = int(rng.choice([n for n in range(-cap, cap + 1) if n != 0]))
    q = int(rng.integers(-cap, cap + 1))
    dividend = b * q
    return f"{dividend} / {b if b >= 0 else f'({b})'} = ?", str(q)


def _rand_fraction(rng: np.random.Generator, max_den: int) -> Fraction:
    den = int(rng.integers(2, max_den + 1))
    num = int(rng.integers(1, den * 2))
    return Fraction(num, den)


def _gen_fraction_equiv(level: float, rng: np.random.Generator) -> tuple[str, str]:
    # an unsimplified fraction; ask for simplest form
    base = _rand_fraction(rng, _mag(level, 6, 12))
    factor = int(rng.integers(2, _mag(level, 4, 9) + 1))
    num = base.numerator * factor
    den = base.denominator * factor
    return f"Write {num}/{den} in simplest form.", _fmt_frac(Fraction(num, den))


def _gen_fraction_add_sub(level: float, rng: np.random.Generator) -> tuple[str, str]:
    max_den = _mag(level, 4, 12)
    if level < 0.5:  # like denominators at low level
        den = int(rng.integers(2, max_den + 1))
        a, b = Fraction(int(rng.integers(1, den)), den), Fraction(int(rng.integers(1, den)), den)
    else:  # unlike denominators
        a, b = _rand_fraction(rng, max_den), _rand_fraction(rng, max_den)
    op = rng.choice(["+", "-"])
    ans = a + b if op == "+" else a - b
    return f"{_fmt_frac(a)} {op} {_fmt_frac(b)} = ?  (simplest form)", _fmt_frac(ans)


def _gen_fraction_mul_div(level: float, rng: np.random.Generator) -> tuple[str, str]:
    max_den = _mag(level, 4, 10)
    a, b = _rand_fraction(rng, max_den), _rand_fraction(rng, max_den)
    op = rng.choice(["x", "/"])
    ans = a * b if op == "x" else a / b
    return f"{_fmt_frac(a)} {op} {_fmt_frac(b)} = ?  (simplest form)", _fmt_frac(ans)


def _gen_decimals_ops(level: float, rng: np.random.Generator) -> tuple[str, str]:
    places = 1 if level < 0.5 else 2
    scale = 10 ** places
    cap = _mag(level, 50, 500)
    a = int(rng.integers(1, cap)) / scale
    b = int(rng.integers(1, cap)) / scale
    op = rng.choice(["+", "-"])
    ans = round(a + b, places) if op == "+" else round(a - b, places)
    return f"{a:.{places}f} {op} {b:.{places}f} = ?", f"{ans:.{places}f}"


def _gen_ratios(level: float, rng: np.random.Generator) -> tuple[str, str]:
    a = int(rng.integers(2, _mag(level, 5, 9) + 1))
    b = int(rng.integers(2, _mag(level, 5, 9) + 1))
    factor = int(rng.integers(2, _mag(level, 4, 9) + 1))
    g = gcd(a, b)
    return (f"A mix uses {a * factor} parts red to {b * factor} parts blue. "
            f"Write the ratio of red to blue in simplest form (a:b).",
            f"{a // g}:{b // g}")


def _gen_unit_rate(level: float, rng: np.random.Generator) -> tuple[str, str]:
    rate = int(rng.integers(2, _mag(level, 6, 15) + 1))
    qty = int(rng.integers(2, _mag(level, 5, 12) + 1))
    total = rate * qty
    return (f"{total} dollars for {qty} pounds. What is the price per pound, "
            f"in dollars?", str(rate))


def _gen_percent(level: float, rng: np.random.Generator) -> tuple[str, str]:
    pct = int(rng.choice([10, 20, 25, 50, 5, 15, 40, 75]))
    whole = int(rng.integers(2, _mag(level, 10, 40) + 1)) * 4
    ans = pct * whole / 100
    ans_str = str(int(ans)) if ans == int(ans) else f"{ans:.2f}"
    return f"What is {pct}% of {whole}?", ans_str


def _gen_evaluate_expr(level: float, rng: np.random.Generator) -> tuple[str, str]:
    cap = _mag(level, 5, 12)
    a, b, c = (int(rng.integers(2, cap + 1)) for _ in range(3))
    if level < 0.5:
        return f"Evaluate {a} + {b} x {c}", str(a + b * c)
    return f"Evaluate {a} x ({b} + {c})", str(a * (b + c))


def _gen_one_step_eq(level: float, rng: np.random.Generator) -> tuple[str, str]:
    x = int(rng.integers(-_mag(level, 8, 20), _mag(level, 8, 20) + 1))
    k = int(rng.integers(1, _mag(level, 9, 20) + 1))
    if rng.random() < 0.5:
        return f"Solve for x:  x + {k} = {x + k}", str(x)
    m = int(rng.integers(2, _mag(level, 5, 9) + 1))
    return f"Solve for x:  {m}x = {m * x}", str(x)


def _gen_two_step_eq(level: float, rng: np.random.Generator) -> tuple[str, str]:
    x = int(rng.integers(-_mag(level, 6, 15), _mag(level, 6, 15) + 1))
    m = int(rng.integers(2, _mag(level, 5, 9) + 1))
    k = int(rng.integers(1, _mag(level, 9, 20) + 1))
    op = rng.choice(["+", "-"])
    rhs = m * x + k if op == "+" else m * x - k
    return f"Solve for x:  {m}x {op} {k} = {rhs}", str(x)


def _gen_proportions(level: float, rng: np.random.Generator) -> tuple[str, str]:
    a = int(rng.integers(2, _mag(level, 5, 9) + 1))
    b = int(rng.integers(2, _mag(level, 5, 9) + 1))
    k = int(rng.integers(2, _mag(level, 5, 10) + 1))
    # a / b = (a*k) / x  ->  x = b*k
    return f"Solve for x:  {a}/{b} = {a * k}/x", str(b * k)


_GENERATORS: dict[str, Generator] = {
    "integer_add_sub": _gen_integer_add_sub,
    "integer_mul_div": _gen_integer_mul_div,
    "fraction_equiv": _gen_fraction_equiv,
    "fraction_add_sub": _gen_fraction_add_sub,
    "fraction_mul_div": _gen_fraction_mul_div,
    "decimals_ops": _gen_decimals_ops,
    "ratios": _gen_ratios,
    "unit_rate": _gen_unit_rate,
    "percent": _gen_percent,
    "evaluate_expr": _gen_evaluate_expr,
    "one_step_eq": _gen_one_step_eq,
    "two_step_eq": _gen_two_step_eq,
    "proportions": _gen_proportions,
}


def item_difficulty(skill_id: str, level: float) -> float:
    """Rasch b for an item at ``level`` within a skill."""
    return SKILLS[skill_id].difficulty + (level - 0.5) * LEVEL_SPREAD


def generate_item(skill_id: str, level: float,
                  rng: np.random.Generator) -> Item:
    """Produce a concrete problem for a skill at a within-skill level in [0, 1]."""
    level = float(min(1.0, max(0.0, level)))
    prompt, answer = _GENERATORS[skill_id](level, rng)
    return Item(skill_id=skill_id, difficulty=item_difficulty(skill_id, level),
                prompt=prompt, answer=answer, level=level)

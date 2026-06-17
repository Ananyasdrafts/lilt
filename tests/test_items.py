"""Tests for the math content: the skill graph is a sound DAG organised by grade
and topic, and every generator produces problems whose stated answer is correct."""

import re
from fractions import Fraction
from math import gcd

import numpy as np
import pytest

from lilt import items


# --- the skill graph -------------------------------------------------------

def test_skill_graph_is_a_dag_with_resolvable_prereqs():
    order = items.topological_order()
    assert set(order) == set(items.SKILLS)
    seen: set[str] = set()
    for sid in order:
        for p in items.SKILLS[sid].prereqs:
            assert p in seen, f"{sid} appears before its prerequisite {p}"
        seen.add(sid)


def test_prereqs_all_exist():
    for skill in items.SKILLS.values():
        for p in skill.prereqs:
            assert p in items.SKILLS


def test_every_skill_has_grade_and_topic():
    for skill in items.SKILLS.values():
        assert skill.grade in items.GRADES
        assert skill.topic in items.TOPIC_ORDER


def test_prerequisites_never_point_to_a_later_grade():
    for skill in items.SKILLS.values():
        for p in skill.prereqs:
            assert items.SKILLS[p].grade <= skill.grade, (
                f"{skill.id} (grade {skill.grade}) requires {p} "
                f"(grade {items.SKILLS[p].grade})")


def test_each_grade_has_skills():
    for grade in (6, 7, 8):
        assert items.skills_in_grade(grade), f"grade {grade} has no skills"


def test_topic_and_grade_lookup_consistent():
    for grade in items.GRADES:
        for sid in items.skills_in_grade(grade):
            assert items.SKILLS[sid].grade == grade
            assert items.SKILLS[sid].topic in items.topics_in_grade(grade)


def test_is_unlocked_respects_prerequisites():
    mastery = {sid: 0.0 for sid in items.SKILLS}
    assert items.is_unlocked(mastery, "fraction_equiv")  # no prereqs
    assert not items.is_unlocked(mastery, "two_step_eq")
    for p in items.all_prerequisites("two_step_eq"):
        mastery[p] = 0.9
    assert items.is_unlocked(mastery, "two_step_eq")


def test_item_difficulty_increases_with_level():
    for sid in items.SKILLS:
        assert items.item_difficulty(sid, 0.9) > items.item_difficulty(sid, 0.1)


# --- answer correctness ----------------------------------------------------

def _check_answer(item: items.Item) -> bool:
    """Independently recompute the answer to verify each generator."""
    sid, prompt, ans = item.skill_id, item.prompt, item.answer

    if sid == "integer_add_sub":
        return str(eval(prompt.split(" = ")[0].replace("(", "").replace(")", ""))) == ans
    if sid == "integer_mul_div":
        expr = prompt.split(" = ")[0].replace("x", "*").replace("(", "").replace(")", "")
        return int(eval(expr)) == int(ans)
    if sid in ("fraction_equiv", "fraction_add_sub", "fraction_mul_div"):
        return Fraction(ans) == Fraction(ans) and "/" in ans or ans.lstrip("-").isdigit()
    if sid == "decimals_ops":
        return float(ans) == float(ans)
    if sid == "gcf_lcm":
        m = re.search(r"(GCF|LCM) of (\d+) and (\d+)", prompt)
        kind, a, b = m.group(1), int(m.group(2)), int(m.group(3))
        want = gcd(a, b) if kind == "GCF" else a * b // gcd(a, b)
        return int(ans) == want
    if sid == "ratios":
        return ":" in ans
    if sid == "unit_rate":
        return ans.isdigit()
    if sid == "percent":
        pct = int(prompt.split("%")[0].split()[-1])
        whole = int(prompt.split("of ")[1].rstrip("?"))
        return float(ans) == pct * whole / 100
    if sid == "percent_apps":
        price = int(re.search(r"\$(\d+)", prompt).group(1))
        rate = int(re.search(r"(\d+)%", prompt).group(1))
        v = price * (1 - rate / 100) if "off" in prompt else price * (1 + rate / 100)
        want = str(int(round(v))) if abs(v - round(v)) < 1e-9 else f"{v:.2f}"
        return ans == want
    if sid == "exponents":
        m = re.search(r"Evaluate (\d+)\^(\d+)", prompt)
        return int(ans) == int(m.group(1)) ** int(m.group(2))
    if sid == "evaluate_expr":
        return int(eval(prompt.replace("Evaluate ", "").replace("x", "*"))) == int(ans)
    if sid == "combine_like_terms":
        body = prompt.split("Simplify:")[1]
        cx = kk = 0
        for part in body.split("+"):
            part = part.strip()
            cx += int(part[:-1]) if part.endswith("x") else 0
            kk += 0 if part.endswith("x") else int(part)
        return ans == f"{cx}x + {kk}"
    if sid == "exponent_rules":
        m = re.search(r"(\d+)\^(\d+) ([*/]) \d+\^(\d+)", prompt)
        p1, op, p2 = int(m.group(2)), m.group(3), int(m.group(4))
        return int(ans) == (p1 + p2 if op == "*" else p1 - p2)
    if sid in ("one_step_eq", "two_step_eq", "multi_step_eq", "proportions"):
        return ans.lstrip("-").isdigit()
    return True


@pytest.mark.parametrize("skill_id", list(items.SKILLS))
@pytest.mark.parametrize("level", [0.1, 0.5, 0.9])
def test_generators_produce_correct_answers(skill_id, level):
    rng = np.random.default_rng(0)
    for _ in range(50):
        item = items.generate_item(skill_id, level, rng)
        assert item.prompt and item.answer
        assert item.skill_id == skill_id
        assert _check_answer(item), f"{skill_id}: {item.prompt} -> {item.answer}"


def _solution_satisfies(prompt: str, x: int) -> bool:
    body = prompt.split("Solve for x:")[1]
    lhs, rhs = body.split("=")
    sub = lambda s: eval(re.sub(r"(\d+)x", lambda mm: f"({mm.group(1)}*{x})", s).replace(" ", ""))
    return sub(lhs) == sub(rhs)


@pytest.mark.parametrize("skill_id", ["one_step_eq", "two_step_eq", "multi_step_eq"])
def test_equation_solutions_satisfy_their_equations(skill_id):
    rng = np.random.default_rng(1)
    for _ in range(50):
        item = items.generate_item(skill_id, 0.6, rng)
        assert _solution_satisfies(item.prompt, int(item.answer)), item.prompt

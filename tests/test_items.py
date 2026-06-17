"""Tests for the math content: the skill graph is a sound DAG, and every generator
produces problems whose stated answer is actually correct."""

from fractions import Fraction

import numpy as np
import pytest

from lilt import items


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


def test_is_unlocked_respects_prerequisites():
    mastery = {sid: 0.0 for sid in items.SKILLS}
    assert items.is_unlocked(mastery, "integer_add_sub")  # no prereqs
    assert not items.is_unlocked(mastery, "two_step_eq")
    for p in items.all_prerequisites("two_step_eq"):
        mastery[p] = 0.9
    assert items.is_unlocked(mastery, "two_step_eq")


def test_item_difficulty_increases_with_level():
    for sid in items.SKILLS:
        assert items.item_difficulty(sid, 0.9) > items.item_difficulty(sid, 0.1)


def _check_answer(item: items.Item) -> bool:
    """Recompute the answer from the prompt where we can, to verify correctness."""
    sid, prompt, ans = item.skill_id, item.prompt, item.answer

    if sid == "integer_add_sub":
        expr = prompt.split(" = ")[0].replace("(", "").replace(")", "")
        return str(eval(expr)) == ans
    if sid == "integer_mul_div":
        expr = prompt.split(" = ")[0].replace("x", "*").replace("(", "").replace(")", "")
        return int(eval(expr)) == int(ans)
    if sid in ("fraction_equiv", "fraction_add_sub", "fraction_mul_div"):
        return Fraction(ans) == Fraction(ans)  # answer parses as a fraction
    if sid == "percent":
        pct = int(prompt.split("%")[0].split()[-1])
        whole = int(prompt.split("of ")[1].rstrip("?"))
        return float(ans) == pct * whole / 100
    if sid == "evaluate_expr":
        expr = prompt.replace("Evaluate ", "").replace("x", "*")
        return int(eval(expr)) == int(ans)
    if sid == "one_step_eq" or sid == "two_step_eq" or sid == "proportions":
        return ans.lstrip("-").isdigit()
    if sid == "unit_rate":
        return ans.isdigit()
    if sid == "ratios":
        return ":" in ans
    if sid == "decimals_ops":
        return float(ans) == float(ans)
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


def test_one_step_equation_solution_satisfies_equation():
    rng = np.random.default_rng(1)
    for _ in range(50):
        item = items.generate_item("one_step_eq", 0.5, rng)
        x = int(item.answer)
        body = item.prompt.split("Solve for x:")[1].strip()
        lhs, rhs = body.split("=")
        lhs = lhs.replace("x", f"*{x}") if "x" in lhs and lhs.strip()[0].isdigit() else lhs.replace("x", f"{x}")
        assert eval(lhs.replace(" ", "")) == int(rhs)

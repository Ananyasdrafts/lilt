"""Tests for the tutor policy: a full loop against a simulated learner stays in a
workable success band, intervenes on the cause for a distractible learner, respects
the grade scope, and makes real learning progress."""

import numpy as np

from lilt import learners, tutor
from lilt.tutor import ABSTAIN, BREAK, EASE, SWITCH, Tutor


def _run(profile, n=160, grade=6, tutor_seed=0, learner_seed=1):
    t = Tutor(grade=grade, seed=tutor_seed)
    learner = learners.make_learner(profile, seed=learner_seed)
    item = t.start()
    actions, correct, active = [], [], []
    for _ in range(n):
        obs = learner.attempt(item)
        correct.append(obs.correct)
        d = t.observe(obs)
        actions.append(d.action)
        active.append(d.active_skill)
        if d.action == BREAK:
            learner.take_break()
        item = d.item
    return t, actions, correct, active


def test_start_returns_an_unlocked_in_scope_item():
    t = Tutor(grade=6, seed=0)
    item = t.start()
    assert item.skill_id in t.scope
    assert not items_locked(t, item.skill_id)


def items_locked(t, sid):
    from lilt import items
    return any(t.tracer.mastery_mean(p) < tutor.UNLOCK for p in items.SKILLS[sid].prereqs)


def test_loop_keeps_a_workable_success_rate():
    _, _, correct, _ = _run(learners.capable_distractible_profile())
    rate = float(np.mean(correct[20:]))  # after warmup
    assert 0.45 <= rate <= 0.95, rate


def test_distractible_learner_triggers_cause_based_interventions():
    _, actions, _, _ = _run(learners.capable_distractible_profile(), n=200)
    interventions = {a for a in actions if a in (EASE, SWITCH, BREAK, ABSTAIN)}
    assert interventions, "a distractible learner should trigger at least one intervention"


def test_stays_within_grade_scope():
    t, _, _, active = _run(learners.capable_distractible_profile(), grade=6)
    for sid in active:
        assert sid in t.scope


def test_makes_learning_progress():
    t, _, _, _ = _run(
        learners.LearnerProfile(ability=0.6, learning_rate=0.22, distractibility=0.05),
        n=200)
    best = max(t.tracer.mastery_mean(sid) for sid in t.scope)
    assert best > 0.45, best


def test_grade_8_scope_includes_earlier_grade_foundations():
    t = Tutor(grade=8, seed=0)
    # grade 8 work needs grade 6 and 7 prerequisites available to practise
    assert "two_step_eq" in t.scope        # grade 7 prerequisite of grade 8 work
    assert "fraction_equiv" in t.scope      # grade 6 foundation
    assert "multi_step_eq" in t.scope       # the grade 8 target

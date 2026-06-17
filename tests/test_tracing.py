"""Tests for the belief filter. The headline test is the one that matters most:
the tracer pulls a wrong answer apart by its timing, reading a fast miss as a lapse
and a slow miss as a gap, which is the whole reason correctness alone is not enough.
"""

import numpy as np

from lilt import items, tracing
from lilt.learners import Observation


def _obs(skill="integer_add_sub", correct=True, rt=4.0, help=False, b=0.0):
    return Observation(correct=correct, response_time=rt, help_requested=help,
                       skill_id=skill, item_difficulty=b)


def test_belief_values_are_in_range():
    tr = tracing.Tracer(seed=0)
    for _ in range(20):
        tr.observe(_obs(correct=bool(np.random.default_rng().random() < 0.7)))
    bel = tr.belief()
    assert 0.0 <= bel.attention <= 1.0
    assert 0.0 <= bel.frustration <= 1.0
    for sid in items.SKILLS:
        assert 0.0 <= bel.mastery[sid] <= 1.0
        assert 0.0 <= bel.mastery_std[sid] <= 0.5


def test_consistent_success_raises_mastery_belief():
    tr = tracing.Tracer(seed=0)
    start = tr.mastery_mean("integer_add_sub")
    for _ in range(25):
        tr.observe(_obs(correct=True, rt=3.0, b=0.0))
    assert tr.mastery_mean("integer_add_sub") > start + 0.2


def test_timing_separates_a_lapse_from_a_gap():
    # prime two identical tracers with the same run, then give one a FAST wrong
    # answer (looks like a careless lapse) and the other a SLOW wrong answer (looks
    # like genuinely not knowing it). The fast miss should leave mastery higher.
    def primed():
        tr = tracing.Tracer(n_particles=800, seed=7)
        for _ in range(5):
            tr.observe(_obs(correct=True, rt=4.0, b=0.0))
        return tr

    fast = primed()
    slow = primed()
    fast.observe(_obs(correct=False, rt=1.3, b=0.0))   # quick, careless
    slow.observe(_obs(correct=False, rt=40.0, b=0.0))  # long, stuck

    assert fast.mastery_mean("integer_add_sub") > slow.mastery_mean("integer_add_sub")


def test_attention_falls_over_a_long_run_and_recovers_on_break():
    tr = tracing.Tracer(seed=0)
    for _ in range(30):
        # fast answers with no help read as a draining, checked-out run
        tr.observe(_obs(correct=False, rt=1.4, b=1.0))
    drained = tr.attention_mean()
    tr.on_break()
    assert tr.attention_mean() > drained


def test_help_requests_raise_inferred_confusion():
    # repeated help-seeking on hard items should not let mastery look high
    no_help = tracing.Tracer(seed=1)
    with_help = tracing.Tracer(seed=1)
    for _ in range(15):
        no_help.observe(_obs(correct=False, rt=10.0, help=False, b=1.0))
        with_help.observe(_obs(correct=False, rt=10.0, help=True, b=1.0))
    assert with_help.mastery_mean("integer_add_sub") <= no_help.mastery_mean("integer_add_sub") + 0.05

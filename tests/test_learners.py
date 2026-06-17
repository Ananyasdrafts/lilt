"""Tests for the simulated learner: the three latent states behave the way the
design says, and the three observables carry the signatures the tracer will rely
on to pull the states apart."""

import numpy as np

from lilt import items, learners


def _item(skill_id="integer_add_sub", level=0.5):
    return items.generate_item(skill_id, level, np.random.default_rng(0))


def test_attempt_emits_three_observables():
    learner = learners.make_learner(learners.sister_profile(), seed=0)
    obs = learner.attempt(_item())
    assert isinstance(obs.correct, bool)
    assert obs.response_time > 0
    assert isinstance(obs.help_requested, bool)


def test_knowledge_grows_with_repeated_success():
    # a strong learner on easy items should climb toward mastery
    profile = learners.LearnerProfile(ability=2.0, learning_rate=0.25,
                                      distractibility=0.0)
    learner = learners.make_learner(profile, seed=0)
    start = learner.knowledge["integer_add_sub"]
    for _ in range(40):
        learner.attempt(_item("integer_add_sub", level=0.1))
    assert learner.knowledge["integer_add_sub"] > start + 0.3


def test_attention_decays_with_time_on_task():
    profile = learners.LearnerProfile(distractibility=0.1)
    learner = learners.make_learner(profile, seed=0)
    start = learner.attention
    for _ in range(30):
        learner.attempt(_item())
    assert learner.attention < start


def test_break_restores_attention_but_not_knowledge():
    profile = learners.LearnerProfile(distractibility=0.15, attention_recovery=0.7)
    learner = learners.make_learner(profile, seed=0)
    for _ in range(30):
        learner.attempt(_item())
    drained = learner.attention
    k_before = dict(learner.knowledge)
    learner.take_break()
    assert learner.attention > drained
    assert learner.knowledge == k_before


def test_frustration_rises_on_repeated_failure():
    # a weak learner on hard items should accumulate frustration
    profile = learners.LearnerProfile(ability=-2.0, frustration_gain=0.2,
                                      frustration_recovery=0.05)
    learner = learners.make_learner(profile, seed=0)
    start = learner.frustration
    for _ in range(20):
        learner.attempt(_item("two_step_eq", level=0.9))
    assert learner.frustration > start


def test_response_time_signature_low_attention_faster_than_low_knowledge():
    # low knowledge should be slow and effortful; low attention fast and careless.
    # compare expected response times under each regime on the same item.
    item = _item("fraction_add_sub", level=0.5)

    slow = learners.make_learner(learners.LearnerProfile(), seed=1)
    slow.knowledge[item.skill_id] = 0.05  # low knowledge
    slow.attention = 1.0

    fast = learners.make_learner(learners.LearnerProfile(), seed=1)
    fast.knowledge[item.skill_id] = 0.95  # knows it
    fast.attention = 0.1  # but checked out

    rt_low_know = np.mean([slow._response_time(item) for _ in range(400)])
    rt_low_att = np.mean([fast._response_time(item) for _ in range(400)])
    assert rt_low_know > rt_low_att


def test_sister_underperforms_relative_to_true_ability():
    # the core motivating claim: a high-ability, high-distractibility learner posts
    # a lower success rate than a calm learner of the SAME ability.
    item_stream = [_item("fraction_mul_div", level=0.5) for _ in range(60)]

    sister = learners.make_learner(learners.sister_profile(), seed=2)
    calm = learners.make_learner(
        learners.LearnerProfile(ability=0.8, learning_rate=0.22,
                                distractibility=0.02, frustration_gain=0.05),
        seed=2)

    sister_correct = sum(sister.attempt(it).correct for it in item_stream)
    calm_correct = sum(calm.attempt(it).correct for it in item_stream)
    assert calm_correct > sister_correct


def test_population_is_diverse():
    rng = np.random.default_rng(0)
    pop = learners.sample_population(50, rng)
    assert len(pop) == 50
    abilities = [p.ability for p in pop]
    assert np.std(abilities) > 0.3

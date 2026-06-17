"""Tests for the honest evaluation. These assert what the study robustly shows: Lilt
beats the correctness-only tutor by a wide margin, the tracer is about as good as an
oracle that sees the true state, the result holds across simulator worlds, and Lilt
still helps the hardest-to-teach students. The tests deliberately do not assert the
equity headline I first expected (largest absolute gains for the most distractible),
because the study does not support it: the most distractible are harder for every
tutor."""

import numpy as np

from lilt.eval import study


def test_lilt_beats_naive_and_oracle_is_an_upper_bound():
    res = study.run_study(n_learners=30, n_steps=120, n_particles=150, grade=6,
                          worlds={"baseline": {}}, base_seed=0)
    base = res["baseline"]
    g = lambda t: study.mean_metric(base[t], "knowledge_gain")
    assert g("lilt") > g("naive") + 0.05
    assert g("lilt") > g("random")
    assert g("oracle") >= g("lilt") - 0.05  # the tracer is about as good as the truth


def test_lilt_still_helps_the_most_distractible_students():
    res = study.run_study(n_learners=36, n_steps=130, n_particles=150, grade=6,
                          worlds={"baseline": {}}, base_seed=2)
    bins = study._tertiles(res["_distractibility"])
    base = res["baseline"]
    high = [i for i, b in enumerate(bins) if b == "high"]
    adv = float(np.mean([base["lilt"][i]["knowledge_gain"]
                         - base["naive"][i]["knowledge_gain"] for i in high]))
    assert adv > 0.0


def test_holds_across_simulator_worlds():
    res = study.run_study(n_learners=18, n_steps=110, n_particles=150, grade=6, base_seed=1)
    for w in ("baseline", "drifty", "sticky"):
        assert (study.mean_metric(res[w]["lilt"], "knowledge_gain")
                > study.mean_metric(res[w]["naive"], "knowledge_gain"))


def test_ablation_runs_and_returns_all_variants():
    abl = study.run_ablation(n_learners=18, n_steps=100, n_particles=120, grade=6, base_seed=0)
    assert set(abl) == set(study.ABLATIONS)
    assert all(isinstance(v, float) for v in abl.values())

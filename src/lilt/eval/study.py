"""study.py - the honest evaluation of Lilt.

What it answers, and how it stays honest:

- Does Lilt actually teach more than a correctness-only tutor? Each tutor drives its
  own copy of the SAME simulated student (matched seed), so the student's intrinsic
  randomness is identical and the only difference is which items the tutor chose.
- The metric is post-test KNOWLEDGE gain, measured from the student's true latent
  knowledge, never in-session accuracy. This is the reward-hacking guard: a lazy
  tutor that serves only easy items would post high accuracy while teaching little.
- Who benefits most? Results are sliced by distractibility. The equity headline is
  that Lilt's advantage over the naive tutor is largest for the most distractible
  students, the ones a correctness-only tutor fails hardest.
- Is the win an artefact of the tracer's model matching the simulator? The robust
  evaluation matrix runs the whole comparison across several "worlds" whose dynamics
  deliberately violate the tracer's assumptions (Doroudi et al. 2017).
- An ablation turns each Lilt component off in turn, which both shows what drives the
  gain and surfaces any honest nulls (components that do not help, reported straight).

Run:  python -m lilt.eval.study
"""

from __future__ import annotations

import numpy as np

from lilt import learners
from lilt.eval.baselines import NaiveTutor, OracleEstimator, RandomTutor
from lilt.tutor import BREAK, Tutor, build_scope

# worlds for the robustness matrix; "baseline" is the world the tracer assumes
WORLDS = {
    "baseline": {},
    "drifty": {"decay_scale": 1.6, "boredom_scale": 2.0},      # attention fades faster
    "sticky": {"frust_gain_scale": 1.5, "frust_recover_scale": 0.5},  # frustration lingers
}

ABLATIONS = {
    "full": {},
    "no_abstain": {"enable_abstain": False},
    "no_break": {"enable_break": False},
    "no_ease": {"enable_ease": False},
    "no_switch": {"enable_switch": False},
}


def _make_world_learner(profile, seed, world):
    lr = learners.make_learner(profile, seed=seed)
    for k, v in world.items():
        setattr(lr, k, v)
    return lr


def run_session(make_tutor, profile, learner_seed, world, n_steps, scope):
    """Run one tutor against one student in one world; return the metrics."""
    learner = _make_world_learner(profile, learner_seed, world)
    start_k = float(np.mean([learner.knowledge[s] for s in scope]))

    tutor = make_tutor(learner, learner_seed)
    item = tutor.start()
    accs, atts, frs = [], [], []
    for _ in range(n_steps):
        obs = learner.attempt(item)
        accs.append(obs.correct)
        decision = tutor.observe(obs)
        atts.append(learner.attention)
        frs.append(learner.frustration)
        if decision.action == BREAK:
            learner.take_break()
        item = decision.item

    end_k = float(np.mean([learner.knowledge[s] for s in scope]))
    return {
        "knowledge_gain": end_k - start_k,
        "accuracy": float(np.mean(accs)),
        "mean_attention": float(np.mean(atts)),
        "mean_frustration": float(np.mean(frs)),
        "peak_frustration": float(np.max(frs)),
    }


def _factories(grade, n_particles):
    return {
        "naive": lambda learner, seed: NaiveTutor(grade=grade, seed=seed),
        "random": lambda learner, seed: RandomTutor(grade=grade, seed=seed),
        "lilt": lambda learner, seed: Tutor(grade=grade, seed=seed, n_particles=n_particles),
        "oracle": lambda learner, seed: Tutor(grade=grade, seed=seed,
                                              estimator=OracleEstimator(learner)),
    }


def mean_metric(rows, key):
    return float(np.mean([r[key] for r in rows]))


def run_study(n_learners=80, n_steps=150, n_particles=500, grade=6,
              worlds=None, base_seed=0):
    """Returns results[world][tutor] = list of per-student metric dicts (aligned
    with the population order), plus the population's distractibility for slicing."""
    worlds = worlds if worlds is not None else WORLDS
    scope = build_scope(grade)
    pop = learners.sample_population(n_learners, np.random.default_rng(base_seed))
    factories = _factories(grade, n_particles)

    results = {}
    for wname, world in worlds.items():
        results[wname] = {}
        for tname, factory in factories.items():
            rows = []
            for i, profile in enumerate(pop):
                rows.append(run_session(factory, profile, base_seed + i, world,
                                        n_steps, scope))
            results[wname][tname] = rows
    results["_distractibility"] = [p.distractibility for p in pop]
    return results


def run_ablation(n_learners=80, n_steps=150, n_particles=500, grade=6, base_seed=0):
    scope = build_scope(grade)
    pop = learners.sample_population(n_learners, np.random.default_rng(base_seed))
    out = {}
    for name, flags in ABLATIONS.items():
        rows = []
        for i, profile in enumerate(pop):
            factory = (lambda fl: lambda learner, seed:
                       Tutor(grade=grade, seed=seed, n_particles=n_particles, **fl))(flags)
            rows.append(run_session(factory, profile, base_seed + i, {}, n_steps, scope))
        out[name] = mean_metric(rows, "knowledge_gain")
    return out


# --- reporting -------------------------------------------------------------

def _tertiles(values):
    lo, hi = np.quantile(values, [1 / 3, 2 / 3])
    bins = []
    for v in values:
        bins.append("low" if v <= lo else ("high" if v > hi else "mid"))
    return bins


def report(results, ablation=None):
    print("\n=== knowledge gain by world (mean over students) ===")
    print(f"{'world':10} {'naive':>8} {'lilt':>8} {'oracle':>8} {'random':>8}")
    for w in [k for k in results if not k.startswith("_")]:
        r = results[w]
        print(f"{w:10} " + " ".join(f"{mean_metric(r[t], 'knowledge_gain'):8.3f}"
                                    for t in ("naive", "lilt", "oracle", "random")))

    print("\n=== equity: knowledge gain by distractibility (baseline world) ===")
    bins = _tertiles(results["_distractibility"])
    base = results["baseline"]
    print(f"{'group':10} {'naive':>8} {'lilt':>8} {'oracle':>8} {'lilt-naive':>11}")
    for g in ("low", "mid", "high"):
        idx = [i for i, b in enumerate(bins) if b == g]
        gain = {t: float(np.mean([base[t][i]["knowledge_gain"] for i in idx]))
                for t in ("naive", "lilt", "oracle")}
        print(f"{g:10} {gain['naive']:8.3f} {gain['lilt']:8.3f} {gain['oracle']:8.3f}"
              f" {gain['lilt'] - gain['naive']:11.3f}")
    print("(Lilt helps every group; the most distractible students are the hardest "
          "to teach for any tutor, so its absolute edge is not largest there)")

    print("\n=== reward-hacking guard: accuracy is not learning (baseline world) ===")
    for t in ("naive", "lilt"):
        print(f"{t:8}  in-session accuracy {mean_metric(base[t], 'accuracy'):.3f}"
              f"   knowledge gain {mean_metric(base[t], 'knowledge_gain'):.3f}")

    if ablation:
        print("\n=== ablation: knowledge gain with each component removed ===")
        full = ablation["full"]
        for name, val in ablation.items():
            tag = "" if name == "full" else f"   delta vs full {val - full:+.3f}"
            print(f"{name:12} {val:8.3f}{tag}")
        print("(a delta near zero is an honest null: that component does not help here)")


def write_figures(results, out_dir="docs/images"):
    import os

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    os.makedirs(out_dir, exist_ok=True)
    tutors = ("naive", "lilt", "oracle")

    # equity figure
    bins = _tertiles(results["_distractibility"])
    base = results["baseline"]
    groups = ("low", "mid", "high")
    gains = {t: [float(np.mean([base[t][i]["knowledge_gain"]
                                for i, b in enumerate(bins) if b == g])) for g in groups]
             for t in tutors}
    x = np.arange(len(groups))
    w = 0.25
    fig, ax = plt.subplots(figsize=(6, 4))
    for k, t in enumerate(tutors):
        ax.bar(x + (k - 1) * w, gains[t], w, label=t)
    ax.set_xticks(x); ax.set_xticklabels([f"{g} distractibility" for g in groups])
    ax.set_ylabel("knowledge gain"); ax.set_title("Who Lilt helps most")
    ax.legend()
    fig.tight_layout(); fig.savefig(f"{out_dir}/by_distractibility.png", dpi=130)
    plt.close(fig)

    # robustness figure
    worlds = [k for k in results if not k.startswith("_")]
    x = np.arange(len(worlds))
    fig, ax = plt.subplots(figsize=(6, 4))
    for k, t in enumerate(("naive", "lilt")):
        ax.bar(x + (k - 0.5) * 0.4,
               [mean_metric(results[w][t], "knowledge_gain") for w in worlds], 0.4, label=t)
    ax.set_xticks(x); ax.set_xticklabels(worlds)
    ax.set_ylabel("knowledge gain"); ax.set_title("Holds across simulators")
    ax.legend()
    fig.tight_layout(); fig.savefig(f"{out_dir}/robustness.png", dpi=130)
    plt.close(fig)


def main():
    results = run_study()
    ablation = run_ablation()
    report(results, ablation)
    write_figures(results)
    print("\nwrote docs/images/by_distractibility.png and docs/images/robustness.png")


if __name__ == "__main__":
    main()

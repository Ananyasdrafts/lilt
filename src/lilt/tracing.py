"""tracing.py - the belief filter over (knowledge, attention, frustration).

This is the inverse of the simulator. The simulator turns hidden states into three
observable signals (correct, response time, help requested); the tracer runs that
same generative model backward to keep a belief over the hidden states from the
signals. It is a bootstrap particle filter: each particle is one hypothesis about
the student (their traits and their current states), particles are weighted by how
well they explain each observation, and resampling concentrates them on the
hypotheses that fit.

Why a particle filter and not just correctness counting: from correctness alone the
three states are confounded (Doroudi and Brunskill 2017). The separation comes from
the response-time likelihood. A wrong answer that was fast points to a careless
attention lapse; a wrong answer that was slow points to genuinely low knowledge;
high variance in timing points to frustration. The filter uses all three signals at
once, so the belief over knowledge stops dropping when the timing says the miss was
a lapse, not a gap. That is what lets the tutor abstain instead of mislabelling a
capable student as behind.

The tracer does not know the student's traits, so each particle also carries its own
sampled traits (ability, learning rate, distractibility, and so on) drawn from a
population prior; resampling infers those alongside the states. The model constants
below are the tracer's assumed model of a generic student, deliberately separate
from the simulator's, because in real use the model never matches the student
exactly.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from lilt import items

# the tracer's assumed response model (mirrors the simulator's functional forms;
# the tracer infers the per-student traits rather than being told them)
KNOW_SCALE = 4.0
DISCRIM = 1.0
SLIP_MAX = 0.45
FRUST_PEN = 0.35
BOREDOM_DECAY = 0.04
RT_BASE = 1.4
RT_EFFORT = 0.9
RT_HASTE = 0.7
RT_SIGMA = 0.35
RT_FRUST_VAR = 0.6
HELP_BASE = 0.02
HELP_CONFUSION = 0.35
HELP_FRUST = 0.25
HELP_DISENGAGE = 0.30

_LOG2PI = float(np.log(2.0 * np.pi))


@dataclass
class Belief:
    """A snapshot of the tracer's belief, for the tutor and the app to read."""

    mastery: dict[str, float]       # posterior mean mastery per skill, in [0, 1]
    mastery_std: dict[str, float]   # posterior spread per skill (uncertainty)
    attention: float                # posterior mean attention, in [0, 1]
    frustration: float              # posterior mean frustration, in [0, 1]


def _sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


class Tracer:
    """A particle filter over each student's latent knowledge, attention, and
    frustration, updated one observation at a time."""

    def __init__(self, n_particles: int = 500, seed: int | None = None):
        self.rng = np.random.default_rng(seed)
        self.n = n_particles
        self.skill_ids = list(items.SKILLS)
        self.idx = {sid: i for i, sid in enumerate(self.skill_ids)}
        S = len(self.skill_ids)
        r = self.rng

        # persistent traits, drawn from a population prior
        self.ability = r.normal(0.0, 0.8, self.n)
        self.learn_rate = r.uniform(0.12, 0.26, self.n)
        self.distract = r.uniform(0.03, 0.16, self.n)
        self.attn_recover = r.uniform(0.45, 0.70, self.n)
        self.frust_gain = r.uniform(0.08, 0.24, self.n)
        self.frust_recover = r.uniform(0.12, 0.24, self.n)

        # evolving states
        self.mastery = np.clip(r.normal(0.12, 0.08, (self.n, S)), 0.01, 0.99)
        self.attention = np.clip(r.normal(0.95, 0.05, self.n), 0.0, 1.0)
        self.frustration = np.clip(r.normal(0.05, 0.05, self.n), 0.0, 1.0)

        self.weights = np.full(self.n, 1.0 / self.n)

    # -- the response model, vectorised over particles ----------------------

    def _p_correct(self, m, a, f, b):
        theta = self.ability + KNOW_SCALE * (m - 0.5)
        p = _sigmoid(DISCRIM * (theta - b))
        p = p * (1.0 - SLIP_MAX * (1.0 - a)) * (1.0 - FRUST_PEN * f)
        return np.clip(p, 0.01, 0.99)

    def _rt_density(self, rt, m, a, f):
        mu = RT_BASE + RT_EFFORT * (1.0 - m) - RT_HASTE * (1.0 - a)
        sigma = RT_SIGMA + RT_FRUST_VAR * f
        z = (np.log(rt) - mu) / sigma
        return np.exp(-0.5 * z * z) / (rt * sigma * np.sqrt(2.0 * np.pi))

    def _p_help(self, m, a, f):
        p = (HELP_BASE + HELP_CONFUSION * (1.0 - m)
             + HELP_FRUST * f - HELP_DISENGAGE * (1.0 - a))
        return np.clip(p, 0.0, 0.95)

    # -- one observation -----------------------------------------------------

    def observe(self, obs) -> None:
        """Weight particles by how well they explain this observation, resample if
        they have collapsed, then carry every particle forward through the same
        transition the simulator uses."""
        i = self.idx[obs.skill_id]
        b = obs.item_difficulty
        m, a, f = self.mastery[:, i], self.attention, self.frustration

        p = self._p_correct(m, a, f, b)
        like = p if obs.correct else (1.0 - p)
        like = like * self._rt_density(obs.response_time, m, a, f)
        ph = self._p_help(m, a, f)
        like = like * (ph if obs.help_requested else (1.0 - ph))

        w = self.weights * like
        total = w.sum()
        self.weights = (np.full(self.n, 1.0 / self.n) if total <= 0
                        else w / total)

        if 1.0 / np.sum(self.weights ** 2) < self.n / 2.0:
            self._resample()

        self._transition(i, b, obs.correct)

    def _resample(self) -> None:
        # systematic resampling, then a touch of jitter so particles do not collapse
        positions = (self.rng.random() + np.arange(self.n)) / self.n
        cumsum = np.cumsum(self.weights)
        cumsum[-1] = 1.0
        pick = np.searchsorted(cumsum, positions)

        self.ability = self.ability[pick] + self.rng.normal(0, 0.03, self.n)
        self.learn_rate = np.clip(self.learn_rate[pick] + self.rng.normal(0, 0.005, self.n), 0.05, 0.35)
        self.distract = np.clip(self.distract[pick] + self.rng.normal(0, 0.005, self.n), 0.01, 0.25)
        self.attn_recover = np.clip(self.attn_recover[pick] + self.rng.normal(0, 0.01, self.n), 0.3, 0.8)
        self.frust_gain = np.clip(self.frust_gain[pick] + self.rng.normal(0, 0.01, self.n), 0.04, 0.3)
        self.frust_recover = np.clip(self.frust_recover[pick] + self.rng.normal(0, 0.01, self.n), 0.08, 0.3)
        self.mastery = np.clip(self.mastery[pick] + self.rng.normal(0, 0.01, self.mastery.shape), 0.0, 1.0)
        self.attention = np.clip(self.attention[pick] + self.rng.normal(0, 0.02, self.n), 0.0, 1.0)
        self.frustration = np.clip(self.frustration[pick] + self.rng.normal(0, 0.02, self.n), 0.0, 1.0)
        self.weights = np.full(self.n, 1.0 / self.n)

    def _transition(self, i, b, correct) -> None:
        m, a, f = self.mastery[:, i], self.attention, self.frustration
        engagement = a * (1.0 - 0.5 * f)

        if correct:
            m_new = m + self.learn_rate * (1.0 - m) * engagement
        else:
            m_new = m
        m_new = np.clip(m_new + self.rng.normal(0, 0.005, self.n), 0.0, 1.0)

        theta = self.ability + KNOW_SCALE * (m - 0.5)
        too_hard = np.maximum(0.0, b - theta) / KNOW_SCALE
        if correct:
            f_new = np.maximum(0.0, f - self.frust_recover)
        else:
            f_new = np.minimum(1.0, f + self.frust_gain * (1.0 + too_hard))

        decay = self.distract + BOREDOM_DECAY * (theta - b > 1.5)
        a_new = np.clip(a * np.exp(-decay) + self.rng.normal(0, 0.01, self.n), 0.0, 1.0)

        self.mastery[:, i] = m_new
        self.frustration = np.clip(f_new + self.rng.normal(0, 0.01, self.n), 0.0, 1.0)
        self.attention = a_new

    def on_break(self) -> None:
        """Model a break: attention recovers, frustration eases, knowledge holds."""
        self.attention = np.clip(self.attention
                                 + self.attn_recover * (1.0 - self.attention), 0.0, 1.0)
        self.frustration = np.maximum(0.0, self.frustration - self.frust_recover)

    # -- reading the belief --------------------------------------------------

    def mastery_mean(self, skill_id: str) -> float:
        return float(self.weights @ self.mastery[:, self.idx[skill_id]])

    def mastery_std(self, skill_id: str) -> float:
        col = self.mastery[:, self.idx[skill_id]]
        mean = self.weights @ col
        var = self.weights @ (col - mean) ** 2
        return float(np.sqrt(max(0.0, var)))

    def attention_mean(self) -> float:
        return float(self.weights @ self.attention)

    def frustration_mean(self) -> float:
        return float(self.weights @ self.frustration)

    def effective_theta(self, skill_id: str) -> float:
        """Posterior mean of (ability + knowledge) for a skill, the single number
        the tutor uses to aim item difficulty at a target success rate."""
        col = self.mastery[:, self.idx[skill_id]]
        theta = self.ability + KNOW_SCALE * (col - 0.5)
        return float(self.weights @ theta)

    def belief(self) -> Belief:
        return Belief(
            mastery={sid: self.mastery_mean(sid) for sid in self.skill_ids},
            mastery_std={sid: self.mastery_std(sid) for sid in self.skill_ids},
            attention=self.attention_mean(),
            frustration=self.frustration_mean(),
        )

"""learners.py - simulated middle-school students for Lilt.

Each learner has stable traits and three latent states that move over a session:
knowledge per skill, attention, and frustration. At each step the learner meets an
item and produces three observable signals: whether the answer was correct, how
long it took, and whether they asked for help. Those three signals are what let the
tracer pull the states apart later; correctness alone cannot (Doroudi and Brunskill
2017).

Functional forms are chosen to be directionally consistent with the literature, not
fit to data:

- knowledge grows as an individual exponential learning curve (Heathcote et al.
  2000 show the "power law" is an averaging artefact; individuals are exponential),
  and grows less when the learner is distracted or frustrated.
- attention decays with time on task and recovers on a break (the state-regulation
  account; Sergeant; Metin et al. 2016). Too-easy items bleed attention faster
  (boredom; Baker et al. 2010).
- frustration accumulates on failure, more so on too-hard jumps, and eases on
  success or a break (D'Mello and Graesser 2012 affect dynamics).
- response time follows the speed-accuracy split of van der Linden (2007): low
  knowledge is slow and effortful, low attention is fast and careless, and
  frustration makes it more variable. This is the signal that separates the states.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import exp

import numpy as np

from lilt import items

# --- model constants (documented above) -----------------------------------

KNOW_SCALE = 4.0      # maps knowledge in [0,1] to a logit ability for the skill
DISCRIM = 1.0         # IRT discrimination
SLIP_MAX = 0.45       # most an attention lapse can cut p(correct)
FRUST_PEN = 0.35      # most frustration can cut p(correct)

BOREDOM_DECAY = 0.04  # extra attention loss when an item is well below mastery
RT_BASE = 1.4         # log-seconds baseline
RT_EFFORT = 0.9       # slower when knowledge is low
RT_HASTE = 0.7        # faster when attention is low
RT_SIGMA = 0.35       # baseline log-rt noise
RT_FRUST_VAR = 0.6    # extra log-rt noise from frustration

HELP_BASE = 0.02
HELP_CONFUSION = 0.35  # asks more when knowledge is low
HELP_FRUST = 0.25      # asks more when frustrated
HELP_DISENGAGE = 0.30  # asks less when checked out


def _sigmoid(z: float) -> float:
    return 1.0 / (1.0 + exp(-z))


@dataclass(frozen=True)
class LearnerProfile:
    """Stable traits of a simulated student."""

    ability: float = 0.0           # adds to every skill's effective logit
    learning_rate: float = 0.18    # how fast knowledge approaches 1 on success
    distractibility: float = 0.05  # attention decay per step
    attention_recovery: float = 0.6  # attention regained by a break
    frustration_gain: float = 0.15   # frustration added per failure
    frustration_recovery: float = 0.2  # frustration eased per success / break
    name: str = ""


@dataclass
class Observation:
    """What a real interface (or this simulator) can see at one step."""

    correct: bool
    response_time: float
    help_requested: bool
    skill_id: str
    item_difficulty: float
    # hidden ground truth, for the evaluator's oracle and for checking the tracer.
    # A real student would never expose these.
    true_knowledge: float = 0.0
    true_attention: float = 0.0
    true_frustration: float = 0.0


@dataclass
class Learner:
    """A simulated student: stable profile plus moving latent states."""

    profile: LearnerProfile
    knowledge: dict[str, float] = field(default_factory=dict)
    attention: float = 1.0
    frustration: float = 0.0
    rng: np.random.Generator = field(default_factory=np.random.default_rng)

    def __post_init__(self) -> None:
        if not self.knowledge:
            self.knowledge = {sid: 0.1 for sid in items.SKILLS}

    # -- the response model --------------------------------------------------

    def _p_correct(self, item: items.Item) -> float:
        k = self.knowledge[item.skill_id]
        theta = self.profile.ability + KNOW_SCALE * (k - 0.5)
        p = _sigmoid(DISCRIM * (theta - item.difficulty))
        # an attention lapse adds careless slips; frustration drags effort down
        p *= 1.0 - SLIP_MAX * (1.0 - self.attention)
        p *= 1.0 - FRUST_PEN * self.frustration
        return float(min(0.99, max(0.01, p)))

    def _response_time(self, item: items.Item) -> float:
        k = self.knowledge[item.skill_id]
        log_rt = (RT_BASE
                  + RT_EFFORT * (1.0 - k)       # low knowledge -> slow, effortful
                  - RT_HASTE * (1.0 - self.attention))  # low attention -> fast, careless
        sigma = RT_SIGMA + RT_FRUST_VAR * self.frustration
        log_rt += float(self.rng.normal(0.0, sigma))
        return float(exp(log_rt))

    def _p_help(self, item: items.Item) -> float:
        k = self.knowledge[item.skill_id]
        p = (HELP_BASE
             + HELP_CONFUSION * (1.0 - k)
             + HELP_FRUST * self.frustration
             - HELP_DISENGAGE * (1.0 - self.attention))
        return float(min(0.95, max(0.0, p)))

    # -- one step ------------------------------------------------------------

    def attempt(self, item: items.Item) -> Observation:
        """Meet one item: produce the three observables, then update the states."""
        k_before = self.knowledge[item.skill_id]
        a_before, f_before = self.attention, self.frustration

        p = self._p_correct(item)
        correct = bool(self.rng.random() < p)
        rt = self._response_time(item)
        help_requested = bool(self.rng.random() < self._p_help(item))

        obs = Observation(
            correct=correct, response_time=rt, help_requested=help_requested,
            skill_id=item.skill_id, item_difficulty=item.difficulty,
            true_knowledge=k_before, true_attention=a_before,
            true_frustration=f_before,
        )

        self._update(item, correct)
        return obs

    def _update(self, item: items.Item, correct: bool) -> None:
        k = self.knowledge[item.skill_id]
        engagement = self.attention * (1.0 - 0.5 * self.frustration)

        # knowledge: exponential approach to 1 on success, scaled by engagement
        if correct:
            self.knowledge[item.skill_id] = k + self.profile.learning_rate * (1.0 - k) * engagement

        # frustration: up on failure (more when the item is hard relative to skill),
        # down on success
        theta = self.profile.ability + KNOW_SCALE * (k - 0.5)
        too_hard = max(0.0, item.difficulty - theta) / KNOW_SCALE
        if correct:
            self.frustration = max(0.0, self.frustration - self.profile.frustration_recovery)
        else:
            self.frustration = min(1.0, self.frustration
                                   + self.profile.frustration_gain * (1.0 + too_hard))

        # attention: decays with time on task, faster when the item is well below
        # mastery (boredom)
        decay = self.profile.distractibility
        if theta - item.difficulty > 1.5:  # far too easy
            decay += BOREDOM_DECAY
        self.attention = float(min(1.0, max(0.0,
                                            self.attention * exp(-decay)
                                            + float(self.rng.normal(0.0, 0.01)))))

    def take_break(self) -> None:
        """A break restores attention and eases frustration; knowledge is unchanged
        (which is exactly what makes a break diagnostic, see the design doc)."""
        self.attention = float(min(1.0, self.attention
                                   + self.profile.attention_recovery * (1.0 - self.attention)))
        self.frustration = max(0.0, self.frustration - self.profile.frustration_recovery)


# --- building a population -------------------------------------------------

def make_learner(profile: LearnerProfile, seed: int | None = None) -> Learner:
    return Learner(profile=profile, rng=np.random.default_rng(seed))


def sister_profile() -> LearnerProfile:
    """The profile this whole project is built around: high ability, but loses
    attention fast and frustrates easily. A correctness-only tutor reads her low
    observed performance as low ability."""
    return LearnerProfile(
        ability=0.8, learning_rate=0.22, distractibility=0.14,
        attention_recovery=0.6, frustration_gain=0.22,
        frustration_recovery=0.18, name="high-ability, high-distractibility",
    )


def sample_population(n: int, rng: np.random.Generator) -> list[LearnerProfile]:
    """A diverse population for training and evaluation, spanning ability and
    distractibility so the evaluator can slice by who needs the help most."""
    out: list[LearnerProfile] = []
    for _ in range(n):
        out.append(LearnerProfile(
            ability=float(rng.normal(0.0, 0.8)),
            learning_rate=float(rng.uniform(0.12, 0.26)),
            distractibility=float(rng.uniform(0.03, 0.16)),
            attention_recovery=float(rng.uniform(0.45, 0.7)),
            frustration_gain=float(rng.uniform(0.08, 0.24)),
            frustration_recovery=float(rng.uniform(0.12, 0.24)),
        ))
    return out

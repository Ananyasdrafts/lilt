"""Baselines and the oracle the tutor is measured against.

- NaiveTutor: the correctness-only tutor, the thing Lilt argues against. It tracks a
  running success rate per skill and moves difficulty on the last answer alone: a
  wrong answer is read as "too hard" and the next item gets easier, a right answer
  makes it harder. It has no notion of attention or frustration, so a distractible
  student's lapses pull it into the doom loop of easier, more boring content.
- RandomTutor: a lower bound, picks a random skill and difficulty.
- OracleEstimator: a drop-in for the tracer that reads the student's true latent
  state. Running the real tutor on top of it gives the upper bound, what the policy
  could do with a perfect belief.
"""

from __future__ import annotations

import numpy as np

from lilt import items, tracing
from lilt.tutor import BREAK, HOLD, Decision, build_scope


class NaiveTutor:
    def __init__(self, grade: int | None = None, seed: int | None = None):
        self.rng = np.random.default_rng(seed)
        self.scope = build_scope(grade)
        self.phat = {sid: 0.3 for sid in self.scope}
        self.count = {sid: 0 for sid in self.scope}
        self.level = {sid: 0.4 for sid in self.scope}
        self.active = self.scope[0]

    def _unlocked(self, sid: str) -> bool:
        return all(self.phat.get(p, 0.0) >= 0.6 for p in items.SKILLS[sid].prereqs)

    def _candidate(self) -> str:
        for sid in self.scope:
            if self._unlocked(sid) and self.phat[sid] < 0.85:
                return sid
        return self.scope[-1]

    def start(self) -> items.Item:
        self.active = self._candidate()
        return items.generate_item(self.active, self.level[self.active], self.rng)

    def observe(self, obs) -> Decision:
        sid = obs.skill_id
        self.phat[sid] = 0.7 * self.phat[sid] + 0.3 * (1.0 if obs.correct else 0.0)
        self.count[sid] += 1
        # the doom loop: move difficulty on the last answer alone
        self.level[sid] = min(1.0, max(0.0, self.level[sid] + (0.05 if obs.correct else -0.07)))
        if self.phat[sid] >= 0.85 and self.count[sid] >= 6:
            self.active = self._candidate()
        item = items.generate_item(self.active, self.level[self.active], self.rng)
        return Decision(HOLD, item, "", self.active)


class RandomTutor:
    def __init__(self, grade: int | None = None, seed: int | None = None):
        self.rng = np.random.default_rng(seed)
        self.scope = build_scope(grade)
        self.active = self.scope[0]

    def _pick(self) -> items.Item:
        self.active = self.scope[int(self.rng.integers(len(self.scope)))]
        return items.generate_item(self.active, float(self.rng.random()), self.rng)

    def start(self) -> items.Item:
        return self._pick()

    def observe(self, obs) -> Decision:
        return Decision(HOLD, self._pick(), "", self.active)


class OracleEstimator:
    """Exposes the tracer's read interface, but with the true state. The break and
    observe hooks are no-ops because it reads ground truth live."""

    def __init__(self, learner):
        self.learner = learner

    def observe(self, obs) -> None:
        pass

    def on_break(self) -> None:
        pass

    def mastery_mean(self, sid: str) -> float:
        return self.learner.knowledge[sid]

    def mastery_std(self, sid: str) -> float:
        return 0.0  # the oracle is never uncertain, so it never needs to abstain

    def attention_mean(self) -> float:
        return self.learner.attention

    def frustration_mean(self) -> float:
        return self.learner.frustration

    def effective_theta(self, sid: str) -> float:
        k = self.learner.knowledge[sid]
        return self.learner.profile.ability + tracing.KNOW_SCALE * (k - 0.5)

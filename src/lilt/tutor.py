"""tutor.py - the policy that acts on the cause of a wrong answer.

The tutor reads the tracer's belief over the three latent states and decides what to
do next. It is the part that refuses to do what a correctness-only tutor does. When
a wrong answer is best explained by a lapse or by frustration rather than by a real
gap, it does not lower the student toward easier, more boring content; it addresses
the actual cause and holds the difficulty where it belongs.

Decisions, in priority order:
- break: attention has bottomed out, offer a rest (and the tracer models the
  recovery).
- ease: frustration is high, drop to a gentler item and give supportive,
  task-level feedback so the student rebuilds a run of success (Bandura's mastery
  experiences).
- switch: attention is low but not gone, re-engage with a different skill for
  novelty rather than grinding the same one.
- abstain: the last answer was wrong but the belief about this skill is still
  uncertain, so do not treat it as evidence of a gap; hold and try another item at
  the same level (the honest-when-unsure move).
- advance: the skill is mastered and the student is in a good state, move on, with
  occasional spaced review of an earlier skill.
- hold: otherwise, aim the next item at roughly a 75% success rate on the current
  skill (the optimal-challenge band).

Difficulty is aimed using the tracer's effective_theta for the skill, so the target
is set by what the student can actually do, not by the last single answer.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import log

import numpy as np

from lilt import items
from lilt.tracing import DISCRIM, Tracer

# action names (plain strings, so the engine ports cleanly to the browser)
ADVANCE = "advance"
HOLD = "hold"
EASE = "ease"
SWITCH = "switch"
BREAK = "break"
ABSTAIN = "abstain"

# thresholds for the decision tree
MASTERED = 0.80
UNLOCK = 0.60
BREAK_ATTENTION = 0.30
FRUST_HIGH = 0.55
ATTENTION_LOW = 0.50
AMBIGUOUS_STD = 0.18
GOOD_ATTENTION = 0.55
LOW_FRUST = 0.40
MIN_STEPS_BETWEEN_BREAKS = 8
REVIEW_PROB = 0.2  # chance of a spaced-review item instead of new material


@dataclass
class Decision:
    action: str
    item: items.Item | None
    feedback: str
    active_skill: str


def _level_for_target(theta: float, skill_id: str, target_p: float) -> float:
    """The within-skill level whose item difficulty puts predicted success near
    target_p, given the student's effective ability theta on the skill."""
    b = theta - log(target_p / (1.0 - target_p)) / DISCRIM
    base = items.SKILLS[skill_id].difficulty
    level = 0.5 + (b - base) / items.LEVEL_SPREAD
    return float(min(1.0, max(0.0, level)))


class Tutor:
    def __init__(self, grade: int | None = None, seed: int | None = None,
                 n_particles: int = 500, target_p: float = 0.75):
        self.tracer = Tracer(n_particles=n_particles, seed=seed)
        self.rng = np.random.default_rng(seed)
        self.target_p = target_p
        self.active: str | None = None
        self.steps_since_break = MIN_STEPS_BETWEEN_BREAKS
        self.last_correct: bool | None = None
        self.scope = self._build_scope(grade)

    def _build_scope(self, grade: int | None) -> list[str]:
        if grade is None:
            chosen = set(items.SKILLS)
        else:
            chosen = set(items.skills_in_grade(grade))
            for sid in list(chosen):
                chosen |= items.all_prerequisites(sid)  # include foundations
        # keep curriculum order
        return [sid for sid in items.topological_order() if sid in chosen]

    # -- skill selection -----------------------------------------------------

    def _mastery(self, sid: str) -> float:
        return self.tracer.mastery_mean(sid)

    def _unlocked(self, sid: str) -> bool:
        return all(self._mastery(p) >= UNLOCK for p in items.SKILLS[sid].prereqs)

    def _frontier(self) -> list[str]:
        """Unlocked skills in the scope that are not yet mastered, easiest first."""
        return [sid for sid in self.scope
                if self._unlocked(sid) and self._mastery(sid) < MASTERED]

    def _mastered(self) -> list[str]:
        return [sid for sid in self.scope if self._mastery(sid) >= MASTERED]

    def _pick_active(self) -> str:
        frontier = self._frontier()
        if frontier:
            return frontier[0]
        # everything in reach is mastered: review the hardest mastered skill
        mastered = self._mastered()
        return mastered[-1] if mastered else self.scope[0]

    # -- the loop ------------------------------------------------------------

    def start(self) -> items.Item:
        """The first item: an unlocked skill at a slightly easy level, to open with a
        win (early mastery experiences build self-efficacy)."""
        self.active = self._pick_active()
        return self._make_item(self.active, target_p=0.80)

    def observe(self, obs) -> Decision:
        """Feed the observation to the tracer, decide what to do, and return the next
        item (or a break)."""
        self.tracer.observe(obs)
        self.last_correct = obs.correct
        self.steps_since_break += 1

        attention = self.tracer.attention_mean()
        frustration = self.tracer.frustration_mean()
        std = self.tracer.mastery_std(self.active)
        mastery = self._mastery(self.active)

        # break: attention has bottomed out
        if attention < BREAK_ATTENTION and self.steps_since_break >= MIN_STEPS_BETWEEN_BREAKS:
            self.tracer.on_break()
            self.steps_since_break = 0
            item = self._make_item(self.active, target_p=0.80)
            return Decision(BREAK, item, "Let's take a quick breather, then keep going.",
                            self.active)

        # ease: frustration is high
        if frustration > FRUST_HIGH:
            item = self._make_item(self.active, target_p=0.85)
            return Decision(EASE, item,
                            "That one was tricky. Here is a friendlier one, you've got this.",
                            self.active)

        # switch: attention is low but not gone, re-engage with novelty
        if attention < ATTENTION_LOW:
            new_skill = self._novelty_skill()
            self.active = new_skill
            item = self._make_item(new_skill, target_p=0.80)
            return Decision(SWITCH, item, "Let's try something a bit different.", new_skill)

        # abstain: wrong, but the belief about this skill is still uncertain, so do
        # not read it as a gap; hold the level and try again
        if (not obs.correct) and std > AMBIGUOUS_STD:
            item = self._make_item(self.active, target_p=self.target_p)
            return Decision(ABSTAIN, item, "Let's try one more like that.", self.active)

        # advance: mastered and in a good state
        if (mastery >= MASTERED and frustration < LOW_FRUST
                and attention > GOOD_ATTENTION):
            return self._advance()

        # hold: aim for the optimal-challenge band on the current skill
        item = self._make_item(self.active, target_p=self.target_p)
        fb = "Nice, correct." if obs.correct else "Not quite, let's keep at it."
        return Decision(HOLD, item, fb, self.active)

    def take_break(self) -> None:
        """Call after a BREAK decision if the runner did not already; idempotent with
        the tracer's recovery handled in observe()."""
        self.steps_since_break = 0

    # -- helpers -------------------------------------------------------------

    def _advance(self) -> Decision:
        # occasional spaced review of an earlier mastered skill
        mastered = self._mastered()
        if mastered and self.rng.random() < REVIEW_PROB:
            review = mastered[int(self.rng.integers(len(mastered)))]
            return Decision(ADVANCE, self._make_item(review, target_p=self.target_p),
                            "Quick review to keep it fresh.", review)
        self.active = self._pick_active()
        return Decision(ADVANCE, self._make_item(self.active, target_p=0.80),
                        "You've got that one. Let's move on.", self.active)

    def _novelty_skill(self) -> str:
        frontier = [sid for sid in self._frontier() if sid != self.active]
        if frontier:
            return frontier[int(self.rng.integers(len(frontier)))]
        mastered = self._mastered()
        if mastered:
            return mastered[int(self.rng.integers(len(mastered)))]
        return self.active

    def _make_item(self, skill_id: str, target_p: float) -> items.Item:
        theta = self.tracer.effective_theta(skill_id)
        level = _level_for_target(theta, skill_id, target_p)
        return items.generate_item(skill_id, level, self.rng)

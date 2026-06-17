"""Lilt: a middle-school math tutor that adapts to why a student is struggling.

The package is built in stages (see docs/DESIGN.md):
  items     the middle-school math skill graph and procedural item generators
  learners  simulated students with three latent states (knowledge, attention,
            frustration) that emit three observables per step
  tracing   (next) a belief filter over the three states
  tutor     (next) the policy that acts on the cause of a wrong answer
"""

from lilt import items, learners

__all__ = ["items", "learners"]
__version__ = "0.1.0"

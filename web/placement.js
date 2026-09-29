// placement.js - a short check at the start, so a new student starts at the right place.
//
// Without it the tutor assumes a new student knows nothing, and walks them up from the
// easiest grade 6 skill no matter which grade they picked. Here the student answers one
// question for each of the hardest skills in their grade and topic (the ones nothing
// else in the grade builds on). A pass means they can do that skill and everything
// under it. A miss drops only one level: the skill's direct prerequisites become the
// place to start. Skills below the chosen grade are assumed known unless a miss points
// at them.
//
// The result is a starting profile for the Tracer, the same shape it saves between
// sessions, so the engine itself is unchanged.

import { SKILLS, skillsInGrade, allPrerequisites, generateItem, mulberry32 } from "./engine.js";

export const KNOWN = 0.85;   // above the tutor's mastered line (0.80)
export const PLACED = 0.70;  // passed the check: a couple of right answers to confirm it
export const GAP = 0.45;     // under the unlock line (0.60), so it is practiced first
export const NEW = 0.12;     // the tracer's default for a skill with no evidence
export const MAX_QUESTIONS = 6;

export function chosenSkills(grade, topic) {
  return skillsInGrade(grade).filter(s => topic === "All" || SKILLS[s].topic === topic);
}

// the skills the check asks about: the chosen ones no other chosen skill builds on
export function placementSkills(grade, topic) {
  const chosen = chosenSkills(grade, topic);
  const tops = chosen.filter(s => !chosen.some(o => o !== s && allPrerequisites(o).has(s)));
  return tops.slice(0, MAX_QUESTIONS);
}

export function placementItems(skills, seed) {
  const rng = mulberry32(seed >>> 0);
  return skills.map(s => generateItem(s, 0.5, rng));
}

// results: [{ skillId, passed }] -> { mastery } for the Tracer
export function priorFromPlacement(scope, grade, topic, results) {
  const inScope = new Set(scope), mastery = {};
  for (const s of scope) mastery[s] = KNOWN;
  for (const r of results) mastery[r.skillId] = r.passed ? PLACED : NEW;
  // misses first, then passes, so a skill that a passed question relied on stays known
  for (const r of results) if (!r.passed)
    for (const p of SKILLS[r.skillId].prereqs) if (inScope.has(p)) mastery[p] = GAP;
  for (const r of results) if (r.passed)
    for (const p of allPrerequisites(r.skillId)) if (inScope.has(p)) mastery[p] = KNOWN;
  return { mastery };
}

// Testing out mid-session. The tracer models knowledge as something gained through
// practice, with a narrow prior, so it cannot conclude "they already knew this" and a
// student who gets every hard problem right still needs a dozen or so to finish a skill.
// A run of clean answers at the top of a skill's range is the same kind of evidence as
// passing the placement check, so it gets the same credit: every particle's mastery for
// that skill is lifted to at least KNOWN.
export function credit(tracer, skillId, floor = KNOWN) {
  const i = tracer.idx[skillId];
  for (const row of tracer.mastery) if (row[i] < floor) row[i] = floor;
}

// The tutor practices the first unfinished skill in scope order. Put the gaps the check
// found ahead of the skills it passed, so practice starts on what was missed, not on
// confirming what the student already showed. Prerequisites are still respected,
// because the tutor only practices a skill once its prerequisites are unlocked.
export function practiceOrder(scope, prior) {
  const gap = s => (prior.mastery[s] ?? NEW) < PLACED;
  return [...scope.filter(gap), ...scope.filter(s => !gap(s))];
}

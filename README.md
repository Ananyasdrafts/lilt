# Lilt

A middle-school math tutor that adapts to *why* a student is struggling, not just whether they got the last answer right.

Most adaptive tutors track one thing: does the student know this skill. When an answer is wrong, they lower the estimated ability and serve easier, slower content. For a student who is capable but distractible, that is the wrong move. A wrong answer usually means the student drifted off or got frustrated, not that they cannot do it, and easier content just bores them further. The tutor's well-meant adaptation makes the real problem worse.

Lilt models three things at once instead of one: how well the student knows the skill, how engaged they are right now, and how frustrated they are. It tells those apart from the timing and pattern of answers, intervenes on the actual cause (ease and encourage when frustrated, re-engage or switch when drifting, advance when genuinely mastered), and holds back from marking a student as "behind" when the cause of a wrong answer is genuinely unclear.

The motivation is personal: my younger sister, who is sharp but loses focus fast, and whose grades have never reflected what she can actually do.

## Status

Early build. The engine and its honest evaluation come first (simulation-first, the same approach I used for MedMaps and Cairn), then a real browser app she can use for middle-school math. See [docs/DESIGN.md](docs/DESIGN.md) for the full design and the staged build plan.

## What it deliberately does not do

These are evidence-based decisions, not missing features (citations in the design doc):

- No "learning styles." Matching instruction to a visual/auditory/kinesthetic preference does not improve learning, and the labels lower expectations for the kids they get pinned on.
- No points/badges/leaderboard economy. Heavy external rewards undermine intrinsic motivation, most of all for children and on tasks they could find interesting. Lilt makes progress visible and gives feedback on the work itself.
- No brain-training claims. Lilt adapts the math content to the student; it is not a working-memory game, which the evidence shows does not transfer to real academics.

## Run it

```bash
pip install -e ".[dev]"
pytest
```

## License

MIT

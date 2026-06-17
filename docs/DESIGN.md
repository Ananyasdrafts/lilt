# Lilt: design and build plan

## 1. The problem, and why the usual fix backfires

A standard adaptive tutor models one latent variable: does the student know this
skill (this is knowledge tracing, Corbett and Anderson 1995). On a wrong answer
it lowers the estimated ability and serves easier, slower content.

For a capable but distractible student that is exactly wrong. Their true ability is
high, but their observed performance is low because they drift off and frustrate
fast. A correctness-only tutor reads the low performance as low ability, serves
easier and more repetitive content, and easy content is what makes a sharp student
check out harder. The tutor's adaptation drives a doom loop. The learning-sciences
literature both names this and says why:

- Affect and knowledge are separable latent states that move on different tracks
  (D'Mello and Graesser 2012; San Pedro and Baker 2013; the affect-aware
  knowledge-tracing models DASKT 2025 and DEKT 2024).
- Boredom is the most damaging state and the one that predicts disengagement and
  dropout, more than frustration (Baker et al. 2010). Boredom feeds delay
  aversion which feeds inattention (Hsu et al. 2025).
- For an ADHD-style profile the bottleneck is motivational, not capacity. Skalski
  et al. 2020 show motivation closes the attention gap far more for these students
  than for typical peers, so much of the apparent deficit is state, not ceiling
  (the delay-aversion pathway, Sonuga-Barke; Marx et al. 2021; Van Dessel 2018).

So Lilt models three latent states, not one, and acts on the cause of a wrong
answer rather than on the wrong answer alone.

## 2. The model

Three latent states, tracked per student over a session:

- **knowledge** per skill, growing with successful practice (an individual
  exponential learning curve; Heathcote et al. 2000 show the "power law" is an
  averaging artefact and individuals are exponential).
- **attention**, decaying with time on task and recovering on a break or novelty
  (the state-regulation account; Sergeant; Metin et al. 2016).
- **frustration**, accumulating on repeated failure and too-hard jumps, easing on
  success or a break (D'Mello and Graesser 2012 affect dynamics).

**The hard part, and the core of the project.** From correctness alone these three
are confounded; a wrong answer could be any of them (the knowledge-tracing
identifiability problem, Doroudi and Brunskill 2017, made three times worse). They
become separable only when the learner emits more than one signal per step, so
`learners.py` emits three:

- **response time** (the speed-accuracy split, van der Linden 2007): low knowledge
  is slow and effortful, low attention is fast and careless, frustration is variable.
- **recovery after a break**: attention snaps back, knowledge does not. A break that
  restores performance proves the deficit was attentional.
- **error clustering**: knowledge gaps cluster on a specific skill, attention slips
  scatter across skills, frustration shows up as regression on already-mastered
  material.

`tracing.py` (next stage) is a small Bayesian filter that keeps a belief over
(knowledge, attention, frustration) from this three-signal stream. When the signals
cannot disambiguate, the belief over knowledge stays wide, and the tutor is built
not to act on a confident-but-wrong knowledge estimate. That abstention is the
"honest when unsure" thesis, and it falls straight out of the identifiability
problem rather than being bolted on.

## 3. The tutor

The right frame is a POMDP (Rafferty et al. 2016): the student's true state is
hidden, the tutor acts on a belief. For v1 the policy is an interpretable
belief-update plus rules rather than deep RL, for honesty and inspectability (the
same call I made for Cairn). Actions: advance, hold, ease, switch format,
encourage, offer a break, and abstain.

The "feels smart" engine (a capable student needs to feel competent to stay in it):

- Hold the student near a 75% success rate, the optimal-challenge band where flow
  and the zone of proximal development overlap (Csikszentmihalyi; Vygotsky; the
  inverted-U of Ma et al. 2017). For a capable but distractible student this means
  keeping it *harder* than a naive tutor would, because easy is what loses them.
- Engineer well-timed success: mastery experiences are the strongest source of
  self-efficacy (Bandura).
- Feedback at the task level, never the person level: "that step is right because
  X, here is the next one" beats "you're so smart" (Kluger and DeNisi 1996; Hattie
  and Timperley 2007, where feed-forward is the most under-used, highest-value move).

Once a skill is past a mastery threshold, "advance" becomes smarter scheduling, not
just harder items: spacing (Cepeda et al. 2006), retrieval practice (Roediger and
Karpicke 2006; Adesope et al. 2017), and interleaving (Brunmair and Richter 2019).
These are gated on mastery, because they overload novices and productive failure
reverses for younger learners (Chen, Kalyuga and Sweller 2021; Sinha and Kapur 2021).
A middle schooler sits right at that boundary.

## 4. The math content

Middle-school math organised the way the curriculum is, by grade (6, 7, 8) and by
topic (Number System, Ratios and Proportions, Expressions and Equations), as a
prerequisite graph (`items.py`) where prerequisites never point forward a grade. It
spans fraction and integer arithmetic, GCF and LCM, ratios, unit rates, percentages
and percent applications, exponents and the laws of exponents, order of operations,
combining like terms, and one-step through multi-step equations. Geometry,
Statistics and Probability, and Functions are planned for later phases. Each skill
has a base difficulty and a procedural item generator, so the same code produces an
item's difficulty for the simulator and the actual question and answer for the app.
One source of truth for the math.

## 5. What Lilt deliberately does not do (the rigor signature)

Three things the evidence rules out, stated plainly:

- **No learning styles.** The meshing hypothesis is debunked (Pashler et al. 2008;
  Aslaksen and Loras 2018; Clinton-Lisell and Litzinger 2024 find the required
  crossover interaction in only 26% of measures). 89% of educators still believe it
  and the labels lower expectations for "hands-on" kids (Sun et al. 2023). We use
  multimodal presentation and skill-targeted instruction instead.
- **No heavy gamification.** The overjustification effect (Deci 1971; Lepper et al.
  1973) is strongest for children and for already-interesting tasks, and leaderboards
  are highest-risk for lower-performing students. Lilt makes progress visible and
  gives competence feedback, no points economy.
- **No brain-training claims.** Working-memory and cognitive training show reliable
  near transfer but no far transfer to real academics under blinded assessment
  (Melby-Lervag et al. 2016; Simons et al. 2016; Westwood et al. 2023; AAP 2019).
  Lilt adapts content; it is not a brain trainer.

## 6. Build plan and stages

The engine is identical whether its inputs come from a simulator or a real student
in a browser: both produce (correct, response-time, help-requested) per step. That
is the bridge from a rigorous, honestly-evaluated engine to a tool a real student
can actually use.

**Phase 0 (done): scaffold.** Repo, package, CI, MIT, this design doc.

**Phase 1 (in progress): the engine.**
- `items.py`: middle-school math skill graph plus procedural item generators.
- `learners.py`: simulated students with the three latent states, emitting the
  three observables.
- `tracing.py`: the Bayesian belief filter over (knowledge, attention, frustration).
- `tutor.py`: the POMDP-style policy plus abstention plus the feels-smart engine.

**Phase 2: honest evaluation.** `eval/run_eval.py`: multi-seed, matched-seed control
(each adaptive run paired with a control on the same simulated learner), held-out
learners, slice by distractibility (the equity headline: the biggest gains land on
the most distractible students), baselines (correctness-only, an oracle that sees
the true state, random), a Robust Evaluation Matrix across several simulators to
avoid simulation-gap overfitting (Doroudi et al. 2017), a reward-hacking guard
(measure post-test knowledge gain, never in-session accuracy), and planned honest
nulls. This is the grad-application research proof.

**Phase 3: real math content.** Expand the item generators into a full middle-school
bank (grades 6 to 8) with hints and worked steps, and port `items` + `tracing` +
`tutor` to JavaScript (`engine.js`) so the same engine runs in the browser.

**Phase 4: the app a student uses.** `web/`: the student opens it, does math, and the
engine runs live on their real (correct, response-time, help) stream. Interventions
happen in real time. The interface follows the ADHD design evidence: short bounded
segments that close with feedback, immediate task-level feedback, one thing on screen
at a time, an ambient progress indicator rather than a ticking clock, and an optional
break. The profile persists across sessions in the browser, so it learns the
student's pace over days, not just within one sitting.

**Phase 5: personalization and the public demo.** A short calibration that reads the
student's pace and sensitivity, plus a public research demo (simulated learner, naive
correctness-only tutor versus Lilt on the same learner) and deployment to GitHub
Pages so it can be used from any browser.

**Phase 6: real-use polish.** Tune session length and topic coverage to real use, an
optional parent view, and an honest "what it cannot do yet" note. The end goal is a
calm, well-paced math tutor a student reaches for on their own.

## 7. References

Adesope, Trevisan, Sundararajan 2017; Baker, D'Mello, Rodrigo, Graesser 2010;
Bandura 1997; Brunmair and Richter 2019; Cepeda, Pashler, Vul, Wixted, Rohrer 2006;
Chen, Kalyuga, Sweller 2021; Clinton-Lisell and Litzinger 2024; Corbett and Anderson
1995; Deci 1971; D'Mello and Graesser 2012; Doroudi, Aleven, Brunskill 2017;
Ghosh, Heffernan, Lan 2020 (AKT); Hattie and Timperley 2007; Heathcote, Brown,
Mewhort 2000; Hsu et al. 2025; Kluger and DeNisi 1996; Lepper, Greene, Nisbett 1973;
Ma, Pei, Meng 2017; Marx, Hacker, Yu, Cortese, Sonuga-Barke 2021; Melby-Lervag,
Redick, Hulme 2016; Metin et al. 2016; Pashler, McDaniel, Rohrer, Bjork 2008;
Piech et al. 2015 (DKT); Rafferty, Brunskill, Griffiths, Shafto 2016; Roediger and
Karpicke 2006; San Pedro, Baker et al. 2013; Simons et al. 2016; Sinha and Kapur
2021; Skalski, Pochwatko, Balas 2020; Sun, Norton, Nancekivell 2023; van der Linden
2007; Van Dessel et al. 2018; Westwood et al. 2023; Yegencik, Bell, Deniz 2025.

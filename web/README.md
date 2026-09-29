# Lilt in the browser

`engine.js` is the Lilt engine ported to JavaScript: the same middle-school math
skill graph and item generators, the same particle filter over knowledge, attention,
and frustration, and the same policy as the Python package. It is a straight port, so
the Python side stays the source of truth and the place the honest evaluation runs.

The whole point of the port is that the engine does not care where its inputs come
from. The simulator and a real student both produce the same three signals per step,
`{ correct, responseTime, helpRequested }`, so this is the exact code the app will run
live on a real student's answers.

## What is here

- `engine.js` - items, the belief filter (`Tracer`), and the policy (`Tutor`), plus
  `generateItem`, `checkAnswer`, `buildScope`, and grade/topic lookup.
- `engine.smoke.mjs` - re-derives the answer for every generated item to catch any
  porting bug, and runs a full tutor loop. Run with `node web/engine.smoke.mjs`.

## Using it

```js
import { Tutor, checkAnswer } from "./engine.js";

const tutor = new Tutor({ grade: 6, seed: 1 });
let item = tutor.start();              // { skillId, prompt, answer, difficulty, level }
// show item.prompt, time the student, collect their answer and whether they asked for help
const obs = {
  correct: checkAnswer(item, studentResponse),
  responseTime: secondsTaken,
  helpRequested: askedForHelp,
  skillId: item.skillId,
  itemDifficulty: item.difficulty,
};
const decision = tutor.observe(obs);   // { action, item, feedback, activeSkill }
item = decision.item;                  // next problem (or a break)
```

## The app

`index.html`, `style.css`, and `app.js` are a calm, one-problem-at-a-time math session
built on this engine. The engine decides what to practice; two more files make it teach.

- `teach.js` - the teaching layer. For each of the 19 kinds of problem it parses the
  item back from its prompt and writes a worked solution as short steps. The hint button
  reveals them one at a time, and the answer only appears in the last step. It also
  grades more carefully than a right/wrong match: `2/6` for `1/3` is "right value, not
  simplified yet" (not counted as a miss), `12 + 5x` is accepted for `5x + 12`, and it
  recognises the common wrong answers for each kind of problem (adding the bottoms of
  fractions, going left to right instead of multiplying first, flipping the wrong
  fraction, the discount instead of the sale price, and so on) and says what went wrong.
- `placement.js` - a short check for a new student: one question for each of the
  hardest skills in their grade and topic. A pass counts that skill and everything
  under it as known. A miss drops one level, to that skill's direct prerequisites. The
  result is a starting profile in the same format the tracer saves between sessions.

What a student sees: the placement check and where it will start them, then problems
with a hint button, a note on the likely mistake after a wrong answer and one more try,
the full worked solution after a second miss, and one line after each problem on what
the tutor decided (moving on, stepping up, easing off, reviewing, suggesting a break).
The progress bar tracks the tracer's belief about the current skill. The profile
persists in the browser, so a returning student skips the check.

The app sends the engine one observation per problem: whether the first answer was
right, how long the student took before answering or asking for help, and whether they
used any hints.

Three small rules live in the app rather than the engine. They are not part of the
Python evaluation, so the study results in the main README don't cover them:

- **Step up on a streak.** The engine aims for about 75% success and raises a skill's
  level slowly, so a student who keeps getting it right used to sit on easy problems.
  After two clean answers in a row on a skill, the next problem is a level harder.
- **Testing out.** The tracer treats knowledge as something gained through practice,
  with a narrow prior, so it can't conclude that a student already knew a skill. Three
  clean answers in a row near the top of a skill's range lifts that skill to known, the
  same credit a placement pass gives.
- **Breaks the engine hears about.** The engine only moves to new material when it
  believes attention is high, and only restores attention after a break. A break taken
  at a checkpoint now tells the engine, and if the tutor holds a skill the student
  already has, the app suggests a short break before the next one.

Run it locally (ES modules must be served, not opened as a file):

```bash
cd web
python3 -m http.server 8000
# open http://localhost:8000  (add ?debug to inspect the session as window.lilt)
```

Tests: `node web/engine.smoke.mjs` checks the engine port, and `node web/teach.smoke.mjs`
checks that the worked steps reach the engine's answer for 5,700 generated problems,
that known wrong answers get the right diagnosis, and where placement starts a student.

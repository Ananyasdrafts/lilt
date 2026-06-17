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

`index.html`, `style.css`, and `app.js` are a calm, low-distraction middle-school
math session built on this engine: one problem at a time, immediate task-level
feedback, an ambient sense of progress (no points or leaderboards), a gentle break
when the tutor judges attention has dropped, and an "I'm stuck" button. The student's
profile persists in the browser, so it remembers their pace across days.

Run it locally (ES modules must be served, not opened as a file):

```bash
cd web
python -m http.server 8000
# open http://localhost:8000
```

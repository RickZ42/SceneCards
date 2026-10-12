# Memory animations

Animations live in each private card's `memoryScene` field and are included in
ordinary backups and encrypted account sync. The optional generation bridge runs
only on the Mac's loopback interface; it does not expose a new LAN endpoint.
The Mac stores its latest daily animation queue and pending scenes in
`data/memory-scenes-state.json` with mode 0600. This local file is readable data,
like the Bob inbox; keep it private and never publish it.

Reveal the answer in Today's Review, then select **Watch memory animation** and
**Play**. Playback is finite (4.5 seconds), with Pause, Restart and Replay.
Reduced-motion users see the final frame. Animations also open from the library.
Playback does not rate a card or consume a daily review slot.

## Daily generation

1. Open the actual signed-in Mac page, `http://127.0.0.1:5173/`, in the background.
   The page sends its actual `dailyPlan.queue` (at most 30) to the local bridge.
2. Run `node scripts/memory-scenes.mjs status` in the original checkout. Verify
   the queue's date, freshness (less than five minutes), count, first word and
   account match the page. Use the `missing` array, not an old backup or inbox.
3. Compose a distinct scene for each missing card using its current meaning,
   original context and example. Use natural English throughout. Figurative
   scenes are memory cues, not scientific explanations or claimed etymologies.
4. Write a private JSON payload in a permitted workspace or temporary folder:
   `{ "scope": queue.scope, "date": queue.date, "entries": [...] }`.
   Each entry has `cardId`, the exact queue `signature`, and `scene` (below).
5. Run `node scripts/memory-scenes.mjs import /absolute/path/scenes.json`.
   Imports validate the current queue, merge atomically, and skip existing scenes.
   They cannot alter review data. The open app applies matching scenes in about
   five seconds; a changed meaning or deleted card will not receive a stale scene.
6. Verify saved animations in the real library, then run `status` again to confirm
   `hasAnimation`. Reload and verify persistence without rating any cards.

The bridge cannot generate scenes by itself. The scheduled Codex task composes
the scene data and imports it. An empty `missing` array requires no work. The Mac,
SceneCards service and Codex must be running; browser access needs an unlocked Mac.
The hosted mobile app includes the original 30 reusable scenes and a Memory
Animations page. Matching senses show a player in the existing review card;
viewing never creates or reschedules a card. These shared scenes contain only
general teaching examples, not private card content or review history, and are
cached with the app for offline playback. Newly generated custom scenes travel
in the encrypted collection when devices use the same private account. Unsigned
local collections remain independent; do not restore a backup just for animations.

## Declarative scene format

Generated scenes use this JSON schema (no HTML, JavaScript, images or remote URLs):

```json
{
  "kind": "timeline",
  "definition": "A short explanation of the card's actual sense.",
  "example": "A complete, natural English example using the target word.",
  "steps": ["The starting situation.", "An action shows the meaning.", "The result makes the meaning clear."],
  "elements": [
    {"type":"circle","tone":"main","frames":[
      {"at":0,"x":100,"y":120,"r":15},
      {"at":0.5,"x":350,"y":120,"r":15},
      {"at":1,"x":600,"y":120,"r":15}
    ]},
    {"type":"text","text":"Starting point","tone":"neutral","frames":[
      {"at":0,"x":100,"y":80,"width":160,"opacity":1},
      {"at":1,"x":100,"y":80,"width":160,"opacity":1}
    ]}
  ]
}
```

Use the logical canvas 736 × 286; place the scene between x=24–712 and y=24–225,
leaving the lower area for the changing step caption. It adapts to card width.
Allowed element types: `circle`, `rect`, `line`, `text`; tones: `main` (teal),
`other` (coral), `neutral`, `line`, `flow`. Every element requires 2–8 ascending
keyframes, beginning at `at:0` and ending at `at:1`, with identical numeric keys
in each frame. Required keys: circle x/y/r; rect x/y/width/height; line x/y/x2/y2;
text x/y. Optional keys: opacity (0–1), rotation, and text width. Coordinates are
bounded at ±1000; sizes cannot be negative. Up to 40 elements. Text ≤100 chars,
definition ≤800, example ≤1200, exactly three steps each ≤160.

Use multiple moving objects, changing positions/sizes/opacities and a meaningful
before/action/after, rather than three text boxes or the same template for all words.
Avoid crossing labels and verify the animation at narrow width.

The original 30 scenes use the reviewed `builtin` renderer; new words should use
`timeline`. Never edit built-in renderer code as part of routine daily generation.
Do not reset progress, overwrite manual content, restore backups, change accounts,
commit, push, or publish. Existing valid animations are preserved.

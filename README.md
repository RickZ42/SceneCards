# SceneCards

A local-first, scene-based English flashcard app. Cards preserve the original
line, the meaning in that scene, a personal example, and a memory cue instead
of reducing an expression to a translation pair.

## Run locally

```bash
npm install
npm start
```

`npm start` builds the current cards and serves the stable local app at
`http://127.0.0.1:5173/`.

The app stores cards and review history in the current browser's local storage.
Use the download button in the header to create a portable JSON backup, and the
upload button to restore one.

## Review schedule

Each answer updates the next due time:

- `Again`: 10 minutes and a lapse.
- `Hard`: a short interval with a lower ease factor.
- `Good`: 1 day, then 3 days, then adaptive intervals.
- `Easy`: starts at 4 days and grows faster.

The bundled `boomerang` card is created only when no existing local data is
found.

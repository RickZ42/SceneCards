# SceneCards

A local-first, scene-based English flashcard app. Cards preserve the original
line, the meaning in that scene, a personal example, and a memory cue instead
of reducing an expression to a translation pair.

## Run locally

```bash
npm install
npm start
```

`npm start` builds the app and serves the stable local app at
`http://127.0.0.1:5173/`.

The app stores cards and review history in the current browser's local storage.
Use the download button in the header to create a portable JSON backup, and the
upload button to restore one.

## Bob integration

Build the installable Bob plugin:

```bash
npm run plugin:pack
```

Then open `output/SceneCards-0.1.0.bobplugin` to install it in Bob. Keep
SceneCards running while using the `SceneCards 收词` translation service.

By default, English words and short phrases are added automatically. A query
without a meaning goes to the `Bob 收件箱` for later editing. Use the following
format to create a review-ready card immediately:

```text
exploit || 利用某种机制或弱点使自己获益 || Orchids exploit the normal mate-search system.
```

The bridge listens only on `127.0.0.1`. Incoming Bob items are briefly written
under `~/Library/Application Support/SceneCards`, then moved into the browser's
local SceneCards store.

### Start automatically on this Mac

```bash
npm run service:install
```

This installs a per-user macOS background service. Remove it with
`npm run service:uninstall`.

## Review schedule

Each answer updates the next due time:

- `Again`: 10 minutes and a lapse.
- `Hard`: a short interval with a lower ease factor.
- `Good`: 1 day, then 3 days, then adaptive intervals.
- `Easy`: starts at 4 days and grows faster.

The bundled `boomerang` card is created only when no existing local data is
found.

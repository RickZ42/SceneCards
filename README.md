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

SceneCards watches Bob's native favorites locally. Translate normally, then use
Bob's favorite button or press `Command-S` only when a result should become a
flashcard. Existing favorites are ignored during first-time setup; only newly
favorited results are imported. The translated meaning is included when Bob has
a successful translation result.

The favorite watcher does not require the `SceneCards 收词` translation service
to stay enabled; that service can be disabled if its status panel is not useful.

The optional Bob plugin supports an additional manual marker workflow. Build it
with:

```bash
npm run plugin:pack
```

Then open `output/SceneCards-0.2.0.bobplugin` to install it in Bob. Ordinary
translations never add cards. In the plugin settings, choose manual marker mode
to add only marked input:

```text
exploit || 利用某种机制或弱点使自己获益 || Orchids exploit the normal mate-search system. +sc
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

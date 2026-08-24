# SceneCards

A local-first, scene-based English flashcard app. Cards preserve the original
line, the meaning in that scene, a representative example with its natural
Chinese meaning, and a memory cue instead of reducing an expression to a
translation pair.

During review, the representative example hides the target expression. Recall
the missing expression from the concrete situation and sentence meaning before
revealing the answer. This makes the example an active retrieval prompt rather
than extra text shown after the answer. Revealing the answer automatically reads
the target expression aloud. The complete representative sentence remains
available from its speaker button.

## Run locally

```bash
npm install
npm start
```

`npm start` builds the app and serves the stable local app at
`http://127.0.0.1:5173/`.

## Install on iPhone

SceneCards is an installable offline web app. Serve the production build from an
HTTPS address, open it once in Safari, then choose Share and Add to Home Screen.
After the first successful load, review, editing, scheduling, backup, and restore
work without the Mac or an internet connection. The iPhone uses its own English
voice; the Bob inbox remains an optional Mac-only integration.

To move an existing collection, download a SceneCards JSON backup on the Mac,
send it to the iPhone, and use the upload button in the installed app. The two
devices then keep independent local copies unless backups are moved manually.

The app stores cards and review history in the current browser's local storage.
Use the download button in the header to create a portable JSON backup, and the
upload button to restore one.

The public card library is stored in `public/data/cards.json` and is deployed
with GitHub Pages. The app checks this library when it opens, regains focus, or
comes back online. Published card-content revisions are merged into each
browser, while review history, scheduling, dismissals, and user-edited card
content remain local to that browser. The public library must never contain
tokens, credentials, or private review data.

Speaker buttons play audio generated locally by the Mac's built-in British
English voice. Generated WAV files are cached under the SceneCards data folder;
card text is not sent to an external speech service.

## Bob integration

SceneCards watches Bob's native favorites locally. Translate normally, then use
Bob's favorite button or press `Command-S` only when a result should become a
flashcard. Existing favorites are ignored during first-time setup; only newly
favorited results are imported. The translated meaning is included when Bob has
a successful translation result. When Bob's dictionary result includes an
example, SceneCards scores the available examples for useful context and imports
the strongest English sentence together with its Chinese sentence meaning and
pronunciation. Incomplete results and weak examples stay in the Bob inbox until
they are edited instead of entering the review queue.

When Cambridge provides a CEFR vocabulary level, SceneCards stores it as the
card's difficulty (`A1` through `C2`). It prefers the level attached to the
relevant part of speech, and every card's level remains editable.

If the selected text is a complete sentence, SceneCards preserves the sentence
and its translation in the inbox but does not guess which word should become the
card. Choose `选择单词`, enter the target expression and its meaning in that
sentence, then save the card.

The favorite watcher does not require the `SceneCards 收词` translation service
to stay enabled; that service can be disabled if its status panel is not useful.

If Bob misdetects an English word's source language and saves no usable Chinese
result, SceneCards retries that favorited word against Cambridge's
English-Chinese dictionary, with an English-to-Chinese Google translation as a
last resort. These fallbacks send only the explicitly favorited word or short
phrase; ordinary Bob translations are never sent by SceneCards.

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

The installed background service also listens on the Mac's local network so a
phone on the same trusted Wi-Fi can open it. Remote devices must first use the
private access link printed by `npm run service:install`; the link stores an
access cookie and immediately removes its token from the address bar. Incoming
Bob items are written under `~/Library/Application Support/SceneCards` as a
durable capture log. Each browser reconciles that log into its local SceneCards
store, so one open browser cannot consume a word before another browser receives
it. Deleting a captured card records a local dismissal so it does not return
during reconciliation.

### Start automatically on this Mac

```bash
npm run service:install
```

This installs a per-user macOS background service. Remove it with
`npm run service:uninstall`.

## Review schedule

Each answer updates the next due time:

- `Again`: records a lapse and immediately moves the card to the end of the
  current review queue.
- `Good`: 1 day, then 3 days, then adaptive intervals.
- `Easy`: starts at 4 days and grows faster.

Published cards use expression-specific memory cues from
`src/curatedMemoryHooks.js`. Each distinct expression must have its own cue and
may use a different route, such as morphology, contrast, a concrete image, a
collocation, a directional diagram, or a personal scene. Run
`scripts/apply-curated-memory-hooks.mjs` against a card-library JSON file after
adding or revising curated cues; the script rejects missing cues and accidental
cue reuse across different expressions.

For a new card that has not been curated, the third review rating adds a local
fallback cue. The fallback varies between morphology, phrase-level retrieval,
reverse recall, and scene-based prompts instead of using one fixed paragraph.
Existing manual memory cues are never replaced, and no card content is sent to
an AI or external service for this feature.

The bundled `boomerang` card is created only when no existing local data is
found.

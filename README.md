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

## Daily Workload

Each local calendar day admits at most 30 different words or expressions, in
the existing due-queue order. Completed words still consume that day's allowance;
refreshing or finishing a card does not pull in a 31st word. Forgotten words stay
at the end of today's queue and repeated attempts consume only one slot.

Excess words carry forward into later days, with a visible forecast of up to 30
words per day. Forecasts update as cards are reviewed or added. This workload
layer does not rewrite the underlying spaced-review intervals or review history.
The allowance is derived from review history and last-reviewed timestamps, so
account sync also carries it between devices using the same local calendar day.

## Run locally

```bash
npm install
npm start
```

`npm start` builds the app and serves the stable local app at
`http://127.0.0.1:5173/`.

## Private Accounts

SceneCards uses one shared website with separate private collections. New
accounts start empty. Cards, meanings, examples, memory hooks, inbox dismissals,
review history, due dates and queue positions sync only within that account.

Open the account button to sign in with a private access code. The existing owner
can use `Connect existing mobile inbox account` on their Mac to migrate that
browser's collection without changing its cards or schedule. Its original local
data remains available as a migration backup. Connect the Mac with the correct
progress first; then use the same owner code on the phone.

The owner can generate a single-use invitation for a friend. Invitations expire
after seven days. Redeeming an invitation creates an empty account with a new
private access code that is returned only to the recipient. Keep that code for
other devices; there is no email/password recovery in this first version. A
lost invitation response requires a new invitation. Losing every copy of the
private code means the encrypted collection cannot be recovered.

Collections and their per-account offline caches use AES-256-GCM with a key
derived from the random access code using HKDF. Cloud storage sees encrypted
collection documents. Account credentials are hashed in a separate directory;
the backend always selects the authenticated account, not a client-supplied ID.
Durable Objects enforce atomic revision checks so concurrent devices retry
without overwriting each other's changes. Sign-out removes the saved code and
keeps only the account's encrypted cache. Downloaded ordinary JSON backups are
readable, so keep them private. Startup recovery can export an encrypted cache;
sign into the same account before importing it.

Each account uses its own private access code as its Shortcut inbox key, with
the same Worker service address. Capture records are encrypted server-side and
visible only within that account. The service operator can decrypt inbox
captures; this inbox encryption is distinct from the client-encrypted collection.
The original owner's Shortcut continues to work. Sharing the owner's personalised
Shortcut would share its inbox access: personalise a separate copy for each user.

Account sync runs after edits settle, on reconnect/focus, and every minute while
the app is open. Offline changes remain cached and merge on reconnection.
Deletes retain tombstones to prevent old devices from resurrecting cards.
Owner accounts can use the local Bob bridge; invited accounts cannot import it.

The site no longer automatically installs sample/personal cards or fetches the
old public card library. Production builds omit `dist/data/cards.json`. Previously
published files may remain in Git history and old downloaded copies; this does
not retroactively make those copies private.

## Install on iPhone

SceneCards is an installable offline web app. Serve the production build from an
HTTPS address, open it once in Safari, then choose Share and Add to Home Screen.
After the first successful load, review, editing, scheduling, backup, and restore
work without the Mac or an internet connection. The iPhone uses its own English
voice; the Bob inbox remains an optional Mac-only integration.

Sign into the same private account on the Mac and iPhone to sync the complete
collection and review progress. For a manual transfer, download a SceneCards
JSON backup on the Mac and use the upload button on the iPhone. Unsigned local
collections remain independent unless transferred manually or connected to an
account.

The app caches private collections encrypted in the current browser's local
storage; unsigned local collections retain their original JSON format. Use the
download button for a portable JSON backup and the upload button to restore one.
Keep downloaded backups private because they include readable card content.

Private accounts do not load a public card library. GitHub Pages publishes the
application, while private account documents remain on the authenticated Worker.

## Quick capture on iPhone

Use the lightning button in SceneCards for a word, phrase, or complete sentence.
A word is added directly to the inbox. A complete sentence is preserved without
guessing the target word, so it can be selected later in the inbox.

The optional iOS Share Sheet shortcut sends selected text to a private mobile
inbox. SceneCards checks that inbox when it opens, regains focus, reconnects,
and every minute while it remains open. Captures are deduplicated on each
device. See [the iPhone shortcut guide](docs/iphone-shortcut.md) for setup.

The mobile inbox uses the private account access code (or the original owner's
inbox key), never the GitHub token or legacy review-sync password. Captured text
is encrypted before storage in Cloudflare and expires after 180 days. Captures
are not published to the public GitHub repository.

## Encrypted review-progress sync

This section describes the older single-owner GitHub sync. Private accounts
use full collection sync instead and never write to this shared GitHub file.

Use the cloud button on each device to enter the same sync password and a
fine-grained GitHub token restricted to `RickZ42/SceneCards` with `Contents:
Read and write`. The token and password stay in that browser's local storage and
are not included in SceneCards backups.

Review events, due dates, intervals, ease, lapses, and the current queue position
are encrypted as `review-state-v2.enc.json` in the `review-sync` branch with
PBKDF2-SHA256 and AES-256-GCM.
Card expressions, meanings, examples, GitHub tokens, and sync passwords are
never written to that branch. The app merges review-event IDs and uses each
card's newest review state, so opening either device does not replace newer work
from the other device.

Sync runs after setup, after review changes settle, when the app regains focus or
connectivity, when it moves to the background, and every five minutes while it
remains open. The app continues to work offline and retries on the next trigger.

If one device has the known-correct schedule, open sync settings on that device
and choose `以这台设备的进度为准`. This writes a new encrypted reset generation.
Other devices discard their older scheduling state when they first see that
generation, adopt the authoritative queue and history, and then resume ordinary
two-way merging. Older SceneCards clients write to the former v1 file and cannot
undo a v2 authoritative reset.

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

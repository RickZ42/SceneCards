# SceneCards mobile inbox

This Worker receives short, explicit vocabulary captures from the iOS share
sheet and exposes them to SceneCards. Private accounts also store client-encrypted
collections and review progress. The Worker does not receive the GitHub token
used by the older single-owner progress sync.

Captured text is encrypted with AES-256-GCM before it is stored in Workers KV.
The same random inbox key authorizes both the iOS shortcut and SceneCards.
Captures expire after 180 days and are deduplicated by their stable capture ID
inside each SceneCards browser.

`POST /definition` returns one English dictionary sense and a public translation
URL. The shortcut requests that URL from the device without the inbox key, then
sends the dictionary and translation responses to `POST /lookup`. This returns
a bilingual `preview` and stable capture payload without any KV writes.
Both Worker routes use the same bearer key. `POST /capture` accepts
`{ "lookup": <successful lookup response> }` after user confirmation, retaining
the ID, timestamp, English definition, Chinese meaning and pronunciation.
Malformed or unsuccessful lookup results are rejected. Legacy text captures
remain supported. See `docs/iphone-shortcut.md` for the preview/cancel workflow.

Lookup sends only the chosen word to FreeDictionaryAPI.com (Wiktionary,
CC BY-SA 4.0). The device sends one English definition to MyMemory for translation,
avoiding the provider's shared Worker-IP quota. The legacy server-side `/lookup`
with `text` remains available but can encounter HTTP 429 for that shared quota.
Worker-side requests have timeouts; missing translations or quota errors prevent a
successful preview. The inbox key is never forwarded to providers. There is no
claim of contextual disambiguation: previews are dictionary senses and Chinese
machine translations. Attribution is retained in the saved card's source;
the concise preview displays only English and Chinese meanings.

## Private Accounts

Private accounts add the `ACCOUNT_DATA` SQLite Durable Object binding and its
`private-accounts-v1` migration. No new paid account or database credentials are
required for this deployment. Do not replace the existing inbox secrets or KV
binding: the original owner's inbox remains there.

Account API: `POST /session` redeems an invitation or validates a private access
code; `GET /account` returns only the authenticated identity; `POST /invites`
requires the original owner key; `GET /vault` and `PUT /vault` read/write only
the authenticated account's encrypted document. PUT requires `baseRevision`;
stale writes return 409. User IDs in URLs or request bodies cannot select another
account. New accounts use their own Durable Object for Shortcut captures.
The Worker rate limiter caps authenticated requests at 120 per minute per code.
The encrypted collection request limit is 8 MiB. Invitation codes and account
codes must never be logged or committed. Sessions use high-entropy access codes,
not user-chosen passwords; password reset and account recovery are not provided.

## Deploy

```sh
npm install
npx wrangler login --device
```

Generate two different 32-byte secrets and place them in a temporary, untracked
environment file:

```sh
INBOX_KEY=<random 32-byte value encoded as base64>
INBOX_ENCRYPTION_KEY=<different random 32-byte value encoded as base64>
```

Use that file for the first deployment because Wrangler cannot add required
secrets to a Worker that does not exist yet:

```sh
npx wrangler deploy \
  --config worker/wrangler.jsonc \
  --secrets-file /path/to/private-secrets.env
```

Wrangler automatically provisions the `CAPTURES` KV namespace. Do not commit
either secret or the temporary file. Put the `INBOX_KEY` and the deployed Worker
URL in SceneCards on each device and in the private iOS shortcut.

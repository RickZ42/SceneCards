# SceneCards mobile inbox

This Worker receives short, explicit vocabulary captures from the iOS share
sheet and exposes them to SceneCards. It never receives review history or the
GitHub token used by the main app.

Captured text is encrypted with AES-256-GCM before it is stored in Workers KV.
The same random inbox key authorizes both the iOS shortcut and SceneCards.
Captures expire after 180 days and are deduplicated by their stable capture ID
inside each SceneCards browser.

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

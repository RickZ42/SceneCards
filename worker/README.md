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
npx wrangler login
npx wrangler deploy --config worker/wrangler.jsonc
```

Wrangler automatically provisions the `CAPTURES` KV namespace on first deploy.
Set two Worker secrets before the final deployment:

```sh
openssl rand -base64 32 | npx wrangler secret put INBOX_KEY --config worker/wrangler.jsonc
openssl rand -base64 32 | npx wrangler secret put INBOX_ENCRYPTION_KEY --config worker/wrangler.jsonc
```

Do not commit either value. Put the `INBOX_KEY` and the deployed Worker URL in
SceneCards on each device and in the private iOS shortcut.

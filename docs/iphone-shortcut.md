# SceneCards iPhone capture

The bilingual shortcut looks up selected text, previews English definitions and
Chinese meanings, and saves to the private inbox only after confirmation. Lookup
does not write to the inbox. It does not receive Safari history, Bob history,
review progress, the GitHub token, or the review-sync password.

The Worker sends the selected word to FreeDictionaryAPI.com. The shortcut then
requests a Chinese translation of the English definition directly from MyMemory,
using the device's own connection instead of sharing a cloud-server quota.
Neither public service receives your inbox key. Dictionary definitions can differ from the
meaning in your original sentence; check the preview before saving.

## Connect SceneCards

1. Open SceneCards and tap the phone icon in the header.
2. Enter the deployed Worker URL and the private inbox key.
3. Turn on mobile inbox sync and choose **Save and sync**.
4. Repeat this once on each browser that should receive captures.

The key stays in that browser's local storage. It is deliberately excluded from
SceneCards backup files.

## Build the iOS shortcut

Create a shortcut named **Add to SceneCards** and enable **Show in Share Sheet**
for Text. Add these actions in order:

1. **Get Contents of URL** using `WORKER_URL/definition`.
2. Set the method to `POST` and the request body to JSON with:
   - `text`: Shortcut Input
   - `source`: `iPhone Share Sheet`
3. Add the request header `Authorization: Bearer INBOX_KEY`.
4. Preserve this output as `Definition Result`. Get `translationUrl` from it.
   If this has no value, show the response as an error and stop.
5. **Get Contents of URL** at `translationUrl`, method `GET`, with **no headers**.
   Preserve this output as `Translation Result`. Never copy the inbox key into
   this request; it goes directly to the public translation provider.
6. **Get Contents of URL** at `WORKER_URL/lookup`, method `POST`, using the inbox
   Authorization header. JSON fields: `definition` = Definition Result and
   `translation` = Translation Result. Dictionaries serialized as text are accepted.
7. Preserve this response as `Lookup Result`. Get `preview` from it. If it has
   no value, show the response as an error and stop. Do not continue to capture.
8. **Choose from Menu**: prompt = the preview value (English and Chinese only).
   Add one menu item, `Add`. Shortcuts supplies the native Cancel control.
   Cancel stops the shortcut before saving; put the following save actions
   inside the Add branch.
9. **Get Contents of URL** using `WORKER_URL/capture`, method `POST`, the same
   Authorization header, JSON request body with `lookup` = `Lookup Result`.
   The Worker accepts either a Dictionary or its JSON text representation.
10. Get `id` from the capture response. Only if present, show an `Added`
    notification. Otherwise show the returned error. End the menu branch.

The installed version uses magic-variable references and nested If branches
instead of named variables. Its 23 actions implement the same sequence. In
modern Shortcuts, set If inputs to **Text** and use **has any value**, not an
implicit File Size comparison. A key-free workflow template is included as
`docs/iphone-shortcut.template.json`; never commit its personalised signed version.

In the Share Sheet input settings, choose **Ask For Input** when there is no
input, so the shortcut can also run directly from its icon. Accept Text.

The lookup response contains a stable capture ID and timestamp. Retrying its save does
not create duplicate inbox records. Both languages and the pronunciation are
preserved in the saved item. Existing direct `/capture` clients remain supported.

Replace `WORKER_URL` and `INBOX_KEY` with the values shown during private inbox
setup. Do not share screenshots or exported copies of the shortcut while the
key is embedded in it.

The shortcut created on a Mac appears on the iPhone automatically when
Shortcuts is enabled in iCloud. Open Shortcuts on the iPhone once if it has not
yet appeared under **All Shortcuts** or **Share Sheet**.

## Use it

Select a useful English word or short phrase in Safari, Books, Notes, or another
app. Open Share, choose **Add to SceneCards**, read the bilingual preview, then
confirm or cancel. Confirmed words appear under **Inbox** in SceneCards with
their meanings already filled in. They remain drafts for checking and adding
your example sentence; existing review schedules are untouched.

Full sentences, unknown words, network failures and translation quota errors
stop lookup without saving. The shortcut needs an internet connection. Existing
installed shortcuts must be upgraded; deploying the Worker alone does not change
an old two-action shortcut.

Dictionary: [FreeDictionaryAPI.com](https://freedictionaryapi.com/), sourced from
[Wiktionary](https://en.wiktionary.org/) under CC BY-SA 4.0; the saved card retains
the word's source URL. Chinese: [MyMemory](https://mymemory.translated.net/doc/spec.php).

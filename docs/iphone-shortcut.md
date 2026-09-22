# SceneCards iPhone capture

The shortcut accepts text from the iOS Share Sheet and sends only that selected
text to the private SceneCards inbox. It does not receive Safari history, Bob
history, review progress, the GitHub token, or the review-sync password.

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

1. **Generate UUID**.
2. **Current Date**, formatted as ISO 8601.
3. **Get Contents of URL** using `WORKER_URL/capture`.
4. Set the method to `POST` and the request body to JSON with:
   - `id`: the generated UUID
   - `text`: Shortcut Input
   - `source`: `iPhone Share Sheet`
   - `createdAt`: the formatted current date
5. Add the request header `Authorization: Bearer INBOX_KEY`.
6. Add **Show Notification** with `Added to SceneCards`.

Replace `WORKER_URL` and `INBOX_KEY` with the values shown during private inbox
setup. Do not share screenshots or exported copies of the shortcut while the
key is embedded in it.

## Use it

Select a useful word, phrase, or sentence in Safari, Books, Notes, or another
app. Open Share, choose **Add to SceneCards**, and continue reading. The item
appears under **Inbox** in SceneCards. A sentence remains intact and waits for
you to choose its target word.

# todoist-age-injection

A Chrome/Brave (Manifest V3) extension that adds task age (**x days**) for
each task in the Todoist web app, showing how many whole days ago the task was
created. Built strictly to the project PRD.

A task created today shows `0d`; a task created six weeks ago shows `42d`.
Hover the label for the full date: *"Created 42 days ago (Dec 11, 2019)."*

---

## Install (unpacked)

1. Open `chrome://extensions` (or `brave://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. Click the extension's icon → **Open options**, and paste your Todoist API token.
5. Open or refresh [app.todoist.com](https://app.todoist.com). Ages appear next to your tasks.

## Getting your Todoist API token

In Todoist: **Settings → Integrations → Developer**, then copy the value under
**API token**. Or go directly to
<https://app.todoist.com/app/settings/integrations/developer>.

The token is stored only in your browser (`chrome.storage.local`) and is sent
only to `api.todoist.com`. It is never logged or transmitted anywhere else.
Use **Test connection** on the options page to confirm it works.

---

## How it works

- On `todoist.com`, the extension fetches your active tasks once per page load
  from the Todoist unified API v1 (`GET /api/v1/tasks`, paginated via
  `next_cursor`), reading each task's `added_at` timestamp.
- It watches the page for task rows (Todoist is a single-page app) and injects
  an age label into each one, updating as you switch views or add tasks.
- Age is computed in your local timezone as whole elapsed days.

The extension identifies task rows by Todoist's task-ID **data attribute**, not
by CSS class names. Todoist's class names are obfuscated and change frequently;
data attributes are far more stable. If Todoist ever renames that attribute, the
console logs a clear warning (prefixed `[todoist-age-injection]`) and the
attribute name can be changed in one place: `TIA_ID_ATTR` at the top of
`content.js`.

---

## Known limitations

- **Active tasks only.** Completed tasks are not shown by Todoist in normal list
  views, so they get no label.
- **List views.** Ages are designed for list views. Board (kanban) and Calendar
  views use a different layout; labels may not appear there.
- **One API call per page load.** For typical personal accounts (well under
  1,000 tasks) the REST endpoint returns everything in a single response. Very
  large accounts that exceed the API's single-response set may not have every
  task labeled.
- **Newly created tasks.** A task you just created shows its label a moment
  later, once Todoist confirms it with the server (it briefly has a temporary
  ID that can't be looked up).
- **Shared projects.** A task visible in the UI but not returned by your token's
  API view (e.g. some shared-project cases) is skipped silently.

---

## Troubleshooting

**Labels stopped appearing after a Todoist update.**
Open DevTools (F12) → Console and look for a line beginning
`[todoist-age-injection] found 0 task nodes`. If present, Todoist likely renamed
its task-ID attribute. Inspect a task row in the Elements panel, find the
attribute holding the task ID (something like `data-item-id`), and set
`TIA_ID_ATTR` in `content.js` to match, then reload the extension.

**A red "token rejected" banner appears.**
Your token is wrong or was revoked. Re-copy it from Todoist's Developer settings
and save again.

**Nothing happens and there's no banner.**
Confirm the extension is enabled and that you're on `https://app.todoist.com`. Check
the Console for `[todoist-age-injection]` messages.

---

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest |
| `core.js` | Pure logic: age math, formatting, ID parsing, cache, debounce |
| `inject.js` | DOM logic: find task rows, inject/remove labels, notices |
| `content.js` | Browser integration: token, fetch, observer, lifecycle |
| `injected.js` | MAIN-world hook for SPA navigation events |
| `background.js` | Minimal service worker (first-run hint) |
| `options.html` / `options.js` | Token entry, test, remove |
| `popup.html` / `popup.js` | Status + link to options |
| `styles.css` | Namespaced label and banner styles |

## Tests

The logic and integration layers have an automated test suite (72 tests) run
with Node + jsdom:

```
npm install jsdom
node test.js            # core + DOM injection (48)
node test-extended.js   # adversarial / real-user scenarios (13)
node test-integration.js# content.js wired to mocked chrome/fetch (11)
```

> Note: these tests cover all logic that can be verified without a live browser
> session. Because the extension runs against the real, logged-in Todoist DOM,
> the final selector check (confirming the task-ID attribute name in DevTools)
> must be done in your own browser — it cannot be automated here.

# todoist-age-injection

Ever look at a task in Todoist and wonder how long it's been sitting there? This extension answers that question automatically. It adds a small **"Task age: Nd"** label to every task showing how many days old it is — right in your task lists, and also in the detail panel when you open a task. Hover any label to see the exact date the task was created. No setup beyond pasting your Todoist API token once.

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

## What you'll see

**In list views** — every task row shows a compact **"Task age: Nd"** label (e.g. `Task age: 23d`). Hover it for the exact creation date: *"Created on 12/11/2019"*.

**In the task detail panel** — when you open a single task, a **"Task age: Nd"** line appears at the bottom of the properties sidebar (below Location), with the same hover tooltip.

A task created today shows `Task age: 0d`. Ages update as you switch views or add tasks — no page reload needed.

---

## How it works

- On page load the extension fetches all your active tasks from the Todoist API (`GET /api/v1/tasks`), reading each task's creation timestamp.
- It watches the page for new task rows and injects age labels automatically as you navigate.
- Age is computed in your local timezone as whole elapsed days.
- The detail panel label is detected by DOM structure, so it works regardless of which view you open a task from.

The extension identifies task rows by Todoist's task-ID **data attribute**, not
by CSS class names. Todoist's class names are obfuscated and change frequently;
data attributes are far more stable. If Todoist ever renames that attribute, the
console logs a clear warning (prefixed `[todoist-age-injection]`) and the
attribute name can be changed in one place: `TIA_ID_ATTR` at the top of
`content.js`.

---

## Known limitations

- **Active tasks only.** Completed tasks are not shown in normal list views, so they get no label.
- **List views.** Ages are designed for list views. Board (kanban) and Calendar views use a different layout; labels may not appear there.
- **Newly created tasks.** A task you just created shows its label a moment later, once Todoist confirms it with the server (it briefly has a temporary ID that can't be looked up).
- **Shared projects.** A task visible in the UI but not returned by your token's API view (e.g. some shared-project cases) is skipped silently.

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
| `inject.js` | DOM logic: find task rows, inject/remove labels and detail panel age |
| `content.js` | Browser integration: token, fetch, observer, lifecycle |
| `injected.js` | MAIN-world hook for SPA navigation events |
| `background.js` | Minimal service worker (first-run hint) |
| `options.html` / `options.js` | Token entry, test, remove |
| `popup.html` / `popup.js` | Status + link to options |
| `styles.css` | Namespaced label and banner styles |

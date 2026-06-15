/*
 * content.js — todoist-age-injection (isolated world)
 *
 * Orchestrates the extension on todoist.com:
 *   1. Inject injected.js into the MAIN world for SPA navigation events.
 *   2. Load the API token from chrome.storage.local.
 *   3. Set up the MutationObserver FIRST (so we never miss task nodes), then
 *      fetch all tasks and warm the cache, then re-scan.
 *   4. On every debounced DOM change or navigation, scan and inject labels.
 *   5. Clean up everything on page unload.
 *
 * Pure logic lives in core.js (TIA_CORE) and inject.js (TIA_INJECT), both
 * loaded before this file (see manifest content_scripts order). Those modules
 * are unit-tested; this file is the thin, browser-only integration layer.
 *
 * ---------------------------------------------------------------------------
 * PRE-CODING DOM NOTE (PRD "Pre-Coding Requirement"):
 * Todoist's web app uses obfuscated, unstable CSS class names, so this
 * extension deliberately NEVER selects by class. It anchors on the task-ID
 * data attribute (default "data-item-id") with a task-link href fallback.
 * If Todoist renames that attribute, scanAndInject() logs a clear warning and
 * the value can be changed in one place: TIA_ID_ATTR below. Confirm the live
 * attribute name via DevTools (inspect a task row) before relying on it.
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  const LOG = "[todoist-age-injection]";
  const core = window.TIA_CORE;
  const inject = window.TIA_INJECT;
  const TIA_ID_ATTR = "data-item-id"; // single source of truth for the selector
  const NOTICE_MSG =
    "todoist-age-injection: Add your API token in extension options to see task ages.";

  // In-memory cache: Map<taskId, created_at>. Lives for the tab session.
  let cache = new Map();
  let tokenPresent = false;
  let observer = null;

  /* ------------------------- MAIN-world injection ------------------------ */

  function injectMainWorldScript() {
    try {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("injected.js");
      s.onload = function () {
        // Keep the DOM tidy once it has run.
        s.remove();
      };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      console.warn(LOG + " could not inject navigation hook:", e);
    }
  }

  /* ----------------------------- scanning -------------------------------- */

  function scan() {
    if (!tokenPresent) return;
    try {
      inject.scanAndInject(document, cache, {
        now: new Date(),
        idAttr: TIA_ID_ATTR,
      });
    } catch (e) {
      console.warn(LOG + " scan error:", e);
    }
  }

  const debouncedScan = core.debounce(scan, 150);

  /* ------------------------------ fetching ------------------------------- */

  async function fetchTasks(token) {
    const url = "https://api.todoist.com/rest/v2/tasks";
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.status === 401) {
      const err = new Error("unauthorized");
      err.code = 401;
      throw err;
    }
    if (res.status === 429) {
      const retry = parseInt(res.headers.get("Retry-After") || "60", 10);
      const err = new Error("rate-limited");
      err.code = 429;
      err.retryAfter = isNaN(retry) ? 60 : retry;
      throw err;
    }
    if (!res.ok) {
      const err = new Error("http-" + res.status);
      err.code = res.status;
      throw err;
    }
    return res.json();
  }

  async function loadCache(token, isRetry) {
    try {
      const tasks = await fetchTasks(token);
      cache = core.buildCache(tasks);
      inject.clearNotice(document); // token works; remove any stale notice
      scan(); // re-scan now that the cache is warm
    } catch (e) {
      if (e.code === 401) {
        console.warn(LOG + " API token rejected (401).");
        inject.showNotice(
          document,
          "todoist-age-injection: Your API token was rejected. Re-enter it in extension options."
        );
      } else if (e.code === 429) {
        console.warn(LOG + " rate limited; retrying in " + e.retryAfter + "s.");
        setTimeout(() => loadCache(token, true), e.retryAfter * 1000);
      } else if (!isRetry) {
        console.warn(LOG + " task fetch failed (" + e.message + "); retrying in 2s.");
        setTimeout(() => loadCache(token, true), 2000);
      } else {
        console.warn(LOG + " task fetch failed again; giving up this session.");
      }
    }
  }

  /* ---------------------------- token / init ----------------------------- */

  function getToken() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(["todoistApiToken"], (result) => {
          resolve((result && result.todoistApiToken) || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function setupObserver() {
    observer = new MutationObserver(function () {
      debouncedScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function teardown() {
    try {
      if (observer) observer.disconnect();
      debouncedScan.cancel && debouncedScan.cancel();
      inject.removeAll(document);
    } catch (e) {
      /* best-effort cleanup */
    }
  }

  async function init() {
    if (!core || !inject) {
      console.warn(LOG + " core/inject modules missing; aborting.");
      return;
    }
    injectMainWorldScript();

    // Navigation + unload listeners.
    window.addEventListener("tia-navigation", debouncedScan);
    window.addEventListener("pagehide", teardown);

    // Observe the DOM FIRST so nothing is missed while the fetch is in flight.
    setupObserver();

    const token = await getToken();
    if (!token) {
      tokenPresent = false;
      inject.showNotice(document, NOTICE_MSG);
      return;
    }
    tokenPresent = true;
    await loadCache(token, false);
  }

  // React live to token changes from the options page (no reload needed).
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local" || !changes.todoistApiToken) return;
      const newToken = changes.todoistApiToken.newValue;
      if (newToken) {
        tokenPresent = true;
        inject.clearNotice(document);
        loadCache(newToken, false);
      } else {
        tokenPresent = false;
        cache = new Map();
        inject.removeAll(document);
        inject.showNotice(document, NOTICE_MSG);
      }
    });
  } catch (e) {
    /* storage events unavailable; ignore */
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

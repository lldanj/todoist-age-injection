/*
 * core.js — todoist-age-injection
 *
 * Pure, side-effect-free logic. No DOM, no chrome.*, no fetch here.
 * Everything in this file is unit-testable in plain Node.
 *
 * The content script and the test suite both consume these functions.
 * The dual export shim at the bottom makes it usable as both a browser
 * global (window.TIA_CORE) and a CommonJS module (require) without a build step.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api; // Node / tests
  } else {
    root.TIA_CORE = api; // browser content script
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MS_PER_DAY = 86400000;

  /**
   * Compute whole days between a task's creation timestamp and now.
   * Uses local wall-clock days, per the PRD: "days old" is human-scale.
   *
   * @param {string} createdAtISO ISO 8601 timestamp (e.g. "2019-12-11T22:36:50.000000Z")
   * @param {Date}   [now]        Injectable clock for deterministic tests.
   * @returns {number|null} whole days old, or null if the input is unparseable.
   */
  function daysOld(createdAtISO, now) {
    if (createdAtISO == null) return null;
    const created = new Date(createdAtISO);
    if (isNaN(created.getTime())) return null;
    const reference = now instanceof Date ? now : new Date();
    const diff = reference.getTime() - created.getTime();
    // A task created "in the future" (clock skew) clamps to 0, never negative.
    if (diff < 0) return 0;
    return Math.floor(diff / MS_PER_DAY);
  }

  /**
   * The short label text shown inline next to a task.
   * @param {number} days
   * @returns {string} e.g. "0d", "42d"
   */
  function formatAgeLabel(days) {
    return days + "d";
  }

  /**
   * The verbose tooltip text.
   * @param {number} days
   * @param {string} createdAtISO
   * @param {Date}   [now]
   * @returns {string} e.g. "Created 42 days ago (Dec 11, 2019)"
   */
  function formatAgeTooltip(days, createdAtISO, now) {
    const created = new Date(createdAtISO);
    const dateStr = isNaN(created.getTime())
      ? "unknown date"
      : created.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
    const dayWord = days === 1 ? "day" : "days";
    return "Created " + days + " " + dayWord + " ago (" + dateStr + ")";
  }

  /**
   * Todoist assigns optimistic placeholder IDs prefixed with "tmp-" before
   * the server confirms a new task. These cannot be looked up via REST.
   * @param {string} id
   * @returns {boolean}
   */
  function isPlaceholderId(id) {
    return typeof id === "string" && id.indexOf("tmp-") === 0;
  }

  /**
   * Extract a Todoist task ID from a task link href.
   * Handles "showTask?id=123", "/app/task/123", and trailing query params.
   * Returns null if no recognizable ID is found.
   * @param {string} href
   * @returns {string|null}
   */
  function extractIdFromHref(href) {
    if (typeof href !== "string") return null;
    // Pattern 1: ...showTask?id=2995104339  (classic web URL form)
    let m = href.match(/showTask\?id=(\d+)/);
    if (m) return m[1];
    // Pattern 2: .../task/2995104339 or .../app/task/2995104339
    m = href.match(/\/task\/([A-Za-z0-9]+)/);
    if (m) return m[1];
    return null;
  }

  /**
   * Build the Map<id, added_at> cache from a /tasks response array.
   * Skips malformed entries defensively.
   * @param {Array<object>} tasks
   * @returns {Map<string,string>}
   */
  function buildCache(tasks) {
    const cache = new Map();
    if (!Array.isArray(tasks)) return cache;
    for (const t of tasks) {
      if (t && t.id != null && t.added_at != null) {
        cache.set(String(t.id), t.added_at);
      }
    }
    return cache;
  }

  /**
   * Given a cache and a task id, return everything the UI needs to render,
   * or null if the task is not in the cache.
   * @param {Map<string,string>} cache
   * @param {string} id
   * @param {Date} [now]
   * @returns {{days:number,label:string,tooltip:string}|null}
   */
  function describeTask(cache, id, now) {
    if (!cache || typeof cache.get !== "function") return null;
    const createdAt = cache.get(String(id));
    if (createdAt == null) return null;
    const days = daysOld(createdAt, now);
    if (days == null) return null;
    return {
      days: days,
      label: formatAgeLabel(days),
      tooltip: formatAgeTooltip(days, createdAt, now),
    };
  }

  /**
   * Simple trailing-edge debounce. Used to throttle MutationObserver bursts.
   * Exposed so tests can verify call collapsing with a fake timer.
   * @param {Function} fn
   * @param {number} wait ms
   * @param {object} [scheduler] {setTimeout, clearTimeout} for test injection
   * @returns {Function & {cancel: Function}}
   */
  function debounce(fn, wait, scheduler) {
    const setT = (scheduler && scheduler.setTimeout) || setTimeout;
    const clearT = (scheduler && scheduler.clearTimeout) || clearTimeout;
    let timer = null;
    const wrapped = function () {
      const args = arguments;
      const ctx = this;
      if (timer !== null) clearT(timer);
      timer = setT(function () {
        timer = null;
        fn.apply(ctx, args);
      }, wait);
    };
    wrapped.cancel = function () {
      if (timer !== null) {
        clearT(timer);
        timer = null;
      }
    };
    return wrapped;
  }

  return {
    MS_PER_DAY: MS_PER_DAY,
    daysOld: daysOld,
    formatAgeLabel: formatAgeLabel,
    formatAgeTooltip: formatAgeTooltip,
    isPlaceholderId: isPlaceholderId,
    extractIdFromHref: extractIdFromHref,
    buildCache: buildCache,
    describeTask: describeTask,
    debounce: debounce,
  };
});

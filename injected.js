/*
 * injected.js — runs in the PAGE's own JS context (MAIN world).
 *
 * Sole job: tell the content script when Todoist navigates between views.
 * Todoist is a SPA that uses history.pushState; neither popstate nor
 * hashchange fires on programmatic pushState, so we wrap those methods and
 * emit a CustomEvent the (isolated-world) content script can hear.
 *
 * This script handles NO task data and reads NO user content.
 */
(function () {
  "use strict";
  if (window.__tiaNavPatched) return;
  window.__tiaNavPatched = true;

  function emit() {
    window.dispatchEvent(new CustomEvent("tia-navigation"));
  }

  const origPush = history.pushState;
  history.pushState = function () {
    const r = origPush.apply(this, arguments);
    emit();
    return r;
  };

  const origReplace = history.replaceState;
  history.replaceState = function () {
    const r = origReplace.apply(this, arguments);
    emit();
    return r;
  };

  window.addEventListener("popstate", emit);
})();

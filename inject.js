/*
 * inject.js — todoist-age-injection
 *
 * DOM-manipulation logic, factored so it can run against a real browser
 * document OR a jsdom document in tests. It depends only on a `document`
 * and the core logic module — no chrome.*, no fetch.
 *
 * The selector strategy is intentionally configurable and self-diagnosing,
 * because Todoist's live DOM uses obfuscated class names and the exact
 * task-ID attribute MUST be confirmed against the live DOM (see PRD
 * "Pre-Coding Requirement"). We default to the documented `data-item-id`
 * with an href fallback, and we log loudly if a scan finds zero tasks.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TIA_INJECT = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LABEL_CLASS = "tia-age-label";
  const DETAIL_LABEL_CLASS = "tia-detail-age";
  const NOTICE_CLASS = "tia-notice-banner";
  const INJECTED_ATTR = "data-tia-injected";
  const LOG = "[todoist-age-injection]";

  /**
   * Resolve the core module in both environments.
   */
  function getCore(root) {
    if (typeof module === "object" && module.exports) {
      return require("./core.js");
    }
    return root.TIA_CORE;
  }

  /**
   * Find candidate task nodes in the document that have not yet been processed.
   * Primary strategy: elements carrying the Todoist task-ID data attribute.
   * Fallback strategy: task-detail links whose href encodes the task ID.
   *
   * @param {Document} doc
   * @param {object} [opts] {idAttr}
   * @returns {Array<{node: Element, id: string}>}
   */
  function findTaskNodes(doc, opts) {
    const core = getCore(typeof self !== "undefined" ? self : this);
    const idAttr = (opts && opts.idAttr) || "data-item-id";
    const results = [];
    const seenNodes = new Set();

    // Primary: [data-item-id]
    const primary = doc.querySelectorAll("[" + idAttr + "]");
    for (const node of primary) {
      if (node.getAttribute(INJECTED_ATTR) === "true") continue;
      const id = node.getAttribute(idAttr);
      if (!id) continue;
      results.push({ node: node, id: String(id) });
      seenNodes.add(node);
    }

    // Fallback: links of the form .../showTask?id=NNN or .../task/NNN.
    // Only used to catch task rows the primary selector missed; we attach the
    // label to the closest reasonable row container (li/[role=listitem]) so
    // the same node isn't double-counted.
    // NOTE: CSS attribute matching is case-sensitive, and the classic URL form
    // is "showTask" (capital T). Match both cases without relying on casing.
    const links = doc.querySelectorAll('a[href*="task" i], a[href*="Task" i]');
    for (const link of links) {
      const id = core.extractIdFromHref(link.getAttribute("href") || "");
      if (!id) continue;
      const row = closestRow(link);
      if (!row || seenNodes.has(row)) continue;
      if (row.getAttribute(INJECTED_ATTR) === "true") continue;
      results.push({ node: row, id: String(id) });
      seenNodes.add(row);
    }

    return results;
  }

  /**
   * Walk up from a node to the nearest plausible task-row container.
   * @param {Element} el
   * @returns {Element|null}
   */
  function closestRow(el) {
    let cur = el;
    let hops = 0;
    while (cur && hops < 6) {
      const role = cur.getAttribute && cur.getAttribute("role");
      const tag = cur.tagName && cur.tagName.toLowerCase();
      if (role === "listitem" || tag === "li") return cur;
      cur = cur.parentElement;
      hops++;
    }
    return el.parentElement || el;
  }

  /**
   * Choose where INSIDE a task row to place the label.
   *
   * The outer task node (an <li>) can contain a nested <ul>/<ol> of subtasks.
   * Appending to the outer node would drop the label *below* the subtask list,
   * visually detaching it from the parent's title. Per the PRD, the label
   * belongs in the task's own content row, after the title and metadata.
   *
   * Strategy: prefer the row's own title/content wrapper (the element holding
   * the task link), as long as that wrapper does not itself contain a nested
   * task list. Fall back to the node itself only when nothing better exists.
   *
   * @param {Element} node the task row (e.g. <li data-item-id>)
   * @returns {Element} the element to appendChild the label to
   */
  function pickLabelTarget(node) {
    // Primary: insert into the title flex row (the sibling immediately before the
    // info-tags row). This places the label right-justified above the project
    // breadcrumb. data-testid="task-info-tags" is a stable test attribute.
    const infoTags = node.querySelector('[data-testid="task-info-tags"]');
    if (infoTags && infoTags.previousElementSibling) {
      return infoTags.previousElementSibling;
    }

    // Fallback: walk up from the first task link to a container without nested tasks.
    const link = node.querySelector("a");
    if (link) {
      let container = link.parentElement;
      let hops = 0;
      while (container && container !== node && hops < 4) {
        if (!container.querySelector("ul, ol, [data-item-id]")) {
          return container;
        }
        container = container.parentElement;
        hops++;
      }
    }
    // If the row has a direct child that holds the content and no nested list,
    // use the first such child.
    for (const child of node.children) {
      const tag = child.tagName && child.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") continue;
      if (child.querySelector && child.querySelector("[data-item-id]")) continue;
      return child;
    }
    // Last resort: the node itself (flat task with no nested structure).
    return node;
  }

  /**
   * Create the age-label element.
   * @param {Document} doc
   * @param {{label:string,tooltip:string}} desc
   * @returns {Element}
   */
  function makeLabel(doc, desc) {
    const span = doc.createElement("span");
    span.className = LABEL_CLASS;
    span.textContent = desc.label;
    span.setAttribute("title", desc.tooltip);
    span.setAttribute("aria-label", desc.tooltip);
    return span;
  }

  /**
   * Inject (or skip) an age label for a single task node.
   * Idempotent: a node marked data-tia-injected="true" is never touched again.
   *
   * @param {Document} doc
   * @param {Element} node
   * @param {string} id
   * @param {Map} cache
   * @param {object} [opts] {now}
   * @returns {"injected"|"skipped-injected"|"skipped-placeholder"|"skipped-nocache"}
   */
  function injectOne(doc, node, id, cache, opts) {
    const core = getCore(typeof self !== "undefined" ? self : this);
    const now = opts && opts.now;

    if (node.getAttribute(INJECTED_ATTR) === "true") return "skipped-injected";
    if (core.isPlaceholderId(id)) return "skipped-placeholder";

    const desc = core.describeTask(cache, id, now);
    if (!desc) return "skipped-nocache";

    const label = makeLabel(doc, desc);
    const target = pickLabelTarget(node);
    target.appendChild(label);
    node.setAttribute(INJECTED_ATTR, "true");
    return "injected";
  }

  /**
   * Scan the whole document and inject labels for all un-injected tasks.
   * Returns a summary tally — useful for tests and for the self-diagnosing
   * "zero tasks found" warning.
   *
   * @param {Document} doc
   * @param {Map} cache
   * @param {object} [opts] {now, idAttr, logger}
   * @returns {{found:number, injected:number, placeholder:number, nocache:number}}
   */
  function scanAndInject(doc, cache, opts) {
    opts = opts || {};
    const logger = opts.logger || console;
    const nodes = findTaskNodes(doc, opts);
    const tally = { found: nodes.length, injected: 0, placeholder: 0, nocache: 0 };

    for (const item of nodes) {
      const outcome = injectOne(doc, item.node, item.id, cache, opts);
      if (outcome === "injected") tally.injected++;
      else if (outcome === "skipped-placeholder") tally.placeholder++;
      else if (outcome === "skipped-nocache") tally.nocache++;
    }

    // Self-diagnosis: if the page clearly has content but we matched nothing,
    // the selector strategy has probably gone stale against a Todoist redesign.
    if (tally.found === 0 && doc.body && doc.body.childElementCount > 0) {
      logger.warn(
        LOG +
          " found 0 task nodes. Todoist's DOM may have changed; the task-ID " +
          "selector ('" +
          ((opts && opts.idAttr) || "data-item-id") +
          "') may need updating."
      );
    }

    return tally;
  }

  /**
   * Find the task-detail panel node and the task ID being viewed.
   *
   * Primary: look for a [data-item-id] element that is NOT a plain list row
   * (i.e. not inside an <li> or [role="listitem"]).  This covers Todoist's
   * right-side detail panel which carries the same attribute.
   * Fallback: try known data-testid values for the detail panel.
   *
   * @param {Document} doc
   * @param {object} opts  – must contain opts.href (current window.location.href)
   * @returns {{node:Element, id:string}|null}
   */
  function findDetailNode(doc, opts) {
    const core = getCore(typeof self !== "undefined" ? self : this);
    const href = (opts && opts.href) || "";
    const id = core.extractIdFromHref(href);
    if (!id) return null;

    // A. data-item-id match that is NOT a plain list row.
    const candidates = doc.querySelectorAll('[data-item-id="' + id + '"]');
    for (const el of candidates) {
      if (!el.closest("li") && !el.closest('[role="listitem"]')) {
        return { node: el, id: id };
      }
    }

    // B. Known data-testid patterns Todoist uses for the detail panel.
    const testIds = ["task-detail", "task-detail-content", "task-details", "detail-panel"];
    for (const tid of testIds) {
      const el = doc.querySelector('[data-testid="' + tid + '"]');
      if (el) return { node: el, id: id };
    }

    return null;
  }

  /**
   * Pick where inside the detail panel to place the age row.
   * Mirrors the list-view strategy: prefer the info-tags element, then fall
   * back to the first non-list child, then the container itself.
   * @param {Element} node
   * @returns {Element}
   */
  function pickDetailTarget(node) {
    const infoTags = node.querySelector('[data-testid="task-info-tags"]');
    if (infoTags) return infoTags;

    for (const child of node.children) {
      const tag = child.tagName && child.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") continue;
      if (child.querySelector && child.querySelector("[data-item-id]")) continue;
      return child;
    }
    return node;
  }

  /**
   * Inject (or refresh) the age label into the task detail panel.
   *
   * Idempotent per task ID: the label carries a data-tia-task-id attribute so
   * we can detect a stale label (user navigated to a different task) and swap
   * it out without duplicating work on every debounced scan.
   *
   * Shows the full human-readable string ("Created 42 days ago (Dec 11, 2019)")
   * rather than the compact chip — the detail view has the space for it.
   *
   * @param {Document} doc
   * @param {Map} cache
   * @param {object} opts – {href, now}
   * @returns {string} status for logging
   */
  function injectDetailAge(doc, cache, opts) {
    const core = getCore(typeof self !== "undefined" ? self : this);
    const href = (opts && opts.href) || "";
    const id = core.extractIdFromHref(href);

    // Remove a stale label left over from a previous task view.
    const existing = doc.querySelector("." + DETAIL_LABEL_CLASS);
    if (existing) {
      if (existing.getAttribute("data-tia-task-id") === id) return "already-injected";
      existing.parentNode && existing.parentNode.removeChild(existing);
    }

    if (!id) return "no-id";
    if (core.isPlaceholderId(id)) return "placeholder";

    const info = findDetailNode(doc, opts);
    if (!info) return "no-panel";

    const desc = core.describeTask(cache, id, opts && opts.now);
    if (!desc) return "no-cache";

    const el = doc.createElement("div");
    el.className = DETAIL_LABEL_CLASS;
    el.textContent = desc.tooltip;
    el.setAttribute("data-tia-task-id", id);
    el.setAttribute("aria-label", desc.tooltip);

    pickDetailTarget(info.node).appendChild(el);
    return "injected";
  }

  /**
   * Remove every artifact this extension added: labels, the notice banner,
   * and the sentinel attributes. Used on unload and on token (re)config.
   * @param {Document} doc
   * @returns {number} count of elements removed
   */
  function removeAll(doc) {
    let removed = 0;
    const labels = doc.querySelectorAll("." + LABEL_CLASS + ", ." + DETAIL_LABEL_CLASS);
    for (const el of labels) {
      el.parentNode && el.parentNode.removeChild(el);
      removed++;
    }
    const notices = doc.querySelectorAll("." + NOTICE_CLASS);
    for (const el of notices) {
      el.parentNode && el.parentNode.removeChild(el);
      removed++;
    }
    const marked = doc.querySelectorAll("[" + INJECTED_ATTR + "]");
    for (const el of marked) {
      el.removeAttribute(INJECTED_ATTR);
    }
    return removed;
  }

  /**
   * Show (once) the "configure your token" notice at the top of the page.
   * Idempotent: never creates a second banner.
   * @param {Document} doc
   * @param {string} message
   * @returns {Element|null} the banner, or null if one already existed
   */
  function showNotice(doc, message) {
    if (doc.querySelector("." + NOTICE_CLASS)) return null;
    const bar = doc.createElement("div");
    bar.className = NOTICE_CLASS;
    bar.textContent = message;
    if (doc.body) doc.body.insertBefore(bar, doc.body.firstChild);
    return bar;
  }

  /**
   * Remove the notice banner (e.g. after a token is saved).
   * @param {Document} doc
   * @returns {boolean} whether a banner was removed
   */
  function clearNotice(doc) {
    const bar = doc.querySelector("." + NOTICE_CLASS);
    if (bar && bar.parentNode) {
      bar.parentNode.removeChild(bar);
      return true;
    }
    return false;
  }

  return {
    LABEL_CLASS: LABEL_CLASS,
    DETAIL_LABEL_CLASS: DETAIL_LABEL_CLASS,
    NOTICE_CLASS: NOTICE_CLASS,
    INJECTED_ATTR: INJECTED_ATTR,
    findTaskNodes: findTaskNodes,
    injectOne: injectOne,
    scanAndInject: scanAndInject,
    injectDetailAge: injectDetailAge,
    removeAll: removeAll,
    showNotice: showNotice,
    clearNotice: clearNotice,
  };
});

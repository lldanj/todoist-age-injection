/*
 * options.js — token management UI logic.
 */
(function () {
  "use strict";

  const tokenInput = document.getElementById("token");
  const revealBtn = document.getElementById("reveal");
  const saveBtn = document.getElementById("save");
  const testBtn = document.getElementById("test");
  const clearBtn = document.getElementById("clear");
  const status = document.getElementById("status");

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "status" + (kind ? " " + kind : "");
  }

  // Load any saved token on open.
  chrome.storage.local.get(["todoistApiToken"], function (res) {
    if (res && res.todoistApiToken) {
      tokenInput.value = res.todoistApiToken;
      setStatus("A token is saved.", "ok");
    }
  });

  revealBtn.addEventListener("click", function () {
    if (tokenInput.type === "password") {
      tokenInput.type = "text";
      revealBtn.textContent = "Hide";
    } else {
      tokenInput.type = "password";
      revealBtn.textContent = "Show";
    }
  });

  function cleanToken() {
    // Todoist plugin authors note tokens often arrive with stray whitespace.
    return (tokenInput.value || "").trim();
  }

  saveBtn.addEventListener("click", function () {
    const token = cleanToken();
    if (!token) {
      setStatus("Enter a token first.", "err");
      return;
    }
    chrome.storage.local.set({ todoistApiToken: token }, function () {
      tokenInput.value = token;
      setStatus("Saved. Open or refresh Todoist to see task ages.", "ok");
    });
  });

  clearBtn.addEventListener("click", function () {
    chrome.storage.local.remove("todoistApiToken", function () {
      tokenInput.value = "";
      setStatus("Token removed.", "ok");
    });
  });

  testBtn.addEventListener("click", async function () {
    const token = cleanToken();
    if (!token) {
      setStatus("Enter a token to test.", "err");
      return;
    }
    setStatus("Testing…", null);
    try {
      const res = await fetch("https://api.todoist.com/rest/v2/tasks", {
        headers: { Authorization: "Bearer " + token },
      });
      if (res.status === 401) {
        setStatus("Token rejected (401). Check that you copied it correctly.", "err");
        return;
      }
      if (res.status === 429) {
        setStatus("Rate limited (429). Wait a minute and try again.", "err");
        return;
      }
      if (!res.ok) {
        setStatus("Unexpected response: HTTP " + res.status + ".", "err");
        return;
      }
      const tasks = await res.json();
      const n = Array.isArray(tasks) ? tasks.length : 0;
      setStatus("Connected. Found " + n + " active task" + (n === 1 ? "" : "s") + ".", "ok");
    } catch (e) {
      setStatus("Network error. Check your connection and try again.", "err");
    }
  });
})();

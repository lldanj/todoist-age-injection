/* popup.js */
(function () {
  "use strict";
  const state = document.getElementById("state");
  chrome.storage.local.get(["todoistApiToken"], function (res) {
    if (res && res.todoistApiToken) {
      state.textContent = "Token saved. Ages show on todoist.com.";
      state.className = "ok";
    } else {
      state.textContent = "No token yet. Add one to see task ages.";
      state.className = "warn";
    }
  });
  document.getElementById("open").addEventListener("click", function () {
    chrome.runtime.openOptionsPage();
  });
})();

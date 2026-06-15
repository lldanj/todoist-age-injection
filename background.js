/*
 * background.js — todoist-age-injection service worker (MV3)
 *
 * Intentionally minimal. All API calls and DOM work happen in the content
 * script (no CORS issue thanks to host_permissions, and the service worker is
 * ephemeral so it's a poor place to hold session state). This worker only
 * logs a first-run hint so the user knows to set their token.
 */
chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === "install") {
    console.log(
      "[todoist-age-injection] installed. Open the extension options to add your Todoist API token."
    );
  }
});

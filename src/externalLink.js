// The editor's webview asks for a popup when an extension opens a sign-in URL.
// We never let it have one — the URL goes to the system browser instead.

const EXTERNAL_PROTOCOLS = ["http:", "https:"];

function isExternal(url) {
  try {
    return EXTERNAL_PROTOCOLS.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function handleWindowOpen(url, openExternal) {
  if (isExternal(url)) openExternal(url);
  return { action: "deny" };
}

module.exports = { isExternal, handleWindowOpen };

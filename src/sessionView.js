// Pure helpers behind the sidebar rows. No DOM, so the renderer loads this as a plain
// script and the tests require it.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function formatTokens(n) {
    if (!n) return "0";
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
  }

  function sessionName(session) {
    const parts = session.folder.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : `Session ${session.id}`;
  }

  function sessionMonogram(session) {
    const letter = sessionName(session)
      .replace(/[^a-z0-9]/gi, "")
      .charAt(0);
    return letter ? letter.toLowerCase() : "•";
  }

  function sessionStatus(session) {
    if (session.exited) return "exited";
    if (session.unread) return "ready";
    if (session.status === "working") return "working";
    return "idle";
  }

  function micState(session, listening, activeId) {
    if (!listening) return "off";
    return session.id === activeId ? "active" : "idle";
  }

  function speakerState(session) {
    if (session.speaking) return "active";
    return session.reading ? "idle" : "off";
  }

  function canChangeFolder(session) {
    return !!session && !session.term && !session.editorUrl;
  }

  return {
    formatTokens,
    sessionName,
    sessionMonogram,
    sessionStatus,
    micState,
    speakerState,
    canChangeFolder,
  };
});

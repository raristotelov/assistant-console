function createShutdown({ closeSessions, stopTts, quit }) {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    closeSessions();
    stopTts();
    quit();
  };
}

module.exports = { createShutdown };

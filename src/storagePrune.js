const LOCAL_ORIGIN_DIR = /^http_(127\.0\.0\.1)_(\d+)\.indexeddb\b/;

const PRUNED_STORAGES = [
  "cachestorage",
  "cookies",
  "filesystem",
  "indexdb",
  "localstorage",
  "serviceworkers",
  "websql",
];

function editorOrigins(entries) {
  const origins = new Set();
  for (const entry of entries) {
    const match = LOCAL_ORIGIN_DIR.exec(entry);
    if (match) origins.add(`http://${match[1]}:${match[2]}`);
  }
  return [...origins];
}

module.exports = { editorOrigins, PRUNED_STORAGES };

const test = require("node:test");
const assert = require("node:assert/strict");
const { editorOrigins, PRUNED_STORAGES } = require("../src/storagePrune");

test("finds an origin for each editor port, once", () => {
  assert.deepEqual(
    editorOrigins([
      "http_127.0.0.1_49518.indexeddb.leveldb",
      "http_127.0.0.1_49518.indexeddb.blob",
      "http_127.0.0.1_63656.indexeddb.leveldb",
    ]),
    ["http://127.0.0.1:49518", "http://127.0.0.1:63656"],
  );
});

test("leaves anything that is not a local editor origin alone", () => {
  assert.deepEqual(
    editorOrigins([
      "https_github.com_0.indexeddb.leveldb",
      "http_localhost_3000.indexeddb.leveldb",
      "http_192.168.1.4_8080.indexeddb.leveldb",
      "LOCK",
      "",
    ]),
    [],
  );
});

test("an empty profile yields nothing", () => {
  assert.deepEqual(editorOrigins([]), []);
});

test("clears the stores an editor actually writes to", () => {
  for (const storage of ["indexdb", "serviceworkers", "localstorage", "cachestorage"]) {
    assert.ok(PRUNED_STORAGES.includes(storage), `${storage} should be pruned`);
  }
});

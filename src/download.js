const fs = require("node:fs");
const https = require("node:https");
const { execFileSync } = require("node:child_process");

function fetchToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "user-agent": "assistant-console" } }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        fetchToFile(headers.location, dest).then(resolve, reject);
        return;
      }
      if (statusCode !== 200) {
        res.resume();
        reject(new Error(`download failed: HTTP ${statusCode}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    });
    req.on("error", reject);
  });
}

function extractTarGz(tarball, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", destDir]);
}

module.exports = { fetchToFile, extractTarGz };

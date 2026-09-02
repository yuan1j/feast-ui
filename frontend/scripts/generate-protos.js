"use strict";

/**
 * Cross-platform generator for src/protos.js / src/protos.d.ts
 *
 * Replaces the generate-protos script in package.json that relied on bash
 * backticks (`find ../protos/feast/ -iname *.proto`) so that yarn/npm also
 * work on Windows (cmd/PowerShell).
 */

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const cwd = process.cwd(); // Defaults to the ui directory (where package.json lives)
const uiDir = path.resolve(__dirname, "..");
const protosFeastDir = path.join(uiDir, "protos", "feast");

// Recursively collect all .proto files, returning paths relative to ui (forward slashes)
function findProtoFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findProtoFiles(full));
    } else if (entry.name.endsWith(".proto")) {
      // Path relative to the ui directory, e.g. protos/feast/core/Aggregation.proto
      results.push(path.relative(uiDir, full).split(path.sep).join("/"));
    }
  }
  return results;
}

const protoFiles = findProtoFiles(protosFeastDir);
if (!protoFiles.length) {
  console.error(`[generate-protos] No .proto files found: ${protosFeastDir}`);
  process.exit(1);
}

const cliBin = path.join(uiDir, "node_modules", "protobufjs-cli", "bin");

function run(cmd, args) {
  const res = spawnSync(process.execPath, [cmd, ...args], {
    cwd,
    stdio: "inherit",
  });
  if (res.error) throw res.error;
  return res.status;
}

// pbjs --no-encode -o src/protos.js -w commonjs -t static-module --path protos <files>
let status = run(path.join(cliBin, "pbjs"), [
  "--no-encode",
  "-o",
  "src/protos.js",
  "-w",
  "commonjs",
  "-t",
  "static-module",
  "--path",
  "protos",
  ...protoFiles,
]);
if (status !== 0) process.exit(status || 1);

// pbts -n protos -o src/protos.d.ts src/protos.js
status = run(path.join(cliBin, "pbts"), [
  "-n",
  "protos",
  "-o",
  "src/protos.d.ts",
  "src/protos.js",
]);
if (status !== 0) process.exit(status || 1);

console.log(`[generate-protos] Done: generated from ${protoFiles.length} proto files`);

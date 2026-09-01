"use strict";

/**
 * 跨平台生成 src/protos.js / src/protos.d.ts
 *
 * 替代 package.json 中依赖 bash 反引号 `find ../protos/feast/ -iname *.proto` 的
 * generate-protos 脚本，使 Windows（cmd/PowerShell）下 yarn/npm 也能正常运行。
 */

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const cwd = process.cwd(); // 默认是 ui 目录（package.json 所在目录）
const uiDir = path.resolve(__dirname, "..");
const feastDir = path.resolve(uiDir, ".."); // feast 仓库根目录
const protosFeastDir = path.join(feastDir, "protos", "feast");

// 递归收集所有 .proto 文件，返回相对路径（正斜杠分隔）
function findProtoFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findProtoFiles(full));
    } else if (entry.name.endsWith(".proto")) {
      // 与原脚本 find 输出一致的相对路径，如 ../protos/feast/core/Aggregation.proto
      results.push(path.relative(uiDir, full).split(path.sep).join("/"));
    }
  }
  return results;
}

const protoFiles = findProtoFiles(protosFeastDir);
if (!protoFiles.length) {
  console.error(`[generate-protos] 未找到任何 .proto 文件: ${protosFeastDir}`);
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

// pbjs --no-encode -o src/protos.js -w commonjs -t static-module --path ../protos <files>
let status = run(path.join(cliBin, "pbjs"), [
  "--no-encode",
  "-o",
  "src/protos.js",
  "-w",
  "commonjs",
  "-t",
  "static-module",
  "--path",
  "../protos",
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

console.log(`[generate-protos] 生成完成：共 ${protoFiles.length} 个 proto 文件`);

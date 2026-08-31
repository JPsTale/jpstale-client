import { execSync } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const outDir = resolve("src/net/proto");

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const pbjs = resolve("node_modules/protobufjs-cli/bin/pbjs");
const pbts = resolve("node_modules/protobufjs-cli/bin/pbts");

execSync(
  `node "${pbjs}" -t static-module -w commonjs -p proto -o "${outDir}/base_message.js" proto/base/message.proto`,
  { stdio: "inherit" }
);
execSync(
  `node "${pbts}" -o "${outDir}/base_message.d.ts" "${outDir}/base_message.js"`,
  { stdio: "inherit" }
);

console.log("Proto generation complete.");

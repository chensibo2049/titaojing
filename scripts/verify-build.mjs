// Verify the public artifact against its source identity and exhaustive integrity manifest.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const root = path.resolve(process.argv[2] || "dist");
const strict = process.argv.includes("--release");
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const version = read("version.json"), manifest = read("build-manifest.json");
assert.equal(manifest.schemaVersion, 1);
for (const key of ["version", "buildId", "sourceCommit", "sourceDirty"]) assert.equal(manifest[key], version[key], key);
assert.match(version.sourceCommit, /^[a-f0-9]{40}$/);
assert.match(version.buildId, /^\d+\.\d+\.\d+-[a-f0-9]{8}$/);
const expected = new Set(["build-manifest.json"]);
for (const file of manifest.files) {
  assert.equal(typeof file.path, "string");
  assert(!path.isAbsolute(file.path) && !file.path.split("/").some(p => p === ".." || !p));
  assert(!expected.has(file.path), "duplicate manifest entry");
  expected.add(file.path);
  const target = path.join(root, file.path);
  assert(fs.lstatSync(target).isFile(), "manifest target must be regular file");
  const data = fs.readFileSync(target);
  assert.equal(data.length, file.bytes, file.path + " size");
  assert.equal(crypto.createHash("sha256").update(data).digest("hex"), file.sha256, file.path + " sha256");
}
const actual = new Set();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    assert(!entry.isSymbolicLink(), "artifact symlink forbidden");
    if (entry.isDirectory()) walk(target);
    else { assert(entry.isFile()); actual.add(path.relative(root, target).split(path.sep).join("/")); }
  }
}
walk(root);
assert.deepEqual(actual, expected, "artifact file list");
if (strict) {
  assert.equal(version.sourceDirty, false, "dirty source cannot be released");
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), version.sourceCommit, "stale source commit");
  assert.equal(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim(), "", "working tree must remain clean");
}
console.log(`PASS artifact ${version.buildId}: ${manifest.files.length} SHA256 entries; source=${version.sourceCommit}; dirty=${version.sourceDirty}`);

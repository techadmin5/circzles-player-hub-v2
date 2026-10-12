import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
test("frontend TypeScript graph never enters backend implementation or dependencies", () => {
  const config = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const backend = program.getSourceFiles().map(file => relative(root, file.fileName).replaceAll("\\", "/")).filter(file => file.startsWith("backend/"));
  assert.deepEqual(backend, [], "Frontend imports must not pull backend code into Next.js type checking");
});
test("frontend and shared sources do not import backend implementation modules", () => {
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (/\.(?:ts|tsx|js|jsx|mjs|mts)$/.test(item.name)) {
        const text = readFileSync(path, "utf8");
        assert.doesNotMatch(text, /(?:from\s*|import\s*\(|require\s*\()\s*["'][^"']*backend[\/\\]/, relative(root, path));
      }
    }
  }
  walk(resolve(root, "src")); walk(resolve(root, "shared"));
});

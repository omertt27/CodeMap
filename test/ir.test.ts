import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRepository } from "../src/scanner/repository.js";
import type { ParsedFile } from "../src/languages/ir.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const file = (files: ParsedFile[], p: string) => files.find((f) => f.path === p)!;
const sym = (f: ParsedFile, name: string) => f.symbols.find((s) => s.name === name)!;

test("IR: TS extracts interfaces, enums, methods, fields, variables", async () => {
  const { files } = await parseRepository(path.join(fixtures, "ts-rich"));
  const f = file(files, "animal.ts");
  const kinds = (name: string) => sym(f, name)?.kind;
  assert.equal(kinds("Named"), "interface");
  assert.equal(kinds("Kind"), "enum");
  assert.equal(kinds("Animal"), "class");
  assert.equal(kinds("bark"), "method");
  assert.equal(sym(f, "bark").parent, "Dog");
  assert.equal(kinds("MAX"), "variable");
  assert.equal(kinds("counter"), "variable");
});

test("IR: TS captures extends/implements on a class", async () => {
  const { files } = await parseRepository(path.join(fixtures, "ts-rich"));
  const dog = sym(file(files, "animal.ts"), "Dog");
  assert.deepEqual(dog.extends, ["Animal"]);
  assert.deepEqual(dog.implements, ["Named"]);
});

test("IR: file metadata (size, loc, language) is populated", async () => {
  const { files } = await parseRepository(path.join(fixtures, "ts-rich"));
  const f = file(files, "animal.ts");
  assert.equal(f.language, "typescript");
  assert.ok(f.size > 0);
  assert.ok(f.loc > 5);
});

test("IR: Python captures docstrings, methods, and comments", async () => {
  const { files } = await parseRepository(path.join(fixtures, "py-doc"));
  const f = file(files, "mod.py");
  assert.equal(sym(f, "greet").doc, "Greet docstring.");
  assert.equal(sym(f, "Thing").doc, "Thing docstring.");
  assert.equal(sym(f, "method").kind, "method");
  assert.equal(sym(f, "method").parent, "Thing");
  // Comments are stored but not processed.
  assert.ok(f.comments.some((c) => c.includes("a leading comment")));
});

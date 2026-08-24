import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  CURATED_MEMORY_HOOKS,
  getCuratedMemoryHook,
  normaliseMemoryExpression,
} from "../src/curatedMemoryHooks.js";

const targetPaths = process.argv.slice(2);
if (!targetPaths.length) {
  throw new Error("Usage: node scripts/apply-curated-memory-hooks.mjs <cards.json> [...]");
}

const duplicateHooks = new Map();
for (const [expression, hook] of Object.entries(CURATED_MEMORY_HOOKS)) {
  const expressions = duplicateHooks.get(hook) || [];
  expressions.push(expression);
  duplicateHooks.set(hook, expressions);
}
const collisions = [...duplicateHooks.entries()].filter(([, expressions]) => expressions.length > 1);
if (collisions.length) {
  throw new Error(`Different expressions share a memory hook: ${JSON.stringify(collisions)}`);
}

for (const targetPath of targetPaths) {
  const data = JSON.parse(await readFile(targetPath, "utf8"));
  if (!Array.isArray(data.cards)) throw new Error(`${targetPath} has no cards array`);

  const missing = [...new Set(
    data.cards
      .map((card) => normaliseMemoryExpression(card.expression))
      .filter((expression) => !CURATED_MEMORY_HOOKS[expression]),
  )];
  if (missing.length) {
    throw new Error(`${targetPath} is missing curated hooks for: ${missing.join(", ")}`);
  }

  let changed = 0;
  data.cards = data.cards.map((card) => {
    const memoryHook = getCuratedMemoryHook(card.expression);
    if (card.memoryHook === memoryHook) return card;
    changed += 1;
    return {
      ...card,
      memoryHook,
      contentRevision: (card.contentRevision || 1) + 1,
    };
  });

  if (!changed) {
    process.stdout.write(`${targetPath}: already current\n`);
    continue;
  }

  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temporaryPath, targetPath);
  process.stdout.write(`${targetPath}: updated ${changed} cards\n`);
}

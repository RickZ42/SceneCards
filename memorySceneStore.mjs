import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { sceneSignature, validMemoryScene } from './src/memoryScenes.js';

export function createMemorySceneStore(dataDir) {
  const file = path.join(dataDir, 'memory-scenes-state.json');
  let mutation = Promise.resolve();
  async function read() {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch(error) { if (error.code === 'ENOENT') return { version: 1, queues: {}, scenes: {} }; throw error; }
  }
  function change(callback) {
    const operation = mutation.then(async () => {
      const state = await read();
      const result = callback(state);
      await mkdir(dataDir, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary, file);
      return result;
    });
    mutation = operation.catch(() => {});
    return operation;
  }
  function scope(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid animation collection'); return value; }
  function fail(message) { const error = new Error(message); error.status = 409; throw error; }
  return {
    async queue(collection) {
      const state = await read();
      if (collection) return state.queues[scope(collection)] || null;
      return Object.values(state.queues).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
    },
    async scenes(collection) { return Object.values((await read()).scenes[scope(collection)] || {}); },
    saveQueue(queue) {
      scope(queue.scope);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(queue.date) || !Array.isArray(queue.cards) || queue.cards.length > 30 || new Set(queue.cards.map(c=>c.id)).size !== queue.cards.length) throw new Error('Invalid daily animation queue');
      for (const card of queue.cards) {
        if (typeof card.id !== 'string' || card.id.length > 200 || !card.expression || card.expression.length > 400 || card.signature !== sceneSignature(card) || typeof card.hasAnimation !== 'boolean') throw new Error('Invalid animation card');
      }
      return change(state => {
        state.queues[queue.scope] = { version:1, scope:queue.scope, date:queue.date, updatedAt:new Date().toISOString(), cards:queue.cards.map(c => ({ id:c.id, expression:c.expression, meaning:c.meaning, originalLine:c.originalLine, sceneContext:c.sceneContext, personalExample:c.personalExample, signature:c.signature, hasAnimation:c.hasAnimation })) };
        return { ok:true };
      });
    },
    saveScenes(payload) {
      scope(payload.scope);
      if (!Array.isArray(payload.entries) || payload.entries.length > 30) throw new Error('Expected at most 30 memory scenes');
      return change(state => {
        const queue = state.queues[payload.scope];
        if (!queue || queue.date !== payload.date || Date.now()-Date.parse(queue.updatedAt) > 300000) fail('Refresh the actual SceneCards review page before saving animations.');
        const cards = new Map(queue.cards.map(card => [card.id,card]));
        for (const entry of payload.entries) {
          const card = cards.get(entry.cardId);
          if (!card || entry.signature !== card.signature || !validMemoryScene(entry.scene)) fail('A scene does not match the current card and meaning.');
        }
        const saved = state.scenes[payload.scope] ||= {};
        let added = 0;
        for (const entry of payload.entries) {
          if (cards.get(entry.cardId).hasAnimation || (saved[entry.cardId]?.signature === entry.signature && validMemoryScene(saved[entry.cardId].scene))) continue;
          saved[entry.cardId] = { cardId:entry.cardId, signature:entry.signature, scene:entry.scene };
          added++;
        }
        return { ok:true, added };
      });
    },
  };
}

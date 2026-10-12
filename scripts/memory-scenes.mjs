import { readFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:5173';
async function request(path, options={}) {
  const response = await fetch(origin+path, { ...options, signal:AbortSignal.timeout(10000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `SceneCards returned ${response.status}`);
  return body;
}
const [command='status', file] = process.argv.slice(2);
if (command === 'status') {
  const queue = await request('/api/memory-scenes/queue');
  if (!queue) throw new Error('Open the actual SceneCards review page to refresh today’s queue.');
  if (Date.now()-Date.parse(queue.updatedAt) > 300000) throw new Error('The queue is stale. Refresh the actual SceneCards review page.');
  console.log(JSON.stringify({ ...queue, missing:queue.cards.filter(card=>!card.hasAnimation) },null,2));
} else if (command === 'import' && file) {
  const payload = JSON.parse(await readFile(file,'utf8'));
  console.log(JSON.stringify(await request('/api/memory-scenes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })));
} else throw new Error('Usage: node scripts/memory-scenes.mjs status | import /absolute/path/scenes.json');

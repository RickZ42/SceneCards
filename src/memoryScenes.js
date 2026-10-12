import { sharedMemorySceneForCard } from './sharedMemoryScenes.js';

export const BUILTIN_SCENE_WORDS = new Set('perception rigorous asymmetry precedent xylem derived adequately canonical cluster cognition compatible confronting conservative convention credible exclusive focal gross intervals junction locus patchy perspective severe split streaks substitute tentative turbulent vulnerable'.split(' '));

export function sceneSignature(card) {
  return JSON.stringify([card.expression, card.meaning, card.originalLine, card.sceneContext, card.personalExample].map(value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()));
}

function text(value, limit) { return typeof value === 'string' && value.trim().length > 0 && value.length <= limit; }
const kinds = new Set(['circle', 'rect', 'line', 'text']);
const tones = new Set(['main', 'other', 'neutral', 'line', 'flow']);
const numeric = new Set(['x', 'y', 'width', 'height', 'r', 'x2', 'y2', 'opacity', 'rotation']);

// Only declarative shapes and bounded numeric keyframes; never HTML, scripts or URLs.
export function validMemoryScene(scene) {
  if (!scene || !text(scene.definition, 800) || !text(scene.example, 1200) || !Array.isArray(scene.steps) || scene.steps.length !== 3 || !scene.steps.every(s => text(s, 160))) return false;
  if (scene.kind === 'builtin') return BUILTIN_SCENE_WORDS.has(scene.word);
  if (scene.kind !== 'timeline' || !Array.isArray(scene.elements) || !scene.elements.length || scene.elements.length > 40) return false;
  return scene.elements.every(element => {
    if (!element || !kinds.has(element.type) || !tones.has(element.tone || 'main') || (element.type === 'text' && !text(element.text, 100))) return false;
    if (Object.keys(element).some(k => !['type', 'tone', 'text', 'frames'].includes(k)) || !Array.isArray(element.frames) || element.frames.length < 2 || element.frames.length > 8) return false;
    if (element.frames[0].at !== 0 || element.frames.at(-1).at !== 1) return false;
    let previous = -1;
    const keys = Object.keys(element.frames[0]).sort().join(',');
    const required = { circle:['x','y','r'], rect:['x','y','width','height'], line:['x','y','x2','y2'], text:['x','y'] }[element.type];
    if (!required.every(key => Object.hasOwn(element.frames[0],key))) return false;
    return element.frames.every(frame => {
      if (Object.keys(frame).sort().join(',') !== keys || !Number.isFinite(frame.at) || frame.at <= previous || frame.at > 1) return false;
      previous = frame.at;
      return Object.entries(frame).every(([key, value]) => key === 'at' || (numeric.has(key) && Number.isFinite(value) && Math.abs(value) <= 1000 && (!['r', 'width', 'height'].includes(key) || value >= 0) && (key !== 'opacity' || (value >= 0 && value <= 1))));
    });
  });
}

export function hasMemoryScene(card) {
  return card.memoryScene?.signature === sceneSignature(card) && validMemoryScene(card.memoryScene.scene);
}

export function memorySceneForCard(card) {
  return hasMemoryScene(card) ? card.memoryScene.scene : sharedMemorySceneForCard(card);
}

export function attachMemoryScenes(store, entries, now = new Date().toISOString()) {
  const byId = new Map(entries.map(entry => [entry.cardId, entry]));
  let changed = false;
  const cards = store.cards.map(card => {
    const entry = byId.get(card.id);
    if (hasMemoryScene(card) || !entry || entry.signature !== sceneSignature(card) || !validMemoryScene(entry.scene)) return card;
    changed = true;
    return { ...card, memoryScene: { version: 1, signature: entry.signature, scene: entry.scene, createdAt: now }, contentUpdatedAt: now };
  });
  return changed ? { ...store, cards } : store;
}

export function createAnimationQueue(cards, scope, now = new Date()) {
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return { version: 1, scope, date, cards: cards.slice(0, 30).map(card => ({
    id: card.id, expression: card.expression, meaning: card.meaning || '', originalLine: card.originalLine || '', sceneContext: card.sceneContext || '', personalExample: card.personalExample || '',
    signature: sceneSignature(card), hasAnimation: Boolean(memorySceneForCard(card)),
  })) };
}

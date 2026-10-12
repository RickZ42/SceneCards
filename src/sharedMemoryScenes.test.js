import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedMemoryScenes, sharedMemorySceneForCard } from './sharedMemoryScenes.js';
import { attachMemoryScenes, createAnimationQueue, hasMemoryScene, memorySceneForCard, sceneSignature, validMemoryScene } from './memoryScenes.js';

test('all 30 shared scenes are valid and use only public teaching metadata', () => {
  assert.equal(sharedMemoryScenes.length, 30);
  assert.equal(new Set(sharedMemoryScenes.map(scene => scene.word)).size, 30);
  for (const scene of sharedMemoryScenes) {
    assert.ok(validMemoryScene(scene), scene.word);
    assert.ok(Object.keys(scene).every(key => ['kind', 'word', 'sense', 'definition', 'example', 'steps', 'source'].includes(key)));
  }
});

test('shared scenes select the demonstrated meaning, even with a multi-sense dictionary entry', () => {
  assert.ok(sharedMemorySceneForCard({expression:'CONSERVATIVE', meaning:'traditional; a political party member', originalLine:'She prefers conservative clothes.'}));
  assert.ok(sharedMemorySceneForCard({expression:'intervals', meaning:'time gaps; musical intervals', originalLine:'We meet at regular monthly intervals.'}));
  assert.ok(sharedMemorySceneForCard({expression:'gross', meaning:'total; disgusting', originalLine:'Her gross salary is before tax.'}));
  assert.ok(sharedMemorySceneForCard({expression:'canonical', originalLine:'The church issued a canonical pardon.'}));
  assert.equal(sharedMemorySceneForCard({expression:'canonical', originalLine:'Use a canonical representation in software.'}), null);
  assert.equal(sharedMemorySceneForCard({expression:'gross', originalLine:'That smell is disgusting and gross.'}), null);
  assert.equal(sharedMemorySceneForCard({expression:'intervals', originalLine:'We practised musical intervals.'}), null);
  assert.equal(sharedMemorySceneForCard({expression:'locus', originalLine:'The gene is at this chromosome locus.'}), null);
  assert.equal(sharedMemorySceneForCard({expression:'conservative', originalLine:'The Conservative Party proposed the policy.'}), null);
  assert.equal(sharedMemorySceneForCard({expression:'unknown'}), null);
});

test('viewing shared scenes needs no saved mutation and leaves review state intact', () => {
  const card = {id:'phone-card', expression:'xylem', dueAt:'2026-10-20T12:00:00Z', intervalDays:8, repetitions:4};
  const before = structuredClone(card);
  assert.equal(memorySceneForCard(card).word, 'xylem');
  assert.equal(hasMemoryScene(card), false);
  assert.equal(createAnimationQueue([card], 'phone').cards[0].hasAnimation, true);
  assert.deepEqual(card, before);
});

test('a valid private animation takes precedence over a shared scene; stale meanings do not', () => {
  const card = {id:'custom', expression:'gross', originalLine:'Her gross salary is before tax.'};
  const scene = {...sharedMemoryScenes.find(item => item.word === 'gross'), definition:'A private explanation.'};
  const store = attachMemoryScenes({cards:[card], reviews:[]}, [{cardId:card.id, signature:sceneSignature(card), scene}]);
  assert.strictEqual(memorySceneForCard(store.cards[0]), scene);
  assert.equal(memorySceneForCard({...store.cards[0], originalLine:'That gross smell is disgusting.'}), null);
});

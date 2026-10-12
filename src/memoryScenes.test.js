import assert from 'node:assert/strict';
import test from 'node:test';
import { attachMemoryScenes, createAnimationQueue, hasMemoryScene, sceneSignature, validMemoryScene } from './memoryScenes.js';
import { mergePrivateStores } from './accountSync.js';
import { createDailyPlan } from './dailyPlan.js';

const card = { id:'test',expression:'perception',meaning:'noticing',personalExample:'Her perception is sharp.', dueAt:'2026-10-12T07:00:00Z',intervalDays:5,ease:2.5,repetitions:3,lapses:1,lastReviewedAt:null,reviewQueueOrder:7 };
const scene = { kind:'builtin',word:'perception',definition:'The ability to notice things.',example:'Her perception is sharp.',steps:['Look.','Notice a detail.','Understand.'] };
const entry = { cardId:card.id,signature:sceneSignature(card),scene };

test('attaching a scene preserves schedules, histories, identity, queue and daily allowance',()=>{
  const store = { cards:[card],reviews:[],dismissedCaptureIds:['keep'],deletedCards:{} };
  const before = createDailyPlan(store.cards,store.reviews,new Date('2026-10-12T12:00:00Z'));
  const after = attachMemoryScenes(store,[entry],'2026-10-12T08:00:00Z');
  const { memoryScene,contentUpdatedAt,...rest } = after.cards[0];
  assert.deepEqual(rest,card); assert.strictEqual(after.reviews,store.reviews);
  assert.strictEqual(after.dismissedCaptureIds,store.dismissedCaptureIds);
  const plan = createDailyPlan(after.cards,after.reviews,new Date('2026-10-12T12:00:00Z'));
  assert.deepEqual(plan.queue.map(c=>c.id),before.queue.map(c=>c.id));
  assert.equal(plan.reviewedCount,before.reviewedCount);
  assert.ok(hasMemoryScene(after.cards[0]));
  assert.strictEqual(attachMemoryScenes(after,[entry]),after);
});
test('scenes bind to a specific card and meaning, and do not replace existing ones',()=>{
  const store={cards:[card],reviews:[]};
  assert.strictEqual(attachMemoryScenes(store,[{...entry,signature:'stale'}]),store);
  const attached=attachMemoryScenes(store,[entry]);
  assert.ok(!hasMemoryScene({...attached.cards[0],meaning:'another meaning'}));
  assert.strictEqual(attachMemoryScenes(attached,[{...entry,scene:{...scene,definition:'Replacement'}}]),attached);
});
test('private account merge carries scenes while preserving newer review progress',()=>{
  const local=attachMemoryScenes({cards:[card],reviews:[]},[entry],'2026-10-12T08:00:00Z');
  const remote={cards:[{...card,lastReviewedAt:'2026-10-12T09:00:00Z',dueAt:'2026-10-19T09:00:00Z',intervalDays:7}],reviews:[]};
  const merged=mergePrivateStores(local,remote);
  assert.ok(hasMemoryScene(merged.cards[0]));
  assert.equal(merged.cards[0].dueAt,remote.cards[0].dueAt);
  assert.equal(merged.cards[0].intervalDays,7);
});
test('daily animation snapshot contains no credentials or review history and is capped at 30',()=>{
  const queue=createAnimationQueue(Array.from({length:40},(_,i)=>({...card,id:String(i),token:'secret'})),'local',new Date('2026-10-12T12:00:00Z'));
  assert.equal(queue.cards.length,30); assert.equal(queue.date,'2026-10-12');
  assert.ok(!JSON.stringify(queue).includes('secret'));
});
test('timeline data rejects scripts, extra attributes, non-finite or unbounded coordinates',()=>{
  const timeline={...scene,kind:'timeline',elements:[{type:'circle',tone:'main',frames:[{at:0,x:100,y:100,r:12},{at:1,x:400,y:100,r:12}]}]};
  assert.ok(validMemoryScene(timeline));
  assert.ok(!validMemoryScene({...timeline,elements:[{...timeline.elements[0],onclick:'alert(1)'}]}));
  assert.ok(!validMemoryScene({...timeline,elements:[{type:'script',frames:[]}]}));
  assert.ok(!validMemoryScene({...timeline,elements:[{...timeline.elements[0],frames:[{at:0,x:NaN},{at:1,x:2}]}]}));
  assert.ok(!validMemoryScene({...scene,word:'another-word'}));
});

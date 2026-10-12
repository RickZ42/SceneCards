import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMemorySceneStore } from '../memorySceneStore.mjs';
import { createAnimationQueue } from './memoryScenes.js';

test('scene imports are atomic, idempotent, scoped, and reject changed queues',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'scenecards-scenes-'));
  try {
    const store=createMemorySceneStore(dir);
    const queue=createAnimationQueue([{id:'a',expression:'resilient',meaning:'able to recover'}],'local');
    await store.saveQueue(queue);
    const scene={kind:'timeline',definition:'Able to recover after difficulty.',example:'The plant is resilient.',steps:['Wind bends the plant.','The wind passes.','The plant recovers.'],elements:[{type:'line',tone:'main',frames:[{at:0,x:150,y:180,x2:180,y2:80},{at:1,x:150,y:180,x2:150,y2:80}]}]};
    const payload={scope:'local',date:queue.date,entries:[{cardId:'a',signature:queue.cards[0].signature,scene}]};
    assert.equal((await store.saveScenes(payload)).added,1);
    assert.equal((await store.saveScenes(payload)).added,0);
    assert.equal((await store.scenes('other')).length,0);
    await assert.rejects(store.saveScenes({...payload,date:'2000-01-01'}));
    await assert.rejects(store.saveScenes({...payload,entries:[{...payload.entries[0],signature:'changed'}]}));
    assert.equal((await store.scenes('local')).length,1);
    await Promise.all([store.saveQueue(queue),store.saveScenes(payload)]);
    assert.equal((await store.scenes('local')).length,1);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

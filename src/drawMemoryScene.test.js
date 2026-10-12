import assert from 'node:assert/strict';
import test from 'node:test';
import { drawMemoryScene } from './drawMemoryScene.js';

class Element {
  constructor(tag) { this.tag=tag; this.attributes={}; this.children=[]; this.style={setProperty:()=>{}}; }
  setAttribute(key,value) { this.attributes[key]=String(value); }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children=[]; }
  getComputedTextLength() { return (this.textContent||'').length*6; }
}
test('generated timeline interpolates movement, retains zero sizes, and respects opacity endpoints',()=>{
  const prior=globalThis.document;
  globalThis.document={createElementNS:(_,tag)=>new Element(tag)};
  try {
    const svg=new Element('svg');
    const scene={kind:'timeline',steps:['Before.','Move.','After.'],elements:[
      {type:'circle',tone:'main',frames:[{at:0,x:100,y:120,r:0,opacity:0},{at:1,x:600,y:120,r:20,opacity:1}]},
    ]};
    const circle=()=>svg.children.find(e=>e.tag==='circle');
    drawMemoryScene(svg,scene,0,736,'test-marker');
    assert.equal(circle().attributes.r,'0'); assert.equal(circle().attributes.opacity,'0');
    drawMemoryScene(svg,scene,.5,736,'test-marker');
    assert.equal(circle().attributes.cx,'350'); assert.equal(circle().attributes.r,'10');
    drawMemoryScene(svg,scene,1,736,'test-marker');
    assert.equal(circle().attributes.cx,'600'); assert.equal(circle().attributes.opacity,'1');
    drawMemoryScene(svg,scene,1,320,'test-marker');
    assert.ok(Number(circle().attributes.cx)<320);
  } finally { globalThis.document=prior; }
});

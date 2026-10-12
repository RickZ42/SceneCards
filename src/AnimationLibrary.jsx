import React, { useMemo, useState } from 'react';
import MemoryScene from './MemoryScene.jsx';
import { sharedMemoryScenes } from './sharedMemoryScenes.js';
import { hasMemoryScene } from './memoryScenes.js';

export default function AnimationLibrary({ cards }) {
  const entries = useMemo(() => {
    const shared = new Map(sharedMemoryScenes.map(scene => [scene.word, { key:`shared:${scene.word}`,word:scene.word,scene }]));
    const privateScenes = [];
    for (const card of cards) {
      if (!hasMemoryScene(card)) continue;
      const scene = card.memoryScene.scene;
      const entry = {key:card.id,word:card.expression,scene};
      if (scene.kind === 'builtin' && scene.word === card.expression.trim().toLowerCase()) shared.set(scene.word,entry);
      else privateScenes.push(entry);
    }
    return [...shared.values(), ...privateScenes];
  }, [cards]);
  const [selected, setSelected] = useState('');
  const current = entries.find(entry => entry.key === selected) || entries[0];
  return <section className="animation-library">
    <div className="library-header"><div><span>MEMORY SCENES</span><h1>记忆动画</h1></div><span>{entries.length} 个</span></div>
    <p className="animation-library-note">选择一个词，观看它的含义如何变成画面。观看不会改变复习进度。</p>
    <label className="animation-word-picker">Choose a word
      <select value={current.key} onChange={event => setSelected(event.target.value)}>
        {entries.map(entry => <option key={entry.key} value={entry.key}>{entry.word} · {entry.scene.sense || entry.scene.definition}</option>)}
      </select>
    </label>
    <h2>{current.word}</h2>
    <MemoryScene key={current.key} card={{id:current.key,expression:current.word}} scene={current.scene} initiallyOpened />
  </section>;
}

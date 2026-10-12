import React, { useEffect, useId, useRef, useState } from 'react';
import { memorySceneForCard } from './memoryScenes.js';
import { drawMemoryScene } from './drawMemoryScene.js';

export default function MemoryScene({ card, scene: suppliedScene = null, initiallyOpened = false }) {
  const [opened, setOpened] = useState(initiallyOpened);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const svgRef = useRef(null);
  const marker = `memory-arrow-${useId().replace(/:/g,'')}`;
  const scene = suppliedScene || memorySceneForCard(card);
  useEffect(() => {
    setOpened(initiallyOpened); setPlaying(false); setProgress(0); progressRef.current = 0;
  }, [card.id, scene, initiallyOpened]);
  useEffect(() => {
    if (!opened || !scene || !svgRef.current) return undefined;
    const svg = svgRef.current;
    const paint = () => drawMemoryScene(svg, scene, progress, Math.max(288, svg.getBoundingClientRect().width), marker);
    paint();
    const observer = new ResizeObserver(paint); observer.observe(svg);
    return () => observer.disconnect();
  }, [opened, scene, progress, marker]);
  useEffect(() => {
    if (!playing || !scene) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      progressRef.current = 1; setProgress(1); setPlaying(false); return undefined;
    }
    let frame, start, lastDraw = 0;
    const from = progressRef.current;
    const tick = time => {
      start ??= time;
      const value = Math.min(1, from + (time-start)/4500);
      progressRef.current = value;
      if (time-lastDraw > 40 || value === 1) { setProgress(value); lastDraw=time; }
      if (value === 1) setPlaying(false); else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, scene]);
  if (!scene) return null;
  function play() {
    if (playing) { setPlaying(false); return; }
    if (progressRef.current === 1) { progressRef.current = 0; setProgress(0); }
    setPlaying(true);
  }
  return <section className="memory-scene" aria-label={`Memory animation for ${card.expression}`}>
    <button type="button" className="memory-scene-toggle" aria-expanded={opened} onClick={() => { setOpened(!opened); setPlaying(false); }}>
      {opened ? 'Hide memory animation' : 'Watch memory animation'}
    </button>
    {opened && <div className="memory-scene-content">
      <p className="memory-scene-definition">{scene.definition}</p>
      <svg ref={svgRef} role="img" aria-label={`Animated memory cue: ${card.expression}`} />
      <div className="memory-scene-controls">
        <button type="button" onClick={play}>{playing ? 'Pause' : progress === 1 ? 'Replay' : 'Play'}</button>
        <button type="button" onClick={() => { setPlaying(false); progressRef.current=0; setProgress(0); }}>Restart</button>
        <span>{Math.round(progress*100)}%</span>
      </div>
      <p className="memory-scene-example">{scene.example}</p>
      <small>A visual memory cue. Practise using the word in your own sentence.</small>
    </div>}
  </section>;
}

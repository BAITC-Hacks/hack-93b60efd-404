import { useEffect, useRef, type RefObject } from 'react';
import { CloudCanvas, type Mood } from './CloudCanvas';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'muted';

interface Props {
  state: OrbState;
  levelRef: RefObject<number>;
  label: string;
  onClick: () => void;
}

export function VoiceOrb({ state, levelRef, label, onClick }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const stateRef = useRef(state);
  const intensityRef = useRef(0);
  const moodRef = useRef<Mood>({ think: 0, speak: 0 });
  stateRef.current = state;

  useEffect(() => {
    let raf = 0;
    let cur = 0;
    let size = 0;
    const t0 = performance.now();
    let last = t0;
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      let target: number;
      if (s === 'listening') target = 0.05 + Math.sqrt(Math.min(1, levelRef.current ?? 0)) * 0.85;
      else if (s === 'speaking') target = 0.28 + 0.18 * Math.sin(t * 6.1) * Math.sin(t * 2.3 + 1) + 0.08 * Math.sin(t * 13);
      else if (s === 'thinking') target = 0.12;
      else target = 0.025 * Math.sin(t * 1.3);
      const tau = s === 'listening' ? (target > cur ? 0.09 : 0.28) : 0.15;
      cur += (target - cur) * (1 - Math.exp(-dt / tau));
      intensityRef.current = Math.max(0, cur);

      const ease = 1 - Math.exp(-dt / 0.35);
      const mood = moodRef.current;
      mood.think += ((s === 'thinking' ? 1 : 0) - mood.think) * ease;
      mood.speak += ((s === 'speaking' ? 1 : 0) - mood.speak) * ease;
      size += ((s === 'thinking' ? 0 : cur) - size) * (1 - Math.exp(-dt / 0.2));
      ref.current?.style.setProperty('--lvl', size.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);

  return (
    <button ref={ref} className={`orb orb--${state}`} onClick={onClick} aria-label={label}>
      <CloudCanvas variant="orb" intensityRef={intensityRef} moodRef={moodRef} resolution={0.75} />
    </button>
  );
}

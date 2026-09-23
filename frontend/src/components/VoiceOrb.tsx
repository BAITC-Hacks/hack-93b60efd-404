import { useEffect, useRef, type RefObject } from 'react';
import { CloudCanvas } from './CloudCanvas';

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
  stateRef.current = state;

  useEffect(() => {
    let raf = 0;
    let cur = 0;
    const t0 = performance.now();
    let last = t0;
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      let target: number;
      if (s === 'listening') target = 0.12 + Math.min(1, levelRef.current ?? 0) * 0.45;
      else if (s === 'speaking') target = 0.28 + 0.18 * Math.sin(t * 6.1) * Math.sin(t * 2.3 + 1) + 0.08 * Math.sin(t * 13);
      else if (s === 'thinking') target = 0.3 + 0.05 * Math.sin(t * 3.4);
      else target = 0.025 * Math.sin(t * 1.3);
      const tau = s === 'listening' ? (target > cur ? 0.35 : 0.8) : 0.15;
      cur += (target - cur) * (1 - Math.exp(-dt / tau));
      intensityRef.current = Math.max(0, cur);
      ref.current?.style.setProperty('--lvl', (s === 'thinking' ? cur * 0.25 : cur).toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);

  return (
    <button ref={ref} className={`orb orb--${state}`} onClick={onClick} aria-label={label}>
      <CloudCanvas variant="orb" intensityRef={intensityRef} resolution={0.75} />
    </button>
  );
}

import { useEffect, useRef, type RefObject } from 'react';

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
  stateRef.current = state;

  useEffect(() => {
    let raf = 0;
    let cur = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      const s = stateRef.current;
      let target: number;
      if (s === 'listening') target = levelRef.current ?? 0;
      else if (s === 'speaking') target = 0.28 + 0.18 * Math.sin(t * 6.1) * Math.sin(t * 2.3 + 1) + 0.08 * Math.sin(t * 13);
      else if (s === 'thinking') target = 0.07 + 0.05 * Math.sin(t * 3.4);
      else target = 0.025 * Math.sin(t * 1.3);
      cur += (target - cur) * 0.16;
      ref.current?.style.setProperty('--lvl', cur.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);

  return (
    <button ref={ref} className={`orb orb--${state}`} onClick={onClick} aria-label={label}>
      <span className="orb__sky" />
      <span className="orb__cloud orb__cloud--a" />
      <span className="orb__cloud orb__cloud--b" />
      <span className="orb__cloud orb__cloud--c" />
    </button>
  );
}

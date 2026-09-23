import { useEffect, useState } from 'react';

export const PHONE_W = 390;
export const PHONE_H = 844;
const GAP = 32;

export interface FrameState {
  framed: boolean;
  scale: number;
}

function measure(panelWidth: number): FrameState {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const framed = w >= 760 && h >= 620;
  if (!framed) return { framed, scale: 1 };
  const availW = w - 64 - (panelWidth ? panelWidth + GAP : 0);
  return { framed, scale: Math.max(0.55, Math.min(1, (h - 56) / PHONE_H, availW / PHONE_W)) };
}

export function usePhoneFrame(panelWidth: number): FrameState {
  const [state, setState] = useState(() => measure(panelWidth));
  useEffect(() => {
    const update = () => setState(measure(panelWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [panelWidth]);
  return state;
}

export function StatusBar() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="statusbar" aria-hidden>
      <span className="statusbar__time">{now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="statusbar__island" />
      <span className="statusbar__icons">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
          <path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.3-1.4A10.4 10.4 0 0 0 8 .3 10.4 10.4 0 0 0 .7 3.2L2 4.6a8.4 8.4 0 0 1 6-2.4Zm0 3.8c1.3 0 2.5.5 3.4 1.3l1.3-1.4A7 7 0 0 0 8 4.1a7 7 0 0 0-4.7 1.8l1.3 1.4C5.5 6.5 6.7 6 8 6Zm0 3.7c.5 0 1 .2 1.3.5L8 11.7l-1.3-1.5c.3-.3.8-.5 1.3-.5Z" />
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12" fill="none">
          <rect x="0.5" y="0.5" width="22" height="11" rx="3.2" stroke="currentColor" opacity=".4" />
          <rect x="2" y="2" width="17" height="8" rx="2" fill="currentColor" />
          <path d="M24 4v4c.8-.3 1.3-1.1 1.3-2S24.8 4.3 24 4Z" fill="currentColor" opacity=".45" />
        </svg>
      </span>
    </div>
  );
}

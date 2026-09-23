import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { VoiceState } from '../voice/useVoiceInput';
import { EXAMPLES } from './Chat';
import { IconArrowUp, IconClose, IconMic, IconMicOff, IconPlus, IconStop, IconWaves } from './icons';

interface Props {
  mode: 'voice' | 'chat';
  busy: boolean;
  voiceState: VoiceState;
  interim: string;
  levelRef: RefObject<number>;
  micSupported: boolean;
  muted: boolean;
  session: boolean;
  onSend: (text: string) => void;
  onDictate: () => void;
  onStopDictation: () => void;
  onToggleMute: () => void;
  onStartVoice: () => void;
  onEndVoice: () => void;
}

function Wave({ levelRef }: { levelRef: RefObject<number> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bars = Array.from(ref.current?.children ?? []) as HTMLElement[];
    const hist = new Array(bars.length).fill(0);
    let raf = 0;
    const loop = () => {
      hist.shift();
      hist.push(levelRef.current ?? 0);
      bars.forEach((b, i) => {
        b.style.transform = `scaleY(${0.14 + hist[i] * 0.86})`;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);
  return (
    <div className="wave" ref={ref} aria-hidden>
      {Array.from({ length: 28 }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

export function Composer(p: Props) {
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const send = (t: string) => {
    const v = t.trim();
    if (!v || p.busy) return;
    p.onSend(v);
    setText('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(text);
    }
  };

  const dictating = p.mode === 'chat' && p.voiceState !== 'idle';
  const hasText = text.trim().length > 0;

  return (
    <div className="dock">
      <div className="dock__row">
        <div className={`pill-input ${dictating ? 'is-live' : ''}`}>
          <div className="plus" ref={menuRef}>
            <button className="pill-input__plus" onClick={() => setMenu((v) => !v)} aria-label="Примеры запросов" aria-expanded={menu}>
              <IconPlus width={18} height={18} />
            </button>
            {menu && (
              <div className="menu" role="menu">
                <div className="menu__title">Попробуйте сказать</div>
                {EXAMPLES.map((e) => (
                  <button
                    key={e.text}
                    role="menuitem"
                    className="menu__item"
                    onClick={() => {
                      setMenu(false);
                      send(e.text);
                    }}
                  >
                    <span className="menu__lang">{e.lang}</span>
                    <span>{e.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {dictating ? (
            <div className="pill-input__live">
              <Wave levelRef={p.levelRef} />
              <span>{p.voiceState === 'processing' ? 'Распознаю…' : p.interim || 'Слушаю…'}</span>
            </div>
          ) : (
            <textarea
              ref={taRef}
              rows={1}
              className="pill-input__field"
              placeholder="Спросите агента"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              aria-label="Сообщение агенту"
            />
          )}
        </div>

        {p.mode === 'voice' ? (
          p.session ? (
            <button
              className={`round round--light ${p.muted ? 'is-muted' : ''}`}
              onClick={p.onToggleMute}
              aria-pressed={p.muted}
              aria-label={p.muted ? 'Включить микрофон' : 'Выключить микрофон'}
            >
              {p.muted ? <IconMicOff width={18} height={18} /> : <IconMic width={18} height={18} />}
            </button>
          ) : (
            <button className="round round--accent" onClick={p.onStartVoice} disabled={!p.micSupported} aria-label="Начать говорить">
              <IconMic width={18} height={18} />
            </button>
          )
        ) : dictating ? (
          <button className="round round--light is-rec" onClick={p.onStopDictation} aria-label="Закончить запись">
            <IconStop width={16} height={16} />
          </button>
        ) : (
          <button className="round round--light" onClick={p.onDictate} disabled={!p.micSupported || p.busy} aria-label="Надиктовать">
            <IconMic width={18} height={18} />
          </button>
        )}

        {hasText && !dictating ? (
          <button className="round round--dark" onClick={() => send(text)} disabled={p.busy} aria-label="Отправить">
            <IconArrowUp width={18} height={18} />
          </button>
        ) : p.mode === 'voice' ? (
          <button className="round round--dark" onClick={p.onEndVoice} aria-label="Завершить голосовой режим">
            <IconClose width={18} height={18} />
          </button>
        ) : (
          <button className="round round--dark" onClick={p.onStartVoice} disabled={!p.micSupported} aria-label="Голосовой режим">
            <IconWaves width={18} height={18} />
          </button>
        )}
      </div>
    </div>
  );
}

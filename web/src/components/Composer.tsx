import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { LangHint } from '../api/types';
import type { VoiceState } from '../voice/useVoiceInput';
import { IconArrowUp, IconMic, IconStop } from './icons';

interface Props {
  disabled: boolean;
  voiceState: VoiceState;
  interim: string;
  levelRef: RefObject<number>;
  micSupported: boolean;
  lang: LangHint;
  onLang: (l: LangHint) => void;
  onSend: (text: string) => void;
  onMic: () => void;
  onStopMic: () => void;
}

const LANGS: { id: LangHint; label: string; hint: string }[] = [
  { id: 'auto', label: 'Авто', hint: 'Определять язык автоматически' },
  { id: 'ru', label: 'RU', hint: 'Русский' },
  { id: 'kk', label: 'KZ', hint: 'Қазақша' },
];

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
        b.style.transform = `scaleY(${0.12 + hist[i] * 0.88})`;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);
  return (
    <div className="wave" ref={ref} aria-hidden>
      {Array.from({ length: 36 }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

export function Composer({ disabled, voiceState, interim, levelRef, micSupported, lang, onLang, onSend, onMic, onStopMic }: Props) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const listening = voiceState === 'listening';
  const processing = voiceState === 'processing';

  return (
    <div className="composer-wrap">
      <div className={`composer ${listening ? 'is-listening' : ''}`}>
        {listening || processing ? (
          <div className="composer__live">
            <Wave levelRef={levelRef} />
            <span className="composer__interim">{processing ? 'Распознаю…' : interim || 'Слушаю. Говорите, я сам пойму, когда вы закончите.'}</span>
          </div>
        ) : (
          <textarea
            ref={taRef}
            className="composer__input"
            rows={1}
            placeholder="Напишите вопрос или нажмите на микрофон"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            aria-label="Сообщение роботу"
          />
        )}

        <div className="composer__bar">
          <div className="seg" role="radiogroup" aria-label="Язык распознавания">
            {LANGS.map((l) => (
              <button
                key={l.id}
                role="radio"
                aria-checked={lang === l.id}
                className={lang === l.id ? 'is-on' : ''}
                onClick={() => onLang(l.id)}
                title={l.hint}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="composer__actions">
            {listening ? (
              <button className="iconbtn iconbtn--rec" onClick={onStopMic} aria-label="Закончить запись">
                <IconStop />
              </button>
            ) : (
              <button
                className="iconbtn iconbtn--mic"
                onClick={onMic}
                disabled={!micSupported || disabled || processing}
                aria-label="Говорить"
                title={micSupported ? 'Говорить' : 'Микрофон недоступен в этом браузере'}
              >
                <IconMic />
              </button>
            )}
            <button className="iconbtn iconbtn--send" onClick={submit} disabled={!text.trim() || disabled || listening} aria-label="Отправить">
              <IconArrowUp />
            </button>
          </div>
        </div>
      </div>
      <p className="composer__note">Робот может ошибаться. Когда он не уверен, он переспрашивает или зовёт оператора.</p>
    </div>
  );
}

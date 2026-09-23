import { useEffect, useRef } from 'react';
import type { Message } from '../state/types';
import { ACTION_LABEL, LANG_SHORT, LOW_CONFIDENCE, pct } from '../lib/format';
import { LatencyBar } from './LatencyBar';
import { IconAlert, IconBolt, IconBranch, IconHeadset, IconMic, Logo } from './icons';

export const EXAMPLES = [
  { lang: 'RU', text: 'Здравствуйте, я вчера оплатил полис, деньги списались, а он не активировался… а, и ещё, адрес доставки поменять надо' },
  { lang: 'KZ', text: 'Сәлеметсіз бе, полисті қалай ұзартуға болады?' },
  { lang: 'RU+KZ', text: 'Менің выплата статусы қандай, заявку неделю назад подал' },
  { lang: 'RU', text: 'Хочу расторгнуть полис и вернуть деньги' },
];

export function EmptyState({ onExample }: { onExample: (text: string) => void }) {
  return (
    <div className="empty">
      <h1 className="empty__title">Чем помочь?</h1>
      <p className="empty__lead">Говорите или пишите своими словами, по-русски или по-казахски.</p>
      <div className="empty__examples">
        {EXAMPLES.map((e) => (
          <button key={e.text} className="example" onClick={() => onExample(e.text)}>
            <span className="example__lang">{e.lang}</span>
            <span className="example__text">{e.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface ListProps {
  messages: Message[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onConfirm: (yes: boolean) => void;
  busy: boolean;
}

export function MessageList({ messages, selectedId, onSelect, onConfirm, busy }: ListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, last?.pending]);

  return (
    <div className="thread" role="log" aria-live="polite">
      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="msg msg--user">
            <div className="bubble">
              {m.input === 'voice' && <IconMic className="bubble__icon" width={14} height={14} aria-label="Голосом" />}
              {m.text}
            </div>
          </div>
        ) : (
          <AssistantMessage
            key={m.id}
            m={m}
            selected={m.id === selectedId}
            onSelect={() => onSelect(m.id)}
            onConfirm={m.id === last?.id && !busy ? onConfirm : undefined}
          />
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

function AssistantMessage({
  m,
  selected,
  onSelect,
  onConfirm,
}: {
  m: Message;
  selected: boolean;
  onSelect: () => void;
  onConfirm?: (yes: boolean) => void;
}) {
  const t = m.turn;
  const low = t ? t.scenario.confidence < LOW_CONFIDENCE || t.action === 'clarify' : false;

  return (
    <div className={`msg msg--bot ${selected ? 'is-selected' : ''}`}>
      <div className="msg__avatar">
        <Logo />
      </div>
      <div className="msg__body">
        {m.pending && (
          <div className="thinking">
            <span className="thinking__dots"><i /><i /><i /></span>
            Выбираю сценарий…
          </div>
        )}
        {m.error && (
          <div className="msg__error">
            <IconAlert width={16} height={16} /> {m.error}
          </div>
        )}
        {t && (
          <>
            <p className="msg__text">{m.text}</p>

            {t.action === 'handoff' && (
              <div className="handoff">
                <IconHeadset width={18} height={18} />
                <div>
                  <b>Разговор передан оператору</b>
                  <span>{t.handoff_summary ?? 'Оператор получит транскрипт, сценарий и собранные параметры.'}</span>
                </div>
              </div>
            )}

            {t.action === 'confirm' && onConfirm && (
              <div className="confirm">
                <button className="btn btn--primary" onClick={() => onConfirm(true)}>Подтвердить</button>
                <button className="btn" onClick={() => onConfirm(false)}>Отменить</button>
              </div>
            )}

            <button className="routechip" onClick={onSelect} aria-pressed={selected} title="Открыть трассировку">
              <span className={`routechip__path routechip__path--${t.route_path}`}>
                {t.route_path === 'fast' ? <IconBolt width={13} height={13} /> : <IconBranch width={13} height={13} />}
                {t.route_path === 'fast' ? 'быстрый путь' : 'LLM'}
              </span>
              <span className="routechip__name">{t.scenario.name}</span>
              <span className={`routechip__conf ${low ? 'is-low' : ''}`}>{pct(t.scenario.confidence)}</span>
              {t.action !== 'answer' && <span className="routechip__action">{ACTION_LABEL[t.action]}</span>}
              <span className="routechip__lang">{LANG_SHORT[t.lang]}</span>
              <LatencyBar message={m} compact />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

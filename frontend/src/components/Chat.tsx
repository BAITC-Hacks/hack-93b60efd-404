import { useEffect, useRef } from 'react';
import type { Message } from '../state/types';
import { IconAlert, IconHeadset, IconMic, HalykMark } from './icons';

export const EXAMPLES: { lang: string; text: string; short?: string }[] = [
  { lang: 'RU', text: 'Здравствуйте, я вчера оплатил полис, деньги списались, а он не активировался… а, и ещё, адрес доставки поменять надо', short: 'Оплатил полис, а он не активен' },
  { lang: 'KZ', text: 'Сәлеметсіз бе, полисті қалай ұзартуға болады?', short: 'Полисті қалай ұзартуға болады?' },
  { lang: 'RU+KZ', text: 'Менің выплата статусы қандай, заявку неделю назад подал', short: 'Менің выплата статусы қандай' },
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
  onConfirm: (yes: boolean) => void;
  busy: boolean;
}

export function MessageList({ messages, onConfirm, busy }: ListProps) {
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
          <AssistantMessage key={m.id} m={m} onConfirm={m.id === last?.id && !busy ? onConfirm : undefined} />
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

function AssistantMessage({ m, onConfirm }: { m: Message; onConfirm?: (yes: boolean) => void }) {
  const t = m.turn;
  const handoff = t?.trace.actions.find((action) => action.name === 'transfer_to_operator' && action.status === 'executed');
  const awaitingConfirmation = t?.trace.actions.some((action) => action.status === 'awaiting_confirmation');

  return (
    <div className="msg msg--bot">
      <div className="msg__avatar">
        <HalykMark size={18} />
      </div>
      <div className="msg__body">
        {m.pending && (
          <div className="thinking">
            <span className="thinking__dots"><i /><i /><i /></span>
            Разбираюсь в вопросе…
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

            {handoff && (
              <div className="handoff">
                <IconHeadset width={18} height={18} />
                <div>
                  <b>Запрос записан для оператора</b>
                  <span>Это локальная очередь. Живое соединение с оператором не подключено.</span>
                </div>
              </div>
            )}

            {awaitingConfirmation && onConfirm && (
              <div className="confirm">
                <button className="btn btn--primary" onClick={() => onConfirm(true)}>Подтвердить</button>
                <button className="btn" onClick={() => onConfirm(false)}>Отменить</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

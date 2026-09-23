import { useEffect, useRef, useState } from 'react';
import type { Message, Review } from '../state/types';
import { E2E_TARGET_MS, LANG_LABEL, ROUTE_TARGET_MS, ms, plural } from '../lib/format';
import { LatencyBar } from './LatencyBar';
import { RouteChip } from './RouteChip';
import { HalykMark, IconCheck, IconClose, IconMic } from './icons';

interface Props {
  messages: Message[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onReview: (id: string, review: Review | undefined) => void;
}

interface Turn { bot: Message; user: Message | null }

function toTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  let user: Message | null = null;
  for (const message of messages) {
    if (message.role === 'user') user = message;
    else {
      turns.push({ bot: message, user });
      user = null;
    }
  }
  return turns;
}

export function TracePanel({ messages, selectedId, onSelect, onClose, onReview }: Props) {
  const turns = toTurns(messages);
  const [openId, setOpenId] = useState<string | null>(selectedId);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => setOpenId(selectedId), [selectedId]);
  useEffect(() => {
    if (!openId) return;
    bodyRef.current?.querySelector<HTMLElement>('[data-turn="' + openId + '"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openId, turns.length]);
  const done = turns.filter(({ bot }) => bot.text && !bot.pending).length;

  return (
    <aside className="trace" aria-label="Трассировка">
      <button className="sheet-grip" onClick={onClose} tabIndex={-1} aria-hidden />
      <header className="trace__head">
        <div>
          <div className="trace__title">Трассировка</div>
          {turns.length > 0 && <div className="trace__eyebrow">{plural(done, 'реплика', 'реплики', 'реплик')}</div>}
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Скрыть трассировку"><IconClose /></button>
      </header>
      {!turns.length ? (
        <p className="trace__empty">После первой реплики здесь появятся выбранный сценарий, обоснование и время каждого этапа.</p>
      ) : (
        <div className="trace__body tfeed" ref={bodyRef}>
          {turns.map(({ bot, user }) => {
            const open = openId === bot.id;
            return (
              <div key={bot.id} className={'tturn ' + (open ? 'is-open' : '')} data-turn={bot.id}>
                {user && <div className="tturn__user"><span className="bubble">
                  {user.input === 'voice' && <IconMic className="bubble__icon" width={13} height={13} aria-label="Голосом" />}
                  {user.text}
                </span></div>}
                <div className="tturn__bot">
                  <span className="msg__avatar"><HalykMark size={16} /></span>
                  <div className="tturn__main">
                    {bot.pending && <div className="thinking"><span className="thinking__dots"><i /><i /><i /></span>Обрабатываю…</div>}
                    {bot.error && <p className="msg__error">{bot.error}</p>}
                    {bot.turn ? <>
                      <p className={'tturn__text ' + (open ? '' : 'is-clamped')}>{bot.text}</p>
                      <RouteChip m={bot} selected={open} title={open ? 'Свернуть' : 'Подробнее'}
                        onClick={() => { setOpenId(open ? null : bot.id); if (!open) onSelect(bot.id); }} />
                    </> : bot.text && !bot.pending ? <>
                      <p className="tturn__text">{bot.text}</p>
                      <span className="routechip__path routechip__path--llm">Свободный разговор · Gemini Live</span>
                    </> : null}
                  </div>
                </div>
                {open && bot.turn && <TurnDetails message={bot} onReview={(review) => onReview(bot.id, review)} />}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function TurnDetails({ message, onReview }: { message: Message; onReview: (review: Review | undefined) => void }) {
  const turn = message.turn!;
  const trace = turn.trace;
  const [correct, setCorrect] = useState(message.review?.correct_scenario ?? '');
  return (
    <div className="tdetails">
      <section className="tsec">
        <h3>Выбранный сценарий</h3>
        {turn.route_details.map((route) => (
          <div className="picked" key={route.id}>
            <div className="picked__row"><code>{route.id}</code><b>{route.name}</b></div>
          </div>
        ))}
        <div className="kv">
          <span>Язык ответа</span><b>{LANG_LABEL[turn.language]}</b>
          <span>Модель</span><b>{trace.model}</b>
          <span>Продолжение темы</span><b>{trace.is_continuation ? 'Да' : 'Нет'}</b>
          <span>Повторная проверка</span><b>{trace.ambiguity_reviewed ? 'Да' : 'Нет'}</b>
        </div>
      </section>
      <section className="tsec"><h3>Почему</h3><p className="reason">{trace.reason}</p></section>
      {trace.alternative_details.length > 0 && <section className="tsec">
        <h3>Альтернативы</h3>
        <ul className="alts">{trace.alternative_details.map((route) =>
          <li key={route.id}><code>{route.id}</code> {route.name}</li>)}</ul>
      </section>}
      {(turn.active_scenario || turn.pending_scenarios.length > 0) && <section className="tsec">
        <h3>Контекст</h3>
        {turn.active_scenario && <p className="note">Активный сценарий: <code>{turn.active_scenario}</code></p>}
        {turn.pending_scenarios.length > 0 && <div className="stack">
          <span>Отложенные темы:</span>
          {turn.pending_scenarios.map((id) => <code key={id}>{id}</code>)}
        </div>}
      </section>}
      {trace.actions.length > 0 && <section className="tsec">
        <h3>Действия</h3>
        <div className="kv kv--params">{trace.actions.map((action, index) =>
          <div key={index}><span>{action.name ?? 'Действие'}</span> <b>{action.status ?? '—'}</b></div>)}</div>
      </section>}
      <section className="tsec">
        <h3>Задержка по этапам</h3>
        <LatencyBar message={message} />
        <div className="targets">
          <Target label="Выбор сценария" value={trace.router_ms} target={ROUTE_TARGET_MS} />
          <Target label="Конец реплики → голос" value={message.client?.e2e_ms} target={E2E_TARGET_MS} />
        </div>
      </section>
      <section className="tsec">
        <h3>Оценка супервизора</h3>
        <div className="review">
          <button className={'btn ' + (message.review?.verdict === 'ok' ? 'btn--ok' : '')}
            onClick={() => onReview(message.review?.verdict === 'ok' ? undefined : { verdict: 'ok' })}>
            <IconCheck width={16} height={16} /> Сценарий верный
          </button>
          <button className={'btn ' + (message.review?.verdict === 'wrong' ? 'btn--bad' : '')}
            onClick={() => onReview(message.review?.verdict === 'wrong' ? undefined : { verdict: 'wrong', correct_scenario: correct || undefined })}>
            <IconClose width={16} height={16} /> Сценарий неверный
          </button>
        </div>
        {message.review?.verdict === 'wrong' && <label className="field">
          <span>Какой сценарий был нужен</span>
          <input value={correct} onChange={(event) => setCorrect(event.target.value)}
            onBlur={() => onReview({ verdict: 'wrong', correct_scenario: correct.trim() || undefined })} />
        </label>}
      </section>
      <details className="raw"><summary>Ответ сервера (JSON)</summary><pre>{JSON.stringify(turn, null, 2)}</pre></details>
    </div>
  );
}

function Target({ label, value, target }: { label: string; value?: number; target: number }) {
  const okay = value != null && value <= target;
  return <div className={'target ' + (value == null ? '' : okay ? 'is-ok' : 'is-warn')}>
    <span>{label}</span><b>{ms(value)}</b><small>ориентир {ms(target)}</small>
  </div>;
}

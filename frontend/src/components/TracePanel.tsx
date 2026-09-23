import { useEffect, useRef, useState } from 'react';
import type { Message, Review } from '../state/types';
import { E2E_TARGET_MS, LANG_LABEL, LOW_CONFIDENCE, ROUTE_TARGET_MS, ms, pct, plural } from '../lib/format';
import { LatencyBar } from './LatencyBar';
import { RouteChip } from './RouteChip';
import { HalykMark, IconCheck, IconClose, IconMic } from './icons';

interface Props {
  messages: Message[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onReview: (id: string, r: Review | undefined) => void;
}

interface Turn {
  bot: Message;
  user: Message | null;
}

function toTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  let user: Message | null = null;
  for (const m of messages) {
    if (m.role === 'user') user = m;
    else {
      turns.push({ bot: m, user });
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
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-turn="${openId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openId, turns.length]);

  const done = turns.filter((x) => x.bot.turn).length;

  return (
    <aside className="trace" aria-label="Трассировка">
      <button className="sheet-grip" onClick={onClose} tabIndex={-1} aria-hidden />
      <header className="trace__head">
        <div>
          <div className="trace__title">Трассировка</div>
          {turns.length > 0 && <div className="trace__eyebrow">{plural(done, 'реплика', 'реплики', 'реплик')}</div>}
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Скрыть трассировку">
          <IconClose />
        </button>
      </header>

      {!turns.length ? (
        <p className="trace__empty">
          Скажите роботу первую фразу. Здесь появится сценарий, который он выбрал, почему он так решил и сколько занял каждый этап.
        </p>
      ) : (
        <div className="trace__body tfeed" ref={bodyRef}>
          {turns.map(({ bot, user }) => {
            const open = openId === bot.id;
            return (
              <div key={bot.id} className={`tturn ${open ? 'is-open' : ''}`} data-turn={bot.id}>
                {user && (
                  <div className="tturn__user">
                    <span className="bubble">
                      {user.input === 'voice' && <IconMic className="bubble__icon" width={13} height={13} aria-label="Голосом" />}
                      {user.text}
                    </span>
                  </div>
                )}
                <div className="tturn__bot">
                  <span className="msg__avatar">
                    <HalykMark size={16} />
                  </span>
                  <div className="tturn__main">
                    {bot.pending && (
                      <div className="thinking">
                        <span className="thinking__dots"><i /><i /><i /></span>
                        Выбираю сценарий…
                      </div>
                    )}
                    {bot.error && <p className="msg__error">{bot.error}</p>}
                    {bot.turn && (
                      <>
                        <p className={`tturn__text ${open ? '' : 'is-clamped'}`}>{bot.text}</p>
                        <RouteChip
                          m={bot}
                          selected={open}
                          title={open ? 'Свернуть подробности' : 'Показать подробности'}
                          onClick={() => {
                            if (open) setOpenId(null);
                            else {
                              setOpenId(bot.id);
                              onSelect(bot.id);
                            }
                          }}
                        />
                      </>
                    )}
                  </div>
                </div>
                {open && bot.turn && <TurnDetails key={bot.id} m={bot} onReview={(r) => onReview(bot.id, r)} />}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function Bar({ value, tone }: { value: number; tone?: 'low' | 'main' }) {
  return (
    <span className={`cbar ${tone ? `cbar--${tone}` : ''}`}>
      <span style={{ width: `${Math.max(2, value * 100)}%` }} />
    </span>
  );
}

function TurnDetails({ m, onReview }: { m: Message; onReview: (r: Review | undefined) => void }) {
  const t = m.turn!;
  const [correct, setCorrect] = useState(m.review?.correct_scenario ?? '');
  const low = t.scenario.confidence < LOW_CONFIDENCE;

  return (
    <div className="tdetails">
      <section className="tsec">
        <h3>Выбранный сценарий</h3>
        <div className="picked">
          <div className="picked__row">
            <code>{t.scenario.id}</code>
            <span className={`picked__conf ${low ? 'is-low' : ''}`}>{pct(t.scenario.confidence)}</span>
          </div>
          <Bar value={t.scenario.confidence} tone={low ? 'low' : 'main'} />
        </div>
        <div className="kv">
          <span>Язык</span>
          <b>{LANG_LABEL[t.lang]}</b>
          {t.emotion && (
            <>
              <span>Тон клиента</span>
              <b>{t.emotion}</b>
            </>
          )}
        </div>
        {low && <p className="note note--warn">Робот не уверен в выборе, поэтому переспрашивает клиента, а не угадывает.</p>}
        {m.source === 'mock' && (
          <p className="note">Сервер недоступен, ответ дала заглушка по ключевым словам. Качество маршрутизации по ней не оценивайте.</p>
        )}
      </section>

      <section className="tsec">
        <h3>Почему</h3>
        <p className="reason">{t.reasoning}</p>
      </section>

      {t.alternatives.length > 0 && (
        <section className="tsec">
          <h3>Альтернативы</h3>
          <ul className="alts">
            {t.alternatives.map((a) => (
              <li key={a.id}>
                <div className="alts__row">
                  <span>{a.name}</span>
                  <b>{pct(a.confidence)}</b>
                </div>
                <Bar value={a.confidence} />
                {a.why_not && <p>{a.why_not}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(Object.keys(t.params).length > 0 || (t.topic_stack?.length ?? 0) > 0 || t.resumed_from) && (
        <section className="tsec">
          <h3>Контекст и параметры</h3>
          {Object.keys(t.params).length > 0 && (
            <div className="kv kv--params">
              {Object.entries(t.params).map(([k, v]) => (
                <FragmentKV key={k} k={k} v={v == null ? '—' : String(v)} />
              ))}
            </div>
          )}
          {t.resumed_from && (
            <p className="note">Вернулся к прерванной теме после <code>{t.resumed_from}</code>.</p>
          )}
          {(t.topic_stack?.length ?? 0) > 0 && (
            <div className="stack">
              <span>Отложенные темы:</span>
              {t.topic_stack!.map((s) => (
                <code key={s}>{s}</code>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="tsec">
        <h3>Задержка по этапам</h3>
        <LatencyBar message={m} />
        <div className="targets">
          <Target label="Выбор сценария" value={t.timings.route_ms} target={ROUTE_TARGET_MS} />
          <Target label="От конца фразы до голоса" value={m.client?.e2e_ms} target={E2E_TARGET_MS} />
        </div>
      </section>

      <section className="tsec">
        <h3>Оценка супервизора</h3>
        <div className="review">
          <button
            className={`btn ${m.review?.verdict === 'ok' ? 'btn--ok' : ''}`}
            onClick={() => onReview(m.review?.verdict === 'ok' ? undefined : { verdict: 'ok' })}
          >
            <IconCheck width={16} height={16} /> Сценарий верный
          </button>
          <button
            className={`btn ${m.review?.verdict === 'wrong' ? 'btn--bad' : ''}`}
            onClick={() => onReview(m.review?.verdict === 'wrong' ? undefined : { verdict: 'wrong', correct_scenario: correct || undefined })}
          >
            <IconClose width={16} height={16} /> Сценарий неверный
          </button>
        </div>
        {m.review?.verdict === 'wrong' && (
          <label className="field">
            <span>Какой сценарий был нужен</span>
            <input
              value={correct}
              placeholder="например, claim_status"
              onChange={(e) => setCorrect(e.target.value)}
              onBlur={() => onReview({ verdict: 'wrong', correct_scenario: correct.trim() || undefined })}
            />
          </label>
        )}
      </section>

      <details className="raw">
        <summary>Ответ сервера (JSON)</summary>
        <pre>{JSON.stringify({ ...t, audio_b64: t.audio_b64 ? '…' : t.audio_b64 }, null, 2)}</pre>
      </details>
    </div>
  );
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span>{k}</span>
      <b>{v}</b>
    </>
  );
}

function Target({ label, value, target }: { label: string; value?: number; target: number }) {
  const ok = value != null && value <= target;
  return (
    <div className={`target ${value == null ? '' : ok ? 'is-ok' : 'is-warn'}`}>
      <span>{label}</span>
      <b>{ms(value)}</b>
      <small>ориентир {ms(target)}</small>
    </div>
  );
}

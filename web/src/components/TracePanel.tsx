import { useEffect, useState } from 'react';
import type { Message, Review } from '../state/types';
import { ACTION_LABEL, E2E_TARGET_MS, LANG_LABEL, LOW_CONFIDENCE, ROUTE_TARGET_MS, ms, pct } from '../lib/format';
import { LatencyBar } from './LatencyBar';
import { IconBolt, IconBranch, IconCheck, IconClose, IconMic } from './icons';

interface Props {
  message: Message | null;
  userMessage: Message | null;
  turnNo: number;
  onClose: () => void;
  onReview: (r: Review | undefined) => void;
}

function Bar({ value, tone }: { value: number; tone?: 'low' | 'main' }) {
  return (
    <span className={`cbar ${tone ? `cbar--${tone}` : ''}`}>
      <span style={{ width: `${Math.max(2, value * 100)}%` }} />
    </span>
  );
}

export function TracePanel({ message, userMessage, turnNo, onClose, onReview }: Props) {
  const t = message?.turn;
  const [correct, setCorrect] = useState('');
  useEffect(() => setCorrect(message?.review?.correct_scenario ?? ''), [message?.id, message?.review?.correct_scenario]);

  return (
    <aside className="trace" aria-label="Трассировка">
      <header className="trace__head">
        <div>
          <div className="trace__eyebrow">Трассировка</div>
          <div className="trace__title">{t ? `Реплика ${turnNo}` : 'Нет данных'}</div>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Скрыть трассировку">
          <IconClose />
        </button>
      </header>

      {!t ? (
        <p className="trace__empty">
          После каждой реплики здесь видно, какой сценарий выбрал робот, почему, какие были альтернативы и сколько времени занял каждый этап.
        </p>
      ) : (
        <div className="trace__body">
          <section className="tsec">
            <h3>Клиент сказал</h3>
            <blockquote className="quote">
              {userMessage?.input === 'voice' && <IconMic width={14} height={14} />}
              {userMessage?.text}
            </blockquote>
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
          </section>

          <section className="tsec">
            <h3>Выбранный сценарий</h3>
            <div className="picked">
              <div className="picked__row">
                <span className="picked__name">{t.scenario.name}</span>
                <span className={`picked__conf ${t.scenario.confidence < LOW_CONFIDENCE ? 'is-low' : ''}`}>{pct(t.scenario.confidence)}</span>
              </div>
              <Bar value={t.scenario.confidence} tone={t.scenario.confidence < LOW_CONFIDENCE ? 'low' : 'main'} />
              <div className="picked__tags">
                <code>{t.scenario.id}</code>
                <span className={`tag tag--${t.route_path}`}>
                  {t.route_path === 'fast' ? <IconBolt width={12} height={12} /> : <IconBranch width={12} height={12} />}
                  {t.route_path === 'fast' ? 'Быстрый путь' : 'LLM-маршрутизатор'}
                </span>
                <span className={`tag tag--${t.action}`}>{ACTION_LABEL[t.action]}</span>
              </div>
            </div>
            {t.scenario.confidence < LOW_CONFIDENCE && (
              <p className="note note--warn">Робот не уверен в выборе, поэтому переспрашивает клиента, а не угадывает.</p>
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
                <div className="kv">
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
            <LatencyBar message={message!} />
            <div className="targets">
              <Target label="Выбор сценария" value={t.timings.route_ms} target={ROUTE_TARGET_MS} />
              <Target label="Конец реплики → голос" value={message!.client?.e2e_ms} target={E2E_TARGET_MS} />
            </div>
          </section>

          <section className="tsec">
            <h3>Оценка супервизора</h3>
            <div className="review">
              <button
                className={`btn ${message!.review?.verdict === 'ok' ? 'btn--ok' : ''}`}
                onClick={() => onReview(message!.review?.verdict === 'ok' ? undefined : { verdict: 'ok' })}
              >
                <IconCheck width={16} height={16} /> Сценарий верный
              </button>
              <button
                className={`btn ${message!.review?.verdict === 'wrong' ? 'btn--bad' : ''}`}
                onClick={() => onReview(message!.review?.verdict === 'wrong' ? undefined : { verdict: 'wrong', correct_scenario: correct || undefined })}
              >
                <IconClose width={16} height={16} /> Ошибка
              </button>
            </div>
            {message!.review?.verdict === 'wrong' && (
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
      )}
    </aside>
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

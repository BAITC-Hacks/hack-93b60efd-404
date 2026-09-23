import { useMemo } from 'react';
import type { Conversation, Message } from '../state/types';
import { ACTION_LABEL, E2E_TARGET_MS, LOW_CONFIDENCE, ROUTE_TARGET_MS, ms, pct, plural, quantile } from '../lib/format';

interface Row {
  conv: Conversation;
  msg: Message;
  user?: Message;
}

interface Props {
  conversations: Conversation[];
  onOpen: (convId: string, msgId: string) => void;
  onClearAll: () => void;
}

export function Supervisor({ conversations, onOpen, onClearAll }: Props) {
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const conv of conversations) {
      conv.messages.forEach((msg, i) => {
        if (msg.role === 'assistant' && msg.turn) {
          const user = conv.messages.slice(0, i).reverse().find((m) => m.role === 'user');
          out.push({ conv, msg, user });
        }
      });
    }
    return out.sort((a, b) => b.msg.createdAt - a.msg.createdAt);
  }, [conversations]);

  const s = useMemo(() => {
    const route = rows.map((r) => r.msg.turn!.timings.route_ms);
    const e2e = rows.map((r) => r.msg.client?.e2e_ms).filter((v): v is number => v != null);
    const reviewed = rows.filter((r) => r.msg.review);
    const wrong = reviewed.filter((r) => r.msg.review!.verdict === 'wrong');
    const fast = rows.filter((r) => r.msg.turn!.route_path === 'fast');
    const fastRoute = fast.map((r) => r.msg.turn!.timings.route_ms);
    const llmRoute = rows.filter((r) => r.msg.turn!.route_path === 'llm').map((r) => r.msg.turn!.timings.route_ms);
    const byScenario = new Map<string, { name: string; n: number; conf: number; wrong: number }>();
    for (const r of rows) {
      const sc = r.msg.turn!.scenario;
      const cur = byScenario.get(sc.id) ?? { name: sc.name, n: 0, conf: 0, wrong: 0 };
      cur.n += 1;
      cur.conf += sc.confidence;
      if (r.msg.review?.verdict === 'wrong') cur.wrong += 1;
      byScenario.set(sc.id, cur);
    }
    return {
      turns: rows.length,
      accuracy: reviewed.length ? (reviewed.length - wrong.length) / reviewed.length : undefined,
      reviewed: reviewed.length,
      fastShare: rows.length ? fast.length / rows.length : 0,
      routeP50: quantile(route, 0.5),
      routeP95: quantile(route, 0.95),
      routeUnder: route.length ? route.filter((v) => v <= ROUTE_TARGET_MS).length / route.length : undefined,
      fastP50: quantile(fastRoute, 0.5),
      llmP50: quantile(llmRoute, 0.5),
      e2eP50: quantile(e2e, 0.5),
      e2eUnder: e2e.length ? e2e.filter((v) => v <= E2E_TARGET_MS).length / e2e.length : undefined,
      clarify: rows.filter((r) => r.msg.turn!.action === 'clarify').length,
      handoff: rows.filter((r) => r.msg.turn!.action === 'handoff').length,
      scenarios: [...byScenario.entries()].sort((a, b) => b[1].n - a[1].n),
      doubtful: rows.filter(
        (r) => r.msg.review?.verdict === 'wrong' || r.msg.turn!.scenario.confidence < LOW_CONFIDENCE || r.msg.turn!.action !== 'answer',
      ),
    };
  }, [rows]);

  if (!rows.length) {
    return (
      <div className="sup sup--empty">
        <h1>Панель супервизора</h1>
        <p>Статистика появится после первых разговоров: какие сценарии выбирал агент, где сомневался, где ошибся и уложился ли во время.</p>
      </div>
    );
  }

  const maxN = s.scenarios[0]?.[1].n ?? 1;

  return (
    <div className="sup">
      <header className="sup__head">
        <div>
          <h1>Панель супервизора</h1>
          <p>
            {plural(rows.length, 'ответ', 'ответа', 'ответов')} агента, {plural(conversations.length, 'разговор', 'разговора', 'разговоров')}. Данные хранятся в этом браузере.
          </p>
        </div>
        <button className="btn" onClick={() => confirm('Удалить все разговоры и статистику?') && onClearAll()}>
          Очистить историю
        </button>
      </header>

      <div className="metrics">
        <Metric label="Точность по оценкам" value={s.accuracy == null ? '—' : pct(s.accuracy)} sub={`оценено ${s.reviewed} из ${s.turns}`} />
        <Metric
          label="Выбор сценария, медиана"
          value={ms(s.routeP50)}
          sub={`p95 ${ms(s.routeP95)} · до 500 мс: ${s.routeUnder == null ? '—' : pct(s.routeUnder)}`}
          tone={s.routeP50 != null && s.routeP50 <= ROUTE_TARGET_MS ? 'ok' : 'warn'}
        />
        <Metric
          label="Конец реплики → голос"
          value={ms(s.e2eP50)}
          sub={`до 1,5 с: ${s.e2eUnder == null ? '—' : pct(s.e2eUnder)}`}
          tone={s.e2eP50 == null ? undefined : s.e2eP50 <= E2E_TARGET_MS ? 'ok' : 'warn'}
        />
        <Metric label="Быстрый путь" value={pct(s.fastShare)} sub={`медиана ${ms(s.fastP50)} против ${ms(s.llmP50)} у LLM`} />
        <Metric label="Уточнения" value={String(s.clarify)} sub="агент переспросил вместо догадки" />
        <Metric label="Передачи оператору" value={String(s.handoff)} sub="с транскриптом и параметрами" />
      </div>

      <div className="sup__grid">
        <section className="card">
          <h2>Сценарии</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Сценарий</th>
                <th>Реплик</th>
                <th>Ср. уверенность</th>
                <th>Ошибок</th>
              </tr>
            </thead>
            <tbody>
              {s.scenarios.map(([id, v]) => (
                <tr key={id}>
                  <td>
                    <div className="tbl__name">{v.name}</div>
                    <div className="tbl__bar"><span style={{ width: `${(v.n / maxN) * 100}%` }} /></div>
                  </td>
                  <td className="num">{v.n}</td>
                  <td className="num">{pct(v.conf / v.n)}</td>
                  <td className={`num ${v.wrong ? 'bad' : ''}`}>{v.wrong || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Где агент сомневался или ошибся</h2>
          {s.doubtful.length === 0 ? (
            <p className="muted">Пока всё уверенно. Отметьте ошибку в трассировке реплики, и она появится здесь.</p>
          ) : (
            <ul className="doubts">
              {s.doubtful.slice(0, 30).map((r) => {
                const t = r.msg.turn!;
                return (
                  <li key={r.msg.id}>
                    <button onClick={() => onOpen(r.conv.id, r.msg.id)}>
                      <span className="doubts__quote">«{r.user?.text}»</span>
                      <span className="doubts__meta">
                        {r.msg.review?.verdict === 'wrong' && <b className="bad">ошибка{r.msg.review.correct_scenario ? ` → ${r.msg.review.correct_scenario}` : ''}</b>}
                        <span>{t.scenario.name}</span>
                        <span className={t.scenario.confidence < LOW_CONFIDENCE ? 'warn' : ''}>{pct(t.scenario.confidence)}</span>
                        {t.action !== 'answer' && <span>{ACTION_LABEL[t.action]}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className={`metric ${tone ? `metric--${tone}` : ''}`}>
      <span className="metric__label">{label}</span>
      <b className="metric__value">{value}</b>
      <span className="metric__sub">{sub}</span>
    </div>
  );
}

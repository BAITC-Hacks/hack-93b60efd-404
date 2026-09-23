import { useMemo } from 'react';
import type { Conversation, Message } from '../state/types';
import { E2E_TARGET_MS, ROUTE_TARGET_MS, ms, pct, plural, quantile } from '../lib/format';

interface Row { conv: Conversation; msg: Message; user?: Message }
interface Props {
  conversations: Conversation[];
  onOpen: (convId: string, msgId: string) => void;
  onClearAll: () => void;
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="metric">
    <span className="metric__label">{label}</span>
    <b className="metric__value">{value}</b>
    <span className="metric__sub">{sub}</span>
  </div>;
}

export function Supervisor({ conversations, onOpen, onClearAll }: Props) {
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    for (const conv of conversations) {
      conv.messages.forEach((msg, index) => {
        if (msg.role === 'assistant' && msg.turn) {
          const user = conv.messages.slice(0, index).reverse().find((candidate) => candidate.role === 'user');
          result.push({ conv, msg, user });
        }
      });
    }
    return result.sort((a, b) => b.msg.createdAt - a.msg.createdAt);
  }, [conversations]);

  const reviewed = rows.filter((row) => row.msg.review);
  const correct = reviewed.filter((row) => row.msg.review?.verdict === 'ok').length;
  const routeTimes = rows.map((row) => row.msg.turn!.trace.router_ms);
  const voiceTimes = rows.map((row) => row.msg.client?.e2e_ms).filter((time): time is number => time != null);
  const handoffs = rows.filter((row) => row.msg.turn!.trace.actions.some(
    (action) => action.name === 'transfer_to_operator' && action.status === 'executed',
  )).length;
  const reviewedByModel = rows.filter((row) => row.msg.turn!.trace.ambiguity_reviewed).length;
  const byScenario = new Map<string, { name: string; count: number; wrong: number }>();
  for (const row of rows) {
    for (const route of row.msg.turn!.route_details) {
      const value = byScenario.get(route.id) ?? { name: route.name, count: 0, wrong: 0 };
      value.count += 1;
      if (row.msg.review?.verdict === 'wrong') value.wrong += 1;
      byScenario.set(route.id, value);
    }
  }
  const scenarios = [...byScenario.entries()].sort((a, b) => b[1].count - a[1].count);
  const maxCount = scenarios[0]?.[1].count ?? 1;
  const inspect = rows.filter((row) =>
    row.msg.review?.verdict === 'wrong'
    || row.msg.turn!.trace.ambiguity_reviewed
    || row.msg.turn!.route.some((id) => id.startsWith('SYS_'))
    || row.msg.turn!.trace.actions.some((action) => action.status === 'error' || action.status === 'denied'));

  if (!rows.length) return <div className="sup sup--empty">
    <h1>Панель супервизора</h1>
    <p>После реального разговора здесь появятся маршруты, задержки и реплики для проверки.</p>
  </div>;

  return <div className="sup">
    <header className="sup__head">
      <div>
        <h1>Панель супервизора</h1>
        <p>{plural(rows.length, 'ответ', 'ответа', 'ответов')} · данные этого браузера</p>
      </div>
      <button className="btn" onClick={() => confirm('Удалить историю в этом браузере?') && onClearAll()}>
        Очистить историю
      </button>
    </header>
    <div className="metrics">
      <Metric label="Точность по ручным оценкам" value={reviewed.length ? pct(correct / reviewed.length) : '—'}
        sub={'Оценено ' + reviewed.length + ' из ' + rows.length} />
      <Metric label="Выбор сценария" value={ms(quantile(routeTimes, 0.5))}
        sub={'p95 ' + ms(quantile(routeTimes, 0.95)) + ' · ориентир ' + ms(ROUTE_TARGET_MS)} />
      <Metric label="Конец реплики → голос" value={ms(quantile(voiceTimes, 0.5))}
        sub={'Измерено ' + voiceTimes.length + ' · ориентир ' + ms(E2E_TARGET_MS)} />
      <Metric label="Повторная проверка маршрута" value={String(reviewedByModel)}
        sub="Дополнительный проход модели при неоднозначности" />
      <Metric label="Локальные запросы оператору" value={String(handoffs)}
        sub="Живое соединение не подключено" />
    </div>
    <div className="sup__grid">
      <section className="card">
        <h2>Сценарии</h2>
        <table className="tbl"><thead><tr>
          <th>Сценарий</th><th>Реплик</th><th>Ошибок по оценке</th>
        </tr></thead><tbody>
          {scenarios.map(([id, value]) => <tr key={id}>
            <td><div className="tbl__name">{id} · {value.name}</div>
              <div className="tbl__bar"><span style={{ width: (value.count / maxCount * 100) + '%' }} /></div></td>
            <td className="num">{value.count}</td>
            <td className={'num ' + (value.wrong ? 'bad' : '')}>{value.wrong || '—'}</td>
          </tr>)}
        </tbody></table>
      </section>
      <section className="card">
        <h2>Проверить вручную</h2>
        {inspect.length === 0 ? <p className="muted">Нет отмеченных ошибок или неоднозначных решений.</p> :
          <ul className="doubts">{inspect.slice(0, 30).map((row) => <li key={row.msg.id}>
            <button onClick={() => onOpen(row.conv.id, row.msg.id)}>
              <span className="doubts__quote">«{row.user?.text ?? 'Реплика клиента'}»</span>
              <span className="doubts__meta">
                {row.msg.review?.verdict === 'wrong' && <b className="bad">Отмечена ошибка</b>}
                <span>{row.msg.turn!.route.join(' + ')}</span>
                <span>{ms(row.msg.turn!.trace.router_ms)}</span>
              </span>
            </button>
          </li>)}</ul>}
      </section>
    </div>
  </div>;
}

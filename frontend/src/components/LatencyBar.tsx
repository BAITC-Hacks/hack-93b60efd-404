import type { Message } from '../state/types';
import { E2E_TARGET_MS, ROUTE_TARGET_MS, ms, stagesOf } from '../lib/format';

export function LatencyBar({ message, compact = false }: { message: Message; compact?: boolean }) {
  const stages = stagesOf(message);
  if (!stages.length) return null;
  const sum = stages.reduce((a, s) => a + s.ms, 0);
  const scale = Math.max(E2E_TARGET_MS * 1.15, sum);
  const e2e = message.client?.e2e_ms;
  const route = message.turn?.timings.route_ms;

  return (
    <div className={`lat ${compact ? 'lat--compact' : ''}`}>
      <div className="lat__track" role="img" aria-label={`Задержка по этапам, всего ${ms(sum)}`}>
        {stages.map((s) => (
          <span
            key={s.key}
            className={`lat__seg lat__seg--${s.key}`}
            style={{ width: `${(s.ms / scale) * 100}%` }}
            title={`${s.label}: ${ms(s.ms)}`}
          />
        ))}
        <span className="lat__tick" style={{ left: `${(E2E_TARGET_MS / scale) * 100}%` }} title="Ориентир 1,5 с" />
      </div>
      {compact ? (
        <span className="lat__nums">
          <span className={route != null && route <= ROUTE_TARGET_MS ? 'ok' : 'warn'}>сценарий {ms(route)}</span>
          {e2e != null && <span className={e2e <= E2E_TARGET_MS ? 'ok' : 'warn'}>до голоса {ms(e2e)}</span>}
        </span>
      ) : (
        <ul className="lat__legend">
          {stages.map((s) => (
            <li key={s.key}>
              <i className={`dot lat__seg--${s.key}`} />
              <span>{s.label}</span>
              <b className={s.key === 'route' ? (s.ms <= ROUTE_TARGET_MS ? 'ok' : 'warn') : ''}>{ms(s.ms)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

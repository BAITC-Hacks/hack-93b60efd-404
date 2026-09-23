import type { Message } from '../state/types';
import { ACTION_LABEL, LANG_SHORT, LOW_CONFIDENCE, pct } from '../lib/format';
import { LatencyBar } from './LatencyBar';
import { IconBolt, IconBranch } from './icons';

export function RouteChip({ m, selected, onClick, title }: { m: Message; selected: boolean; onClick: () => void; title?: string }) {
  const t = m.turn;
  if (!t) return null;
  const low = t.scenario.confidence < LOW_CONFIDENCE || t.action === 'clarify';

  return (
    <button className={`routechip ${selected ? 'is-selected' : ''}`} onClick={onClick} aria-pressed={selected} title={title}>
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
  );
}

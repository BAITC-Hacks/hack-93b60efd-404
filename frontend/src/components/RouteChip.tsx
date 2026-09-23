import type { Message } from '../state/types';
import { LANG_SHORT } from '../lib/format';
import { LatencyBar } from './LatencyBar';
import { IconBranch } from './icons';

export function RouteChip({ m, selected, onClick, title }: { m: Message; selected: boolean; onClick: () => void; title?: string }) {
  const turn = m.turn;
  if (!turn) return null;
  return (
    <button className={'routechip ' + (selected ? 'is-selected' : '')} onClick={onClick} aria-pressed={selected} title={title}>
      <span className="routechip__path routechip__path--llm"><IconBranch width={13} height={13} /> LLM</span>
      <span className="routechip__name">{turn.route_details.map((route) => route.name).join(' + ')}</span>
      <span className="routechip__lang">{LANG_SHORT[turn.language]}</span>
      <LatencyBar message={m} compact />
    </button>
  );
}

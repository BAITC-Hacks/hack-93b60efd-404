import type { Conversation } from '../state/types';
import { relTime } from '../lib/format';
import { IconChart, IconChat, IconPlus, IconTrash, HalykLogo } from './icons';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  view: 'chat' | 'supervisor';
  open: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onView: (v: 'chat' | 'supervisor') => void;
  onClose: () => void;
}

export function Sidebar({ conversations, activeId, view, open, onNew, onSelect, onDelete, onView, onClose }: Props) {
  return (
    <>
      <div className={`scrim ${open ? 'is-open' : ''}`} onClick={onClose} aria-hidden />
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Разговоры">
        <div className="sidebar__brand">
          <HalykLogo height={30} className="brand-logo" />
          <div>
            <div className="sidebar__title">Страховой помощник</div>
          </div>
        </div>

        <button className="btn-new" onClick={onNew}>
          <IconPlus width={18} height={18} />
          Новый разговор
        </button>

        <nav className="sidebar__nav">
          <button className={`navlink ${view === 'chat' ? 'is-active' : ''}`} onClick={() => onView('chat')}>
            <IconChat width={18} height={18} /> Разговоры
          </button>
          <button className={`navlink ${view === 'supervisor' ? 'is-active' : ''}`} onClick={() => onView('supervisor')}>
            <IconChart width={18} height={18} /> Панель супервизора
          </button>
        </nav>

        <div className="sidebar__label">История</div>
        <ul className="convlist">
          {conversations.length === 0 && <li className="convlist__empty">Здесь появятся ваши разговоры с агентом.</li>}
          {conversations.map((c) => {
            return (
              <li key={c.id}>
                <div className={`convitem ${c.id === activeId && view === 'chat' ? 'is-active' : ''}`}>
                  <button className="convitem__main" onClick={() => onSelect(c.id)}>
                    <span className="convitem__title">{c.title}</span>
                    <span className="convitem__meta">
                      {relTime(c.updatedAt)}
                    </span>
                  </button>
                  <button className="convitem__del" onClick={() => onDelete(c.id)} aria-label={`Удалить «${c.title}»`}>
                    <IconTrash width={16} height={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

      </aside>
    </>
  );
}

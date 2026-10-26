import { useEffect, useState } from 'preact/hooks';
import { TABS, tab, pages, setTab, type TabId } from '../nav/router.ts';
import { focusedId } from '../focus/index.ts';
import { Icon } from './Icon.tsx';

/** Switching tabs follows focus (as on Google TV), after a short settle delay. */
const TAB_SWITCH_DELAY_MS = 250;

function useClock(): string {
  const fmt = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const [now, setNow] = useState(fmt);
  useEffect(() => {
    const t = setInterval(() => setNow(fmt()), 15000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function navFocusId(id: TabId): string {
  return `nav:${id}`;
}

export function TopNav() {
  const clock = useClock();
  const active = tab.value;
  const fid = focusedId.value;

  useEffect(() => {
    if (!fid || fid.indexOf('nav:') !== 0) return;
    const id = fid.slice(4) as TabId;
    if (id === tab.value && !pages.value.length) return;
    const t = setTimeout(() => setTab(id), TAB_SWITCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [fid]);

  return (
    <div
      class="topnav hstack"
      data-focus-group
      data-focus-boundary="up"
      data-focus-enter=".is-selected"
      role="navigation"
    >
      <div class="logo">
        FBTV<span>.</span>
      </div>
      {TABS.map((t) => (
        <button
          key={t.id}
          class={'tab' + (active === t.id ? ' is-selected' : '')}
          data-focusable
          data-focus-id={navFocusId(t.id)}
          onClick={() => setTab(t.id)}
        >
          {t.label}
        </button>
      ))}
      <div class="spacer" />
      <button
        class={'nav-pill hstack' + (active === 'search' ? ' is-selected' : '')}
        data-focusable
        data-focus-id={navFocusId('search')}
        onClick={() => setTab('search')}
      >
        <Icon name="search" />
        <span>Search</span>
      </button>
      <button
        class={'nav-icon hstack' + (active === 'settings' ? ' is-selected' : '')}
        data-focusable
        data-focus-id={navFocusId('settings')}
        aria-label="Settings"
        onClick={() => setTab('settings')}
      >
        <Icon name="settings" />
      </button>
      <div class="clock">{clock}</div>
    </div>
  );
}

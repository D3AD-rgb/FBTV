import { useEffect, useLayoutEffect } from 'preact/hooks';
import { tab, pages, overlays, exitPrompt, routeKey, focusMemory, setRouterHooks, type TabId } from './nav/router.ts';
import { getEngine, syncFocus } from './focus/index.ts';
import { TopNav, navFocusId } from './ui/TopNav.tsx';
import { Dialog } from './ui/Dialog.tsx';
import { Toast } from './ui/toast.tsx';
import { Home } from './screens/Home.tsx';
import { LiveTV } from './screens/LiveTV.tsx';
import { Movies, Series, Kids } from './screens/Placeholder.tsx';
import { Search } from './screens/Search.tsx';
import { Settings } from './screens/Settings.tsx';
import { exitApp } from './platform/webos.ts';

function TabScreen({ id }: { id: TabId }) {
  switch (id) {
    case 'home':
      return <Home />;
    case 'live':
      return <LiveTV />;
    case 'movies':
      return <Movies />;
    case 'series':
      return <Series />;
    case 'kids':
      return <Kids />;
    case 'search':
      return <Search />;
    case 'settings':
      return <Settings />;
  }
}

export function App() {
  const pageStack = pages.value;
  const topPage = pageStack[pageStack.length - 1];
  const overlayStack = overlays.value;
  const key = routeKey.value;

  useEffect(() => {
    const engine = getEngine();
    setRouterHooks({
      currentFocusId: () => (engine.focused ? engine.focused.dataset.focusId || null : null),
      focusInNav: () => !!(engine.focused && engine.focused.closest('.topnav')),
      focusNav: () => engine.restore(navFocusId(tab.value)),
    });
  }, []);

  // When the route changes, restore the focus remembered for it — unless focus is in
  // the nav bar (tabs switch while browsing the bar, and focus must stay there).
  useLayoutEffect(() => {
    const engine = getEngine();
    const inNav = !!(engine.focused && engine.focused.closest('.topnav'));
    if (inNav && !topPage) return;
    engine.restore(focusMemory.get(key));
  }, [key]);

  // Overlays open/close: trap focus inside the newest one, or return to the route.
  useLayoutEffect(() => {
    const engine = getEngine();
    if (overlayStack.length || exitPrompt.value) engine.focusFirst();
    else syncFocus();
  }, [overlayStack.length, exitPrompt.value]);

  return (
    <>
      {topPage ? null : <TopNav />}
      <div key={key}>{topPage ? topPage.render() : <TabScreen id={tab.value} />}</div>
      {overlayStack.map((o) => (
        <div key={o.key}>{o.render()}</div>
      ))}
      {exitPrompt.value ? (
        <Dialog
          title="Exit FBTV?"
          actions={[
            { id: 'stay', label: 'Stay', isDefault: true, onSelect: () => (exitPrompt.value = false) },
            { id: 'exit', label: 'Exit', onSelect: exitApp },
          ]}
        />
      ) : null}
      <Toast />
    </>
  );
}

import { beforeEach, describe, expect, it } from 'vitest';
import {
  back,
  exitPrompt,
  openOverlay,
  openPage,
  overlays,
  pages,
  resetRouter,
  routeKey,
  setRouterHooks,
  setTab,
  tab,
  focusMemory,
} from '../src/app/nav/router.ts';

let inNav = false;
let navFocused = 0;
let currentId: string | null = null;

beforeEach(() => {
  resetRouter();
  inNav = false;
  navFocused = 0;
  currentId = null;
  setRouterHooks({
    currentFocusId: () => currentId,
    focusInNav: () => inNav,
    focusNav: () => {
      navFocused++;
      inNav = true;
    },
  });
});

describe('Back key order', () => {
  it('closes overlay, then page, then returns to nav, then Home, then asks to exit', () => {
    setTab('live');
    openPage({ key: 'country:UK', title: 'UK', render: () => null });
    openOverlay({ key: 'list', render: () => null });

    back();
    expect(overlays.value.length).toBe(0);
    back();
    expect(pages.value.length).toBe(0);
    back();
    expect(navFocused).toBe(1);
    back();
    expect(tab.value).toBe('home');
    expect(exitPrompt.value).toBe(false);
    back();
    expect(exitPrompt.value).toBe(true);
    back(); // Back again dismisses the exit prompt
    expect(exitPrompt.value).toBe(false);
  });

  it('lets an overlay keep itself open by handling Back', () => {
    openOverlay({ key: 'player-info', render: () => null, onBack: () => true });
    back();
    expect(overlays.value.length).toBe(1);
  });
});

describe('focus memory', () => {
  it('saves the focused id for the route being left', () => {
    setTab('live');
    currentId = 'ch:BBCNews.uk';
    openPage({ key: 'details', title: 'Details', render: () => null });
    expect(routeKey.value).toBe('page:details');
    expect(focusMemory.get('tab:live')).toBe('ch:BBCNews.uk');
  });
});

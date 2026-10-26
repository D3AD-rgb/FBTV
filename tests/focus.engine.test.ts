import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusEngine, type Measure } from '../src/app/focus/engine.ts';

/** jsdom has no layout: elements declare their rect as data-rect="left,top,width,height". */
const measure: Measure = (el) => {
  const raw = el.getAttribute('data-rect');
  if (!raw) return { left: 0, top: 0, width: 0, height: 0 };
  const [left, top, width, height] = raw.split(',').map(Number) as [number, number, number, number];
  return { left, top, width, height };
};

function setup(html: string) {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  const root = document.getElementById('root')!;
  const onChange = vi.fn();
  const engine = new FocusEngine({ root, measure, onChange });
  const $ = (id: string) => root.querySelector<HTMLElement>(`[data-focus-id="${id}"]`)!;
  return { root, engine, $, onChange };
}

const tile = (id: string, l: number, t: number, extra = '') =>
  `<div data-focusable data-focus-id="${id}" data-rect="${l},${t},240,135" ${extra}></div>`;

const PAGE = `
  <nav data-focus-group>
    <button data-focusable data-focus-id="nav:home" data-rect="100,40,120,60"></button>
    <button data-focusable data-focus-id="nav:live" data-rect="240,40,140,60"></button>
  </nav>
  <div data-focus-group data-focus-memory id="row1">
    ${tile('r1a', 100, 200)}${tile('r1b', 364, 200)}${tile('r1c', 628, 200)}
  </div>
  <div data-focus-group data-focus-memory id="row2">
    ${tile('r2a', 100, 400)}${tile('r2b', 364, 400)}${tile('r2c', 628, 400)}
  </div>`;

describe('FocusEngine', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses the default element first and marks it', () => {
    const { engine, $ } = setup(PAGE.replace('data-focus-id="r1b"', 'data-focus-id="r1b" data-focus-default'));
    expect(engine.focusFirst()).toBe(true);
    expect(engine.focused).toBe($('r1b'));
    expect($('r1b').hasAttribute('data-focused')).toBe(true);
  });

  it('keeps the focus marker when a re-render rewrites the class attribute', () => {
    const { engine, $ } = setup(PAGE);
    engine.focus($('nav:live'));
    $('nav:live').className = 'tab is-selected'; // what Preact does on re-render
    expect($('nav:live').hasAttribute('data-focused')).toBe(true);
  });

  it('prefers content inside the same scroller over the nav bar when moving up', () => {
    // Page scrolled up by 300px: the hero button now sits behind the nav bar on screen,
    // but it is still the element above the first row inside the page.
    const { engine, $ } = setup(`
      <nav data-focus-group>
        <button data-focusable data-focus-id="nav:home" data-rect="100,40,200,64"></button>
      </nav>
      <div data-scroll="y" data-rect="0,132,1920,948">
        <div data-scroll-track>
          <button data-focusable data-focus-id="hero:play" data-rect="100,60,260,68"></button>
          <div data-focusable data-focus-id="row:first" data-rect="100,300,240,135"></div>
        </div>
      </div>`);
    engine.focus($('row:first'));
    engine.move('up');
    expect(engine.focused).toBe($('hero:play'));
    // Focusing the hero scrolls the page back down (static rects here, so model it).
    $('hero:play').setAttribute('data-rect', '100,360,260,68');
    engine.move('up');
    expect(engine.focused).toBe($('nav:home'));
  });

  it('moves along a row and stops at the end', () => {
    const { engine, $ } = setup(PAGE);
    engine.focus($('r1a'));
    expect(engine.move('right')).toBe(true);
    expect(engine.focused).toBe($('r1b'));
    engine.move('right');
    expect(engine.move('right')).toBe(false);
    expect(engine.focused).toBe($('r1c'));
  });

  it('moves between rows and restores the remembered card when re-entering a row', () => {
    const { engine, $ } = setup(PAGE);
    engine.focus($('r2a'));
    engine.move('right');
    engine.move('right'); // r2c remembered for row2
    engine.move('up'); // -> r1c (geometric)
    expect(engine.focused).toBe($('r1c'));
    engine.move('left');
    engine.move('left'); // r1a
    engine.move('down'); // geometric would be r2a, memory says r2c
    expect(engine.focused).toBe($('r2c'));
  });

  it('goes up from content to the nav bar', () => {
    const { engine, $ } = setup(PAGE);
    engine.focus($('r1b'));
    engine.move('up');
    expect(engine.focused).toBe($('nav:live'));
  });

  it('enters the nav bar on its active tab when the group asks for it', () => {
    const { engine, $ } = setup(
      PAGE.replace('<nav data-focus-group>', '<nav data-focus-group data-focus-enter=".is-selected">').replace(
        'data-focus-id="nav:home"',
        'data-focus-id="nav:home" class="is-selected"',
      ),
    );
    engine.focus($('r1c'));
    engine.move('up');
    expect(engine.focused).toBe($('nav:home'));
  });

  it('keeps focus inside the last open trap', () => {
    const { engine, $ } = setup(
      PAGE +
        `<div data-focus-trap data-rect="0,0,1920,1080">
          <button data-focusable data-focus-id="d:stay" data-focus-default data-rect="700,500,200,68"></button>
          <button data-focusable data-focus-id="d:exit" data-rect="920,500,200,68"></button>
        </div>`,
    );
    engine.focusFirst();
    expect(engine.focused).toBe($('d:stay'));
    expect(engine.move('up')).toBe(false);
    engine.move('right');
    expect(engine.focused).toBe($('d:exit'));
    expect(engine.move('right')).toBe(false);
  });

  it('honours explicit overrides and blocks', () => {
    const { engine, $ } = setup(
      PAGE.replace('data-focus-id="r1a"', 'data-focus-id="r1a" data-focus-down="none" data-focus-right="[data-focus-id=r1c]"'),
    );
    engine.focus($('r1a'));
    expect(engine.move('down')).toBe(false);
    engine.move('right');
    expect(engine.focused).toBe($('r1c'));
  });

  it('does not leave a group across its boundary', () => {
    const { engine, $ } = setup(PAGE.replace('id="row1"', 'id="row1" data-focus-boundary="down"'));
    engine.focus($('r1b'));
    expect(engine.move('down')).toBe(false);
    expect(engine.focused).toBe($('r1b'));
  });

  it('skips hidden elements', () => {
    const { engine, $ } = setup(PAGE.replace('data-focus-id="r1b"', 'data-focus-id="r1b" hidden'));
    engine.focus($('r1a'));
    engine.move('right');
    expect(engine.focused).toBe($('r1c'));
  });

  it('restores focus by id and falls back to the first element', () => {
    const { engine, $ } = setup(PAGE);
    expect(engine.restore('r2b')).toBe(true);
    expect(engine.focused).toBe($('r2b'));
    engine.restore('missing');
    expect(engine.focused).toBe($('nav:home'));
  });

  it('activates the focused element with select()', () => {
    const { engine, $ } = setup(PAGE);
    const click = vi.fn();
    $('r1a').addEventListener('click', click);
    engine.focus($('r1a'));
    engine.select();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('reports focus changes with the element id', () => {
    const { engine, $, onChange } = setup(PAGE);
    engine.focus($('r1a'));
    expect(onChange).toHaveBeenLastCalledWith($('r1a'), 'r1a');
  });
});

import type { ComponentChildren } from 'preact';

/** A titled horizontal row. Focus memory restores the last card when re-entering. */
export function Shelf(props: { id: string; title: string; count?: string; children: ComponentChildren }) {
  return (
    <section class="shelf" data-scroll-anchor="0" data-shelf={props.id}>
      <div class="shelf-title">
        {props.title}
        {props.count ? <small>{props.count}</small> : null}
      </div>
      <div class="shelf-viewport" data-scroll="x" data-scroll-align="start">
        <div class="shelf-track" data-scroll-track data-focus-group data-focus-memory>
          {props.children}
        </div>
      </div>
    </section>
  );
}

/**
 * Vertical page scroller. `start` (shelf pages) brings the focused row to the top, as on
 * Google TV; `nearest` (lists, settings) only scrolls when focus would leave the screen.
 */
export function PageScroll(props: { children: ComponentChildren; align?: 'start' | 'nearest' }) {
  const align = props.align || 'start';
  return (
    <div class="page-viewport" data-scroll="y" data-scroll-align={align} data-scroll-pad={align === 'nearest' ? '48' : '0'}>
      <div class="page-track" data-scroll-track>
        {props.children}
      </div>
    </div>
  );
}

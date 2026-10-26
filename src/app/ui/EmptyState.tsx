import type { ComponentChildren } from 'preact';

/**
 * Explains why a section is empty and what makes it work. Focusable so the remote can
 * always land somewhere and the page never has a "dead" row.
 */
export function EmptyState(props: {
  id: string;
  title: string;
  children: ComponentChildren;
  wide?: boolean;
  onSelect?: () => void;
}) {
  return (
    <div
      class={'empty card' + (props.wide ? ' wide' : '')}
      data-focusable
      data-focus-id={props.id}
      onClick={props.onSelect}
      role="note"
    >
      <h3>{props.title}</h3>
      <p>{props.children}</p>
    </div>
  );
}

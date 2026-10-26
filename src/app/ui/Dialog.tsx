import type { ComponentChildren } from 'preact';

export interface DialogAction {
  id: string;
  label: string;
  onSelect: () => void;
  isDefault?: boolean;
}

/** Modal dialog: a focus trap so the remote cannot wander behind it. */
export function Dialog(props: { title: string; children?: ComponentChildren; actions: DialogAction[] }) {
  return (
    <div class="overlay" data-focus-trap role="dialog" aria-modal="true" aria-label={props.title}>
      <div class="overlay-backdrop" />
      <div class="dialog">
        <h2>{props.title}</h2>
        {props.children ? <p>{props.children}</p> : null}
        <div class="actions hstack">
          {props.actions.map((a) => (
            <button
              key={a.id}
              class="btn"
              data-focusable
              data-focus-id={`dialog:${a.id}`}
              {...(a.isDefault ? { 'data-focus-default': '' } : {})}
              onClick={a.onSelect}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

import { EmptyState } from '../ui/EmptyState.tsx';

/**
 * Live deck: preview window on the left, numbered channel list on the right
 * (direction C in the blueprint). Filled in when the catalogue arrives (v0.3.0).
 */
export function LiveTV() {
  return (
    <div class="screen live-deck">
      <div class="live-preview">
        <div class="live-preview-empty">
          <div class="title">Nothing playing</div>
          <div class="sub">Pick a channel from the list to preview it here.</div>
        </div>
      </div>
      <div class="live-hints">
        <b>OK</b> full screen · <b>▲▼</b> browse channels · <b>◀</b> categories · <b>Red</b> favourite
      </div>
      <div class="live-list" data-focus-group data-focus-memory>
        <EmptyState id="live:empty" title="No channels loaded">
          The channel list comes from the catalogue builder, which collects, cleans and de-duplicates public
          playlists. It arrives in the next builds; until then there is nothing to show here.
        </EmptyState>
      </div>
    </div>
  );
}

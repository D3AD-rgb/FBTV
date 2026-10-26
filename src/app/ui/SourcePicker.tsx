/**
 * Source dropdown (Rule 10): registry groups on the left, that group's items on the right with
 * channel counts and status. Built from the library's registry.json — never a fixed list.
 */
import { useState } from 'preact/hooks';
import type { LibItem, LibRegistry } from '../data/sourceLibrary.ts';
import { VirtualList } from './VirtualList.tsx';

function statusLabel(i: LibItem): string {
  if (i.status === 'needs-credentials') return 'needs credentials';
  if (i.status === 'needs-setup') return 'not set up';
  if (i.status === 'error') return 'error';
  if (!i.channels) return 'empty';
  const v = i.validation;
  if (v.playbackConfirmed) return `${i.channels.toLocaleString()} · ${v.playbackConfirmed} confirmed`;
  if (v.reachable) return `${i.channels.toLocaleString()} · ${v.reachable} reachable`;
  return `${i.channels.toLocaleString()} · untested`;
}

export function SourcePicker(props: { registry: LibRegistry; currentId: string; onPick: (item: LibItem) => void }) {
  const playableGroups = props.registry.groups.filter((g) => props.registry.items.some((i) => i.group === g));
  const current = props.registry.items.filter((i) => i.id === props.currentId)[0];
  const [group, setGroup] = useState<string>(current ? current.group : playableGroups[0] || '');
  const items = props.registry.items.filter((i) => i.group === group);
  return (
    <div class="overlay" data-focus-trap>
      <div class="overlay-backdrop" />
      <div class="source-picker">
        <div class="source-picker-title">Choose a source</div>
        <div class="source-picker-sub">Generated from your library on the PC (registry {props.registry.generatedAt.slice(0, 10)})</div>
        <div class="source-cols">
          <div class="source-col groups">
            <VirtualList
              id="picker:groups"
              items={playableGroups}
              rowHeight={78}
              height={760}
              index={Math.max(0, playableGroups.indexOf(group))}
              renderRow={(g) => (
                <div class="lrow">
                  <div class="lrow-text">
                    <div class="lrow-name">{g}</div>
                    <div class="lrow-sub">{props.registry.items.filter((i) => i.group === g).length} items</div>
                  </div>
                </div>
              )}
              onIndexChange={(g) => setGroup(g)}
              onSelect={(g) => setGroup(g)}
            />
          </div>
          <div class="source-col items">
            <VirtualList
              id={`picker:items:${group}`}
              items={items}
              rowHeight={92}
              height={760}
              index={Math.max(0, items.findIndex((i) => i.id === props.currentId))}
              renderRow={(i) => (
                <div class="lrow">
                  <div class="lrow-text">
                    <div class="lrow-name">
                      {i.name}
                      {i.id === props.currentId ? <span class="lrow-playing"> ● current</span> : null}
                    </div>
                    <div class="lrow-sub">{i.error || i.note || statusLabel(i)}</div>
                  </div>
                  <span class="lrow-count">{statusLabel(i)}</span>
                </div>
              )}
              onSelect={(i) => props.onPick(i)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'preact/hooks';
import type { CatalogueChannel } from '../../shared/model.ts';
import { advertisedHeight, verifiedHeight } from '../../shared/collections.ts';
import { favourites } from '../data/library.ts';

/** Short monogram for channels without a usable logo ("BBC News" → "BBC NEWS", max 2 lines). */
export function monogram(name: string): string {
  const words = name
    .replace(/[()[\]|]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 3).join(' ').toUpperCase();
}

/**
 * imgur serves a 336×478 "Content not available in your country" image (HTTP 200) to UK
 * viewers instead of the logo (FND-012). Treat it, and empty images, as missing.
 */
export function isPlaceholderImage(img: { naturalWidth: number; naturalHeight: number; src: string }): boolean {
  if (!img.naturalWidth || !img.naturalHeight) return true;
  return /imgur\.com\//.test(img.src) && img.naturalWidth === 336 && img.naturalHeight === 478;
}

/** Logo on a neutral plate; falls back to a monogram when missing, broken or geo-blocked. */
export function Logo(props: { channel: CatalogueChannel; size?: 'tile' | 'row' | 'hero' }) {
  const [failed, setFailed] = useState(false);
  const src = props.channel.logo;
  // Rows are recycled by the virtual list: a new logo URL gets a fresh attempt.
  useEffect(() => setFailed(false), [src]);
  return (
    <div class={`logo-plate ${props.size || 'tile'}`}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          onLoad={(e) => {
            if (isPlaceholderImage(e.currentTarget as HTMLImageElement)) setFailed(true);
          }}
        />
      ) : (
        <span class="monogram">{monogram(props.channel.name)}</span>
      )}
    </div>
  );
}

/** Quality chip: verified (measured) beats advertised; unknown shows nothing. */
export function QualityChip({ channel }: { channel: CatalogueChannel }) {
  const v = verifiedHeight(channel);
  if (v) return <span class="chip verified">✓ {v >= 2160 ? '4K' : `${v}p`} verified</span>;
  const a = advertisedHeight(channel);
  if (a) return <span class="chip advertised">{a >= 2160 ? '4K' : `${a}p`} advertised</span>;
  return null;
}

export function ChannelTile(props: {
  channel: CatalogueChannel;
  focusId: string;
  number?: number;
  playing?: boolean;
  /** No stream the TV can attempt (kept visible, marked unavailable). */
  offline?: boolean;
  onSelect: () => void;
}) {
  const fav = favourites.value.indexOf(props.channel.id) >= 0;
  return (
    <div class="tile-wrap">
      <div
        class={'tile card' + (props.playing ? ' playing' : '') + (props.offline ? ' offline' : '')}
        data-focusable
        data-focus-id={props.focusId}
        data-channel={props.channel.id}
        onClick={props.onSelect}
        role="button"
        aria-label={props.channel.name}
      >
        <Logo channel={props.channel} />
        {props.number ? <span class="num">{props.number}</span> : null}
        {fav ? <span class="fav">★</span> : null}
      </div>
      <div class="tile-name">{props.offline ? 'Unavailable · ' : ''}{props.channel.name}</div>
    </div>
  );
}

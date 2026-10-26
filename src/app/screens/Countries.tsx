/**
 * Countries: every country present in the catalogue (none hard-coded), searchable by name
 * or ISO code, with a 4K entry at the top. A country opens its channels grouped by category.
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import { countryCounts, countryGroups, uhdGroups } from '../../shared/collections.ts';
import { fold } from '../../shared/normalize.ts';
import { ready } from '../data/catalogue.ts';
import { openPage, type PageEntry } from '../nav/router.ts';
import { PageScroll } from '../ui/Shelf.tsx';
import { Icon } from '../ui/Icon.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { collectionPage } from './Collection.tsx';

export function countryPage(code: string): PageEntry {
  const data = ready();
  const info = data ? data.countryById.get(code) : undefined;
  const name = info ? info.name : code;
  return collectionPage(`country:${code}`, name, () => {
    const d = ready();
    return d ? countryGroups(d.channels, code, d.categoryName) : [];
  });
}

export function uhdPage(): PageEntry {
  return collectionPage(
    'uhd',
    '4K channels',
    () => {
      const d = ready();
      return d ? uhdGroups(d.channels) : [];
    },
    {
      intro:
        '“Verified” means FBTV measured the stream at 3840×2160 or more. “Advertised” means the source claims 4K but it has not been measured. 4K needs a fast, steady connection.',
      emptyText: 'No channel is verified or advertised as 4K in the current catalogue.',
    },
  );
}

/** Matches a country by name, folded name prefix, or exact ISO / iptv-org code (UK and GB both work). Pure. */
export function matchCountry(query: string, code: string, name: string): boolean {
  const q = fold(query);
  if (!q) return true;
  const c = code.toLowerCase();
  if (q === c || (q === 'gb' && c === 'uk')) return true;
  const n = fold(name);
  return n.indexOf(q) === 0 || n.indexOf(' ' + q) >= 0;
}

function Countries() {
  const data = ready();
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const counts = useMemo(() => (data ? countryCounts(data.channels) : []), [data]);
  if (!data) {
    return (
      <div class="screen">
        <PageScroll align="nearest">
          <EmptyState id="countries:empty" title="No catalogue loaded" wide>
            Countries are listed from the channel catalogue once it is loaded.
          </EmptyState>
        </PageScroll>
      </div>
    );
  }
  const list = counts.filter((c) => {
    const info = data.countryById.get(c.code);
    return matchCountry(query, c.code, info ? info.name : c.code);
  });
  return (
    <div class="screen">
      <PageScroll align="nearest">
        <section data-scroll-anchor="0">
          <div class="breadcrumb">
            Live TV › <b>Countries</b>
          </div>
          <div class="page-sub" style="margin-top:12px">
            {counts.length} countries in the catalogue. Search by name or code (UK, US, BD…).
          </div>
          <div class="hstack" style="--stack-gap:20px">
            <div
              class="search-field small hstack"
              data-focusable
              data-focus-default
              data-focus-id="countries:search"
              onClick={() => input.current && input.current.focus()}
            >
              <Icon name="search" size={30} />
              <input
                ref={input}
                type="text"
                value={query}
                placeholder="Find a country"
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                aria-label="Find a country"
              />
            </div>
            <button class="btn" data-focusable data-focus-id="countries:4k" onClick={() => openPage(uhdPage())}>
              4K channels
            </button>
          </div>
        </section>
        <div class="country-grid" data-focus-group data-focus-memory>
          {list.map((c) => {
            const info = data.countryById.get(c.code);
            return (
              <button
                key={c.code}
                class="country-card card"
                data-focusable
                data-focus-id={`country:${c.code}`}
                onClick={() => openPage(countryPage(c.code))}
              >
                <span class="ccode">{c.code}</span>
                <span class="cname">{info ? info.name : c.code}</span>
                <span class="ccount">{c.count.toLocaleString()} channels</span>
              </button>
            );
          })}
        </div>
        {!list.length ? (
          <EmptyState id="countries:none" title={`No country matches “${query}”`}>
            Try the country's English name or its two-letter code.
          </EmptyState>
        ) : null}
      </PageScroll>
    </div>
  );
}

export function countriesPage(): PageEntry {
  return { key: 'countries', title: 'Countries', render: () => <Countries /> };
}

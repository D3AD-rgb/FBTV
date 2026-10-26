import { useRef, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';

const EXAMPLES = ['BBC One', 'UK channels', 'Bangladesh', 'English news', 'Premier League', 'Arabic sports', '4K'];

export function Search() {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  return (
    <div class="screen">
      <div class="page-viewport">
        <div class="page-track">
          <div class="page-title">Search</div>
          <div
            class="search-field hstack"
            data-focusable
            data-focus-default
            data-focus-id="search:field"
            onClick={() => input.current && input.current.focus()}
          >
            <Icon name="search" size={34} />
            <input
              ref={input}
              type="text"
              value={query}
              placeholder="Channels, countries, teams, competitions…"
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              aria-label="Search"
            />
          </div>
          <div class="search-examples hstack" data-focus-group data-focus-memory>
            {EXAMPLES.map((q) => (
              <button
                key={q}
                class="chip selectable"
                data-focusable
                data-focus-id={`search:ex:${q}`}
                onClick={() => setQuery(q)}
              >
                {q}
              </button>
            ))}
          </div>
          <div style="margin-top:40px">
            <EmptyState id="search:empty" title={query ? `No results for “${query}”` : 'Nothing to search yet'} wide>
              Search covers channel names, alternative names, countries, languages, categories, competitions,
              teams and on-demand titles. It works once the catalogue is loaded.
            </EmptyState>
          </div>
        </div>
      </div>
    </div>
  );
}

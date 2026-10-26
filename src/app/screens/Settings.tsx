import { useEffect, useRef, useState } from 'preact/hooks';
import { PageScroll } from '../ui/Shelf.tsx';
import { openPage, type PageEntry } from '../nav/router.ts';
import { clearAll } from '../platform/storage.ts';
import { showToast } from '../ui/toast.tsx';
import { getDeviceInfo, type DeviceInfo } from '../platform/webos.ts';
import { probeMedia, probePlatform, type Probe } from '../platform/capabilities.ts';
import { playbackTestPage } from './PlaybackTest.tsx';
import { SERVICES, appsMethod, detectApps, installedApps } from '../platform/apps.ts';
import {
  includeUnreviewed,
  library,
  autoServers,
  BUNDLED_ONLY,
  libraryServer,
  loadLibrary,
  showLibraryUrl,
  setIncludeUnreviewed,
  setLibraryServer,
} from '../data/sourceLibrary.ts';

interface Row {
  id: string;
  title: string;
  sub: string;
  value?: string;
  onSelect?: () => void;
}

function SettingsList(props: { rows: Row[] }) {
  return (
    <div class="settings-list" data-focus-group data-focus-memory>
      {props.rows.map((r, i) => (
        <button
          key={r.id}
          class="list-row"
          data-focusable
          data-focus-id={`settings:${r.id}`}
          {...(i === 0 ? { 'data-focus-default': '' } : {})}
          onClick={r.onSelect}
        >
          <div class="grow">
            <div class="title">{r.title}</div>
            <div class="sub">{r.sub}</div>
          </div>
          {r.value ? <div class="value">{r.value}</div> : null}
        </button>
      ))}
    </div>
  );
}

export function Settings() {
  const rows: Row[] = [
    {
      id: 'sources',
      title: 'Sources',
      sub: 'Source library from the PC, library server and unreviewed lists',
      value: library.value.status === 'ready' ? (library.value.origin === 'server' ? 'Server' : 'Bundled') : library.value.status === 'loading' ? 'Loading…' : 'Not found',
      onSelect: () => openPage(sourcesPage()),
    },
    { id: 'refresh', title: 'Catalogue refresh', sub: 'When the app checks for a newer catalogue', value: 'Coming in v0.3' },
    { id: 'epg', title: 'Programme guide', sub: 'Now and next, schedules and the guide grid', value: 'Coming in v0.7' },
    {
      id: 'playback',
      title: 'Playback test',
      sub: 'Play public test streams with each player engine to see what this TV can decode',
      onSelect: () => openPage(playbackTestPage()),
    },
    { id: 'appearance', title: 'Appearance', sub: 'Theme and motion', value: 'Dark' },
    { id: 'language', title: 'Language', sub: 'Interface language and preferred audio languages', value: 'English' },
    { id: 'favourites', title: 'Favourites', sub: 'Reorder or remove favourite channels', value: 'Coming in v0.3' },
    { id: 'kids', title: 'Kids Mode', sub: 'PIN, allowlist and what children can see', value: 'Coming in v0.9' },
    {
      id: 'clear',
      title: 'Clear cache and preferences',
      sub: 'Removes cached catalogues, favourites, history and settings stored on this TV',
      onSelect: () => {
        clearAll();
        showToast('Cache and preferences cleared');
      },
    },
    { id: 'about', title: 'About', sub: 'Version, sources and licences', onSelect: () => openPage(aboutPage()) },
    {
      id: 'diagnostics',
      title: 'Diagnostics',
      sub: 'What this TV can play, and platform details',
      onSelect: () => openPage(diagnosticsPage()),
    },
  ];
  return (
    <div class="screen">
      <PageScroll align="nearest">
        <section data-scroll-anchor="0">
          <div class="page-title">Settings</div>
        </section>
        <SettingsList rows={rows} />
      </PageScroll>
    </div>
  );
}

function ValueCell({ v }: { v: Probe['value'] }) {
  if (v === 'yes') return <td class="ok">Yes</td>;
  if (v === 'no') return <td class="no">No</td>;
  if (v === 'maybe') return <td class="maybe">Maybe</td>;
  return <td>{v}</td>;
}

function Panel(props: { id: string; title: string; rows: Probe[] }) {
  return (
    <div class="panel card" data-focusable data-focus-id={props.id}>
      <h3>{props.title}</h3>
      <table class="kv">
        <tbody>
          {props.rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <ValueCell v={r.value} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Diagnostics() {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [media] = useState(probeMedia);
  const [platform] = useState(probePlatform);
  useEffect(() => {
    detectApps();
  }, []);
  useEffect(() => {
    let alive = true;
    getDeviceInfo().then((d) => {
      if (alive) setDevice(d);
      // Logged so it can be read with `ares-inspect` / `ares-log` during development.
      console.info('[fbtv] device', JSON.stringify(d));
    });
    return () => {
      alive = false;
    };
  }, []);
  const deviceRows: Probe[] = device
    ? [
        { label: 'Running on', value: device.platform === 'webos' ? 'LG webOS' : 'Desktop browser' },
        { label: 'Model', value: device.modelName || 'unknown' },
        { label: 'webOS / SDK version', value: device.sdkVersion || 'unknown' },
        { label: 'Firmware', value: device.firmwareVersion || 'unknown' },
        { label: 'UHD panel', value: device.uhd === undefined ? 'unknown' : device.uhd ? 'yes' : 'no' },
        { label: 'Web engine', value: device.chromium ? `Chromium ${device.chromium}` : 'unknown' },
        { label: 'App', value: `${__APP_TITLE__} ${__APP_VERSION__} (${__APP_COMMIT__})` },
      ]
    : [{ label: 'Device', value: 'Reading…' }];
  return (
    <div class="screen">
      <PageScroll align="nearest">
        <section data-scroll-anchor="0">
          <div class="breadcrumb">
            Settings › <b>Diagnostics</b>
          </div>
          <div class="page-sub" style="margin-top:16px">
            These answers come from this TV's own web engine. A “Yes” for a format means the engine says it can
            decode it; real streams are tested separately in the playback probe.
          </div>
        </section>
        <div class="vstack" style="--stack-gap:24px">
          <div class="hstack">
            <button class="btn" data-focusable data-focus-default data-focus-id="diag:playback" onClick={() => openPage(playbackTestPage())}>
              Run playback test
            </button>
          </div>
          <Panel id="diag:device" title="This TV" rows={deviceRows} />
          <Panel id="diag:media" title="Media formats" rows={media} />
          <Panel id="diag:platform" title="Platform features" rows={platform} />
          <Panel
            id="diag:apps"
            title="Broadcaster apps on this TV (for Watch on)"
            rows={
              installedApps.value
                ? SERVICES.map((sv) => ({ label: sv.label, value: installedApps.value![sv.label] ? 'yes' : 'no' }) as Probe).concat([
                    { label: 'Found by', value: appsMethod.value === 'launch-points' ? 'app list' : appsMethod.value === 'load-status' ? 'known app ids' : 'not available here' } as Probe,
                  ])
                : [{ label: 'Apps', value: 'Checking…' } as Probe]
            }
          />
        </div>
      </PageScroll>
    </div>
  );
}

export function diagnosticsPage(): PageEntry {
  return { key: 'diagnostics', title: 'Diagnostics', render: () => <Diagnostics /> };
}

function About() {
  const rows: Probe[] = [
    { label: 'Version', value: `${__APP_VERSION__} (${__APP_COMMIT__})` },
    { label: 'App ID', value: __APP_ID__ },
    { label: 'Channel data', value: 'iptv-org (public domain); links are public streams submitted by the community' },
    { label: 'Football data', value: 'football-data.org (when configured)' },
    { label: 'Player engines', value: 'Native webOS player, hls.js (Apache-2.0), mpegts.js (Apache-2.0)' },
    { label: 'Font', value: 'Manrope (SIL Open Font License)' },
    { label: 'Code credits', value: 'Focus and player patterns adapted from iptvnator (MIT)' },
  ];
  return (
    <div class="screen">
      <PageScroll align="nearest">
        <section data-scroll-anchor="0">
          <div class="breadcrumb">
            Settings › <b>About</b>
          </div>
          <div class="page-sub" style="margin-top:16px">
            FBTV plays publicly available streams only. It does not bypass DRM, logins, paywalls or geographic
            restrictions. A channel appearing in a list does not guarantee it is streaming.
          </div>
        </section>
        <Panel id="about:info" title="FBTV" rows={rows} />
      </PageScroll>
    </div>
  );
}

export function aboutPage(): PageEntry {
  return { key: 'about', title: 'About', render: () => <About /> };
}

function Sources() {
  const lib = library.value;
  const stored = libraryServer();
  const [server, setServer] = useState(stored === BUNDLED_ONLY ? '' : stored);
  const auto = autoServers.value;
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const reg = lib.status === 'ready' ? lib.registry : null;
  const rows: Probe[] = reg
    ? [
        {
          label: 'Loaded from',
          value:
            lib.status === 'ready' && lib.origin === 'server'
              ? `Library server (${showLibraryUrl(lib.base)})`
              : stored === BUNDLED_ONLY || !(stored || auto.length)
                ? 'Bundled with this build'
                : `Bundled with this build — no library server answered (${showLibraryUrl(stored || auto.join(', '))})`,
        },
        ...auto.map((u, i) => ({ label: i ? 'Then' : 'Servers in this build', value: showLibraryUrl(u) })),
        { label: 'Library built', value: reg.generatedAt.replace('T', ' ').slice(0, 16) + ' UTC' },
        { label: 'Registry items', value: reg.items.length.toLocaleString() },
        ...Object.keys(reg.shards).map((k) => ({ label: `Channels · ${k}`, value: `${reg.shards[k]!.channels.toLocaleString()}${reg.shards[k]!.note ? ` — ${reg.shards[k]!.note}` : ''}` })),
      ]
    : [{ label: 'Library', value: lib.status === 'loading' ? 'Loading…' : lib.status === 'missing' ? lib.reason : '' }];
  const apply = async (url: string) => {
    setBusy(true);
    setLibraryServer(url);
    library.value = { status: 'loading' };
    await loadLibrary();
    setBusy(false);
    const now = library.peek();
    showToast(now.status === 'ready' ? (now.origin === 'server' ? 'Connected to the library server' : 'Using the copy bundled with this build') : 'The library server did not answer');
  };
  return (
    <div class="screen">
      <PageScroll align="nearest">
        <section data-scroll-anchor="0">
          <div class="breadcrumb">
            Settings › <b>Sources</b>
          </div>
          <div class="page-sub" style="margin-top:16px">
            Channel lists, playlists, football fixtures and sports come from the source library built on the PC.
            A local build includes a copy and connects by itself to the library server it was built for (your PC
            running “npm run library:serve”, or your always-on server); that is what plays My Playlist and your
            own media, keeps lists up to date and saves your playlist selections. Another address can be entered
            here. Public releases never include the library, and it holds no
            passwords.
          </div>
        </section>
        <div class="vstack" style="--stack-gap:24px">
          <div class="hstack" style="--stack-gap:20px">
            <div class="search-field small hstack" data-focusable data-focus-default data-focus-id="sources:server" onClick={() => input.current && input.current.focus()}>
              <input
                ref={input}
                type="text"
                value={server}
                placeholder={auto.length ? showLibraryUrl(auto[0]!) : 'http://192.168.0.x:8787/registry.json'}
                onInput={(e) => setServer((e.target as HTMLInputElement).value)}
                aria-label="Library server address"
              />
            </div>
            <button class="btn" data-focusable data-focus-id="sources:apply" onClick={() => !busy && apply(server)}>
              {busy ? 'Connecting…' : server ? 'Use this address' : 'Use library server'}
            </button>
            <button
              class="btn"
              data-focusable
              data-focus-id="sources:bundled"
              onClick={() => {
                setServer('');
                if (!busy) apply(BUNDLED_ONLY);
              }}
            >
              Use bundled
            </button>
          </div>
          <div class="hstack">
            <button class="btn" data-focusable data-focus-id="sources:secondary" onClick={() => setIncludeUnreviewed(!includeUnreviewed.value)}>
              Unreviewed lists: {includeUnreviewed.value ? 'On' : 'Off'}
            </button>
          </div>
          <p class="muted-text">
            Unreviewed lists are channels found only in mixed-provenance playlists (Tvlist, fanmingming, HerbertHe
            aggregators). They are kept in the library but loaded only when this is on. Pay-TV relays are never
            offered for playback.
          </p>
          <Panel id="sources:info" title="Source library" rows={rows} />
        </div>
      </PageScroll>
    </div>
  );
}

export function sourcesPage(): PageEntry {
  return { key: 'sources', title: 'Sources', render: () => <Sources /> };
}

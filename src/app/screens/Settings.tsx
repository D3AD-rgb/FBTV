import { useEffect, useState } from 'preact/hooks';
import { PageScroll } from '../ui/Shelf.tsx';
import { openPage, type PageEntry } from '../nav/router.ts';
import { clearAll } from '../platform/storage.ts';
import { showToast } from '../ui/toast.tsx';
import { getDeviceInfo, type DeviceInfo } from '../platform/webos.ts';
import { probeMedia, probePlatform, type Probe } from '../platform/capabilities.ts';
import { playbackTestPage } from './PlaybackTest.tsx';

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
    { id: 'sources', title: 'Sources', sub: 'Playlists, catalogue, football and guide providers', value: 'Coming in v0.3' },
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

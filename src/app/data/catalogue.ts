/**
 * Catalogue store on the TV.
 *
 * Start-up: show the cached catalogue (IndexedDB) or, on first run, the snapshot bundled in
 * the app package — never wait for the network. Then, if a published manifest URL is
 * configured, check it in the background and download only shards whose hash changed.
 * A newer catalogue is applied immediately only when nothing is loaded yet; otherwise it is
 * stored and used from the next launch, so lists never jump while someone is browsing.
 */
import { signal } from '@preact/signals';
import type { CatalogueChannel, CatalogueManifest, CountryInfo, LanguageInfo } from '../../shared/model.ts';
import { decodeChannels } from '../../shared/codec.ts';
import { getJSON, getText } from './http.ts';
import { idbGet, idbSet } from './idb.ts';
import { favourites, prefs } from './library.ts';

export interface LoadedCatalogue {
  generatedAt: string;
  origin: 'cache' | 'bundled' | 'remote';
  channels: CatalogueChannel[];
  byId: Map<string, CatalogueChannel>;
  countries: CountryInfo[];
  countryById: Map<string, CountryInfo>;
  languages: LanguageInfo[];
  languageName: Record<string, string>;
  categoryName: Record<string, string>;
  manifest: CatalogueManifest;
}

export type CatalogueState =
  | { status: 'loading' }
  | { status: 'empty'; reason: string }
  | { status: 'ready'; data: LoadedCatalogue; updateAvailable?: boolean };

export const catalogue = signal<CatalogueState>({ status: 'loading' });

const CACHE_KEY = 'catalogue:v1';
const BUNDLED_BASE = 'catalogue/';

interface CachedCatalogue {
  manifest: CatalogueManifest;
  shards: Record<string, string>;
}

const SHARDS = ['channels', 'countries', 'languages', 'categories'];

function build(c: CachedCatalogue, origin: LoadedCatalogue['origin']): LoadedCatalogue {
  const channels = decodeChannels(JSON.parse(c.shards.channels || '[]'));
  const countries = JSON.parse(c.shards.countries || '[]') as CountryInfo[];
  const languages = JSON.parse(c.shards.languages || '[]') as LanguageInfo[];
  const categories = JSON.parse(c.shards.categories || '[]') as { id: string; name: string }[];
  const byId = new Map<string, CatalogueChannel>();
  for (const ch of channels) byId.set(ch.id, ch);
  const countryById = new Map<string, CountryInfo>();
  for (const co of countries) countryById.set(co.code, co);
  const languageName: Record<string, string> = {};
  for (const l of languages) languageName[l.code] = l.name;
  const categoryName: Record<string, string> = {};
  for (const g of categories) categoryName[g.id] = g.name;
  return {
    generatedAt: c.manifest.generatedAt,
    origin,
    channels,
    byId,
    countries,
    countryById,
    languages,
    languageName,
    categoryName,
    manifest: c.manifest,
  };
}

async function fetchCatalogue(base: string, previous?: CachedCatalogue): Promise<CachedCatalogue> {
  const manifest = await getJSON<CatalogueManifest>(`${base}manifest.json`, { timeoutMs: 15000 });
  if (!manifest || manifest.schema !== 1 || !Array.isArray(manifest.shards)) throw new Error('Unrecognised manifest');
  const shards: Record<string, string> = {};
  for (const name of SHARDS) {
    const entry = manifest.shards.filter((s) => s.name === name)[0];
    if (!entry) continue;
    const old = previous && previous.manifest.shards.filter((s) => s.name === name)[0];
    if (old && old.sha256 === entry.sha256 && previous && previous.shards[name]) {
      shards[name] = previous.shards[name]!;
    } else {
      shards[name] = await getText(`${base}${entry.file}`, { timeoutMs: 60000 });
    }
  }
  if (!shards.channels) throw new Error('Manifest has no channels shard');
  return { manifest, shards };
}

export async function loadCatalogue(remoteManifestUrl: string = __CATALOGUE_MANIFEST_URL__): Promise<void> {
  let cached: CachedCatalogue | undefined;
  try {
    cached = await idbGet<CachedCatalogue>(CACHE_KEY);
    if (cached) catalogue.value = { status: 'ready', data: build(cached, 'cache') };
  } catch (err) {
    console.warn('[fbtv] cached catalogue unreadable', err);
    cached = undefined;
  }

  if (catalogue.value.status !== 'ready') {
    try {
      const bundled = await fetchCatalogue(BUNDLED_BASE);
      catalogue.value = { status: 'ready', data: build(bundled, 'bundled') };
      cached = bundled;
    } catch (err) {
      console.warn('[fbtv] no bundled catalogue', err);
    }
  }

  if (remoteManifestUrl) {
    const base = remoteManifestUrl.replace(/manifest\.json$/, '');
    try {
      const fresh = await fetchCatalogue(base, cached);
      if (!cached || fresh.manifest.generatedAt !== cached.manifest.generatedAt) {
        await idbSet(CACHE_KEY, fresh);
        const state = catalogue.value;
        if (state.status === 'ready') catalogue.value = { ...state, updateAvailable: true };
        else catalogue.value = { status: 'ready', data: build(fresh, 'remote') };
      }
    } catch (err) {
      console.warn('[fbtv] catalogue update check failed', err);
    }
  }

  if (catalogue.value.status === 'loading') {
    catalogue.value = {
      status: 'empty',
      reason: remoteManifestUrl
        ? 'The catalogue could not be downloaded and no copy is stored on this TV.'
        : 'No catalogue is bundled with this build and no catalogue URL is configured.',
    };
  }
}

export function ready(): LoadedCatalogue | null {
  const s = catalogue.value;
  return s.status === 'ready' ? s.data : null;
}

/**
 * Channel numbers: favourites take 1…N in favourite order; every other channel is numbered
 * from 101 in catalogue order with the home country first. Numbers can shift when the
 * catalogue changes; favourites keep theirs.
 */
export function numbering(data: LoadedCatalogue): { numberOf: Map<string, number>; byNumber: Map<number, string> } {
  const numberOf = new Map<string, number>();
  const byNumber = new Map<number, string>();
  let n = 1;
  for (const id of favourites.value) {
    if (data.byId.has(id)) {
      numberOf.set(id, n);
      byNumber.set(n, id);
      n++;
    }
  }
  const home = prefs.value.homeCountry;
  const rest = data.channels.filter((c) => !numberOf.has(c.id));
  const ordered = rest.filter((c) => c.country === home).concat(rest.filter((c) => c.country !== home));
  let k = 101;
  for (const c of ordered) {
    numberOf.set(c.id, k);
    byNumber.set(k, c.id);
    k++;
  }
  return { numberOf, byNumber };
}

/**
 * TEST DATA — a tiny synthetic dataset in the iptv-org API schema. Channel names, ids and
 * URLs are invented (example.test) and are NOT real channels or working streams.
 */
import type { IptvOrgData } from '../../src/builder/iptvOrg.ts';

export const IPTVORG_FIXTURE: IptvOrgData = {
  channels: [
    { id: 'TestOne.uk', name: 'Test One', country: 'UK', categories: ['general'], alt_names: ['T1'] },
    { id: 'TestNews.uk', name: 'Test News', country: 'UK', categories: ['news'] },
    { id: 'TestSport.sa', name: 'Test Football Arabia', country: 'SA', categories: ['sports'] },
    { id: 'TestKids.us', name: 'Test Toons', country: 'US', categories: ['kids', 'animation'] },
    { id: 'KidsInName.us', name: 'Kids Word Only', country: 'US', categories: ['entertainment'] },
    { id: 'Closed.fr', name: 'Closed Channel', country: 'FR', categories: ['general'], closed: '2020-01-01' },
    { id: 'Blocked.uk', name: 'Blocked Channel', country: 'UK', categories: ['movies'] },
  ],
  feeds: [
    { channel: 'TestOne.uk', id: 'London', name: 'London', is_main: true, languages: ['eng'] },
    { channel: 'TestOne.uk', id: 'Scotland', name: 'Scotland', is_main: false, languages: ['eng'] },
    { channel: 'TestNews.uk', id: 'SD', name: 'SD', is_main: true, languages: ['eng'] },
    { channel: 'TestSport.sa', id: 'SD', name: 'SD', is_main: true, languages: ['ara'] },
    { channel: 'TestKids.us', id: 'SD', name: 'SD', is_main: true, languages: ['eng'] },
    { channel: 'KidsInName.us', id: 'SD', name: 'SD', is_main: true, languages: ['eng'] },
  ],
  streams: [
    { channel: 'TestOne.uk', feed: 'Scotland', url: 'https://cdn.example.test/one/scotland.m3u8', quality: '720p', labels: [] },
    { channel: 'TestOne.uk', feed: 'London', url: 'https://cdn.example.test/one/london.m3u8', quality: '1080p', labels: ['Geo-blocked'] },
    { channel: 'TestNews.uk', feed: 'SD', url: 'https://cdn.example.test/news.m3u8', quality: '1080p', labels: [] },
    { channel: 'TestNews.uk', feed: 'SD', url: 'http://CDN.example.test/news.m3u8', quality: '1080p', labels: [] },
    { channel: 'TestNews.uk', feed: 'SD', url: 'https://cdn.example.test/news-backup.m3u8', user_agent: 'Special/1.0' },
    { channel: 'TestSport.sa', feed: 'SD', url: 'https://cdn.example.test/sport.m3u8', quality: '2160p' },
    { channel: 'TestSport.sa', feed: 'SD', url: 'https://cdn.example.test/sport.mpd' },
    { channel: 'TestKids.us', feed: 'SD', url: 'https://cdn.example.test/kids.m3u8' },
    { channel: 'KidsInName.us', feed: 'SD', url: 'https://cdn.example.test/kidsword.m3u8' },
    { channel: 'Closed.fr', feed: null, url: 'https://cdn.example.test/closed.m3u8' },
    { channel: 'Blocked.uk', feed: null, url: 'https://cdn.example.test/blocked.m3u8' },
    { channel: null, feed: null, url: 'https://cdn.example.test/orphan.m3u8' },
    { channel: 'TestNews.uk', feed: 'SD', url: 'rtmp://cdn.example.test/live/news' },
  ],
  logos: [
    { channel: 'TestOne.uk', feed: null, in_use: true, width: 512, url: 'https://img.example.test/one.png' },
    { channel: 'TestOne.uk', feed: 'Scotland', in_use: true, width: 900, url: 'https://img.example.test/one-scot.png' },
    { channel: 'TestNews.uk', feed: null, in_use: false, width: 300, url: 'https://img.example.test/news-old.png' },
    { channel: 'TestNews.uk', feed: null, in_use: true, width: 200, url: 'https://img.example.test/news.png' },
  ],
  countries: [
    { code: 'UK', name: 'United Kingdom', flag: '🇬🇧', languages: ['eng'] },
    { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', languages: ['ara'] },
    { code: 'US', name: 'United States', flag: '🇺🇸', languages: ['eng'] },
    { code: 'FR', name: 'France', flag: '🇫🇷', languages: ['fra'] },
  ],
  languages: [
    { code: 'eng', name: 'English' },
    { code: 'ara', name: 'Arabic' },
    { code: 'fra', name: 'French' },
  ],
  categories: [
    { id: 'general', name: 'General' },
    { id: 'news', name: 'News' },
    { id: 'sports', name: 'Sports' },
    { id: 'kids', name: 'Kids' },
    { id: 'animation', name: 'Animation' },
    { id: 'entertainment', name: 'Entertainment' },
    { id: 'movies', name: 'Movies' },
  ],
  blocklist: [{ channel: 'Blocked.uk', reason: 'dmca' }],
};

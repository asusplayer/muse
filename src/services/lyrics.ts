import {inject, injectable} from 'inversify';
import got, {Got} from 'got';
import {TYPES} from '../types.js';
import KeyValueCacheProvider from './key-value-cache.js';
import type {SongMetadata} from './player-types.js';

export interface LyricLine {
  time: number;
  line: string;
}

export interface Lyrics {
  synced: LyricLine[] | null;
  plain: string | null;
}

interface LrclibTrack {
  duration: number;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
const SEARCH_DURATION_TOLERANCE_SECONDS = 5;

// YouTube titles look like "Artist - Song (Official Video) [4K] ft. X"; LRCLIB wants plain artist and track names.
export const cleanSongForLyrics = (song: Pick<SongMetadata, 'title' | 'artist'>): {artist: string; track: string} => {
  let artist = song.artist.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  let track = song.title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/\s+(ft\.?|feat\.?|featuring)\s.*$/i, '')
    .trim();

  const separator = track.indexOf(' - ');
  if (separator > 0) {
    artist = track.slice(0, separator).trim();
    track = track.slice(separator + 3).trim();
  }

  return {artist, track};
};

export const parseLrc = (lrc: string): LyricLine[] => {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    // Empty timed lines mark instrumental breaks.
    const line = raw.replace(/\[[^\]]*\]/g, '').trim() || '♪';
    for (const [, minutes, seconds] of stamps) {
      lines.push({time: (Number(minutes) * 60) + Number(seconds), line});
    }
  }

  return lines.sort((a, b) => a.time - b.time);
};

// Returns the line being sung at `position` (null before the first line) and its neighbours.
export const getLyricLinesAt = (lines: LyricLine[], position: number): {previous: string | null; current: string | null; next: string | null} => {
  const index = lines.findIndex(line => line.time > position) - 1;
  const currentIndex = index === -2 ? lines.length - 1 : index;

  return {
    previous: lines[currentIndex - 1]?.line ?? null,
    current: currentIndex >= 0 ? lines[currentIndex].line : null,
    next: lines[currentIndex + 1]?.line ?? null,
  };
};

const toLyrics = (track: LrclibTrack | undefined): Lyrics | null => {
  if (!track?.syncedLyrics && !track?.plainLyrics) {
    return null;
  }

  return {
    synced: track.syncedLyrics ? parseLrc(track.syncedLyrics) : null,
    plain: track.plainLyrics,
  };
};

@injectable()
export default class LyricsService {
  private readonly cache: KeyValueCacheProvider;
  private readonly lrclib: Got;

  constructor(@inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider) {
    this.cache = cache;
    this.lrclib = got.extend({
      prefixUrl: 'https://lrclib.net/api/',
      headers: {'user-agent': 'muse (https://github.com/museofficial/muse)'},
      timeout: {request: 10_000},
    });
  }

  async getLyrics(song: SongMetadata): Promise<Lyrics | null> {
    if (song.isLive) {
      return null;
    }

    // "Not found" is cached too, so a missing song is not looked up on every play.
    return this.cache.wrap(async () => this.fetchLyrics(song), {
      key: `lyrics:${song.source}:${song.url}`,
      expiresIn: SEVEN_DAYS_IN_SECONDS,
    });
  }

  private async fetchLyrics(song: SongMetadata): Promise<Lyrics | null> {
    const {artist, track} = cleanSongForLyrics(song);

    const exact = await this.lrclib.get('get', {
      searchParams: {artist_name: artist, track_name: track, duration: song.length},
      throwHttpErrors: false,
    });
    if (exact.statusCode === 200) {
      const lyrics = toLyrics(JSON.parse(exact.body) as LrclibTrack);
      if (lyrics) {
        return lyrics;
      }
    }

    const results = await this.lrclib.get('search', {searchParams: {q: `${artist} ${track}`}}).json<LrclibTrack[]>();
    return toLyrics(results.find(result => Math.abs(result.duration - song.length) <= SEARCH_DURATION_TOLERANCE_SECONDS
      && (result.syncedLyrics ?? result.plainLyrics)));
  }
}

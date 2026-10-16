import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({get: vi.fn()}));

vi.mock('got', () => ({default: {extend: () => ({get: mocks.get})}}));

import LyricsService, {cleanSongForLyrics, getLyricLinesAt, parseLrc} from '../src/services/lyrics.js';

const respond = (statusCode: number, data: unknown) => Object.assign(
  Promise.resolve({statusCode, body: JSON.stringify(data)}),
  {json: async () => data},
);

const song = {title: 'Daft Punk - One More Time (Official Video)', artist: 'DaftPunkVEVO', url: 'abc', length: 320, isLive: false, source: 0} as never;
const service = new LyricsService({wrap: async (fn: () => Promise<unknown>) => fn()} as never);

beforeEach(() => {
  mocks.get.mockReset();
});

describe('lyrics', () => {
  it.each([
    [{title: 'Daft Punk - One More Time (Official Video) [4K]', artist: 'DaftPunkVEVO'}, {artist: 'Daft Punk', track: 'One More Time'}],
    [{title: 'Blinding Lights ft. Someone', artist: 'The Weeknd - Topic'}, {artist: 'The Weeknd', track: 'Blinding Lights'}],
    [{title: 'Plain', artist: 'Artist'}, {artist: 'Artist', track: 'Plain'}],
  ])('cleans %o for lookup', (input, expected) => {
    expect(cleanSongForLyrics(input)).toEqual(expected);
  });

  it('parses LRC lines including repeated timestamps, sorted by time', () => {
    expect(parseLrc('[00:10.50] second\n[00:01.00][01:00.00] first\nno stamp\n[00:20.00]')).toEqual([
      {time: 1, line: 'first'},
      {time: 10.5, line: 'second'},
      {time: 20, line: '♪'},
      {time: 60, line: 'first'},
    ]);
  });

  it('picks the previous, current and next line for a position', () => {
    const lines = [{time: 5, line: 'a'}, {time: 10, line: 'b'}];

    expect(getLyricLinesAt(lines, 0)).toEqual({previous: null, current: null, next: 'a'});
    expect(getLyricLinesAt(lines, 7)).toEqual({previous: null, current: 'a', next: 'b'});
    expect(getLyricLinesAt(lines, 99)).toEqual({previous: 'a', current: 'b', next: null});
    expect(getLyricLinesAt([], 3)).toEqual({previous: null, current: null, next: null});
  });

  it('uses the exact match when LRCLIB has one', async () => {
    mocks.get.mockReturnValueOnce(respond(200, {duration: 320, plainLyrics: 'hi', syncedLyrics: '[00:01.00] hi'}));

    expect(await service.getLyrics(song)).toEqual({synced: [{time: 1, line: 'hi'}], plain: 'hi'});
    expect(mocks.get).toHaveBeenCalledWith('get', expect.objectContaining({
      searchParams: {artist_name: 'Daft Punk', track_name: 'One More Time', duration: 320},
    }));
  });

  it('falls back to search and only accepts a matching duration', async () => {
    mocks.get
      .mockReturnValueOnce(respond(404, {}))
      .mockReturnValueOnce(respond(200, [
        {duration: 200, plainLyrics: 'wrong', syncedLyrics: null},
        {duration: 323, plainLyrics: 'right', syncedLyrics: null},
      ]));

    expect(await service.getLyrics(song)).toEqual({synced: null, plain: 'right'});
  });

  it('returns null when nothing matches', async () => {
    mocks.get
      .mockReturnValueOnce(respond(404, {}))
      .mockReturnValueOnce(respond(200, [{duration: 100, plainLyrics: 'x', syncedLyrics: null}]));

    expect(await service.getLyrics(song)).toBeNull();
  });
});

import {describe, expect, it, vi} from 'vitest';

const execa = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({execa}));

import {searchYouTubeMusicSongIds} from '../src/utils/yt-dlp.js';

describe('yt-dlp entry lookups', () => {
  it('runs at most four yt-dlp processes at once, however many searches start together', async () => {
    let running = 0;
    let peak = 0;
    execa.mockImplementation(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise(resolve => {
        setTimeout(resolve, 5);
      });
      running--;
      return {stdout: JSON.stringify({entries: [{id: 'abc'}]})};
    });

    const results = await Promise.all(Array.from({length: 20}, async (_, i) => searchYouTubeMusicSongIds(`song ${i}`, 5)));

    expect(results).toEqual(Array.from({length: 20}, () => ['abc']));
    expect(execa).toHaveBeenCalledTimes(20);
    expect(peak).toBe(4);
  });
});

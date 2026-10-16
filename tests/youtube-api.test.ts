import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../src/services/player.js', () => ({
  MediaSource: {Youtube: 0},
}));

const ytDlpMocks = vi.hoisted(() => ({searchYouTubeMusicSongIds: vi.fn()}));

vi.mock('../src/utils/yt-dlp.js', () => ytDlpMocks);

import YoutubeAPI from '../src/services/youtube-api.js';

interface PlaylistItemPage {
  items: Array<{
    id: string;
    contentDetails: {videoId: string};
  }>;
  nextPageToken?: string;
}

const PLAYLIST_ID = 'playlist-id';

const makeVideo = ({
  id,
  description = '',
  duration = 'PT3M',
  title = id,
  channelTitle = 'Channel',
}: {
  id: string;
  description?: string;
  duration?: string;
  title?: string;
  channelTitle?: string;
}) => ({
  id,
  contentDetails: {
    videoId: id,
    duration,
  },
  snippet: {
    title,
    channelTitle,
    liveBroadcastContent: 'none',
    description,
    thumbnails: {
      medium: {url: `https://example.com/${id}.jpg`},
    },
  },
});

const makePlaylistItem = (videoId: string) => ({
  id: `playlist-item-${videoId}`,
  contentDetails: {videoId},
});

const makeHarness = ({
  itemCount = 0,
  pages = [],
  videos = [],
  searchIds = [],
}: {
  itemCount?: number;
  pages?: PlaylistItemPage[];
  videos?: ReturnType<typeof makeVideo>[];
  searchIds?: string[];
} = {}) => {
  const remainingPages = [...pages];
  const videoById = new Map(videos.map(video => [video.id, video]));
  let playlistItemsCallCount = 0;

  const cache = {
    wrap: vi.fn(async (
      _fetchValue: () => Promise<unknown>,
      {searchParams}: {searchParams?: Record<string, string | undefined>},
    ) => {
      if (!searchParams) {
        return _fetchValue();
      }

      if (searchParams.playlistId === PLAYLIST_ID) {
        playlistItemsCallCount++;
        const page = remainingPages.shift();
        if (!page) {
          throw new Error('playlistItems page was requested again');
        }

        return page;
      }

      if (searchParams.id === PLAYLIST_ID) {
        return {
          items: [{
            id: PLAYLIST_ID,
            contentDetails: {itemCount},
            snippet: {title: 'Playlist'},
          }],
        };
      }

      if (searchParams.q) {
        return {items: searchIds.map(videoId => ({id: {videoId}}))};
      }

      const requestedVideoIds = searchParams.id?.split(',').filter(Boolean) ?? [];
      return {
        items: requestedVideoIds
          .map(id => videoById.get(id))
          .filter((video): video is ReturnType<typeof makeVideo> => Boolean(video)),
      };
    }),
  };

  return {
    api: new YoutubeAPI({YOUTUBE_API_KEY: 'test-key'} as never, cache as never),
    cache,
    getPlaylistItemsCallCount: () => playlistItemsCallCount,
  };
};

const chapterSummary = (songs: Awaited<ReturnType<YoutubeAPI['getVideo']>>) => songs.map(song => ({
  title: song.title,
  offset: song.offset,
  length: song.length,
}));

describe('YoutubeAPI playlist pagination', () => {
  it.each([false, true])('handles an early detail rejection while another page is pending (page fails: %s)', async pageFails => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {unhandled.push(reason);};
    process.on('unhandledRejection', onUnhandled);
    const detailsError = new Error('Video details unavailable');
    const pageError = new Error('Playlist page unavailable');
    const cache = {
      wrap: async (_fetch: unknown, {searchParams}: {searchParams: Record<string, string>}) => {
        if (searchParams.playlistId) {
          if (!searchParams.pageToken) {
            return {items: [makePlaylistItem('first-video')], nextPageToken: 'page-2'};
          }
          await new Promise(resolve => setTimeout(resolve, 20));
          if (pageFails) {throw pageError;}
          return {items: []};
        }
        if (searchParams.id === PLAYLIST_ID) {
          return {items: [{id: PLAYLIST_ID, snippet: {title: 'Playlist'}}]};
        }
        throw detailsError;
      },
    };
    try {
      const api = new YoutubeAPI({YOUTUBE_API_KEY: 'test-key'} as never, cache as never);
      await expect(api.getPlaylist(PLAYLIST_ID, false)).rejects.toBe(pageFails ? pageError : detailsError);
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('retains all fetched details across pages and stops when the final page has no token', async () => {
    const firstVideo = makeVideo({id: 'video-first', title: 'First'});
    const secondVideo = makeVideo({id: 'video-second', title: 'Second'});
    const {api, getPlaylistItemsCallCount} = makeHarness({
      itemCount: 99,
      pages: [
        {items: [makePlaylistItem(firstVideo.id)], nextPageToken: 'page-2'},
        {items: [makePlaylistItem(secondVideo.id)]},
      ],
      videos: [firstVideo, secondVideo],
    });

    const songs = await api.getPlaylist(PLAYLIST_ID, false);

    expect(songs.map(song => ({title: song.title, url: song.url}))).toEqual([
      {title: 'First', url: firstVideo.id},
      {title: 'Second', url: secondVideo.id},
    ]);
    expect(songs.every(song => song.playlist?.source === PLAYLIST_ID)).toBe(true);
    expect(getPlaylistItemsCallCount()).toBe(2);
  });

  it('stops before requesting a repeated page token and retains every processed page', async () => {
    const firstVideo = makeVideo({id: 'video-first', title: 'First'});
    const secondVideo = makeVideo({id: 'video-second', title: 'Second'});
    const {api, getPlaylistItemsCallCount} = makeHarness({
      itemCount: 99,
      pages: [
        {items: [makePlaylistItem(firstVideo.id)], nextPageToken: 'page-2'},
        {items: [makePlaylistItem(secondVideo.id)], nextPageToken: 'page-2'},
      ],
      videos: [firstVideo, secondVideo],
    });

    const songs = await api.getPlaylist(PLAYLIST_ID, false);

    expect(songs.map(song => ({title: song.title, url: song.url}))).toEqual([
      {title: 'First', url: firstVideo.id},
      {title: 'Second', url: secondVideo.id},
    ]);
    expect(getPlaylistItemsCallCount()).toBe(2);
  });

  it('terminates after a truncated page without a token even when itemCount is stale', async () => {
    const onlyVideo = makeVideo({id: 'only-video', title: 'Only'});
    const {api, getPlaylistItemsCallCount} = makeHarness({
      itemCount: 50,
      pages: [{items: [makePlaylistItem(onlyVideo.id)]}],
      videos: [onlyVideo],
    });

    await expect(api.getPlaylist(PLAYLIST_ID, false)).resolves.toEqual([
      expect.objectContaining({title: 'Only', url: onlyVideo.id}),
    ]);
    expect(getPlaylistItemsCallCount()).toBe(1);
  });

  it('returns an empty playlist after one empty page without repeating the request', async () => {
    const {api, getPlaylistItemsCallCount} = makeHarness({
      itemCount: 1,
      pages: [{items: []}],
    });

    await expect(api.getPlaylist(PLAYLIST_ID, false)).resolves.toEqual([]);
    expect(getPlaylistItemsCallCount()).toBe(1);
  });
});

describe('YoutubeAPI chapter parsing', () => {
  it.each(['0:00', '00:00'])('accepts an exact %s first chapter timestamp', async start => {
    const video = makeVideo({
      id: 'chaptered01',
      duration: 'PT2M',
      title: 'Chaptered video',
      description: `${start} Intro\n1:00 Main`,
    });
    const {api} = makeHarness({videos: [video]});

    await expect(api.getVideo(video.id, true)).resolves.toHaveLength(2);
  });

  it.each(['0:00:00', '00:00:00'])('accepts an all-zero hour-form %s first chapter timestamp', async start => {
    const video = makeVideo({
      id: 'hours000001',
      duration: 'PT2M',
      title: 'Hour-form chapters',
      description: `${start} Intro\n0:01:00 Main`,
    });
    const {api} = makeHarness({videos: [video]});

    expect(chapterSummary(await api.getVideo(video.id, true))).toEqual([
      {title: 'Intro (Hour-form chapters)', offset: 0, length: 60},
      {title: 'Main (Hour-form chapters)', offset: 60, length: 60},
    ]);
  });

  it('does not treat 10:00 as a zero-start timestamp by substring', async () => {
    const video = makeVideo({
      id: 'notzero0001',
      duration: 'PT20M',
      title: 'Unsplit video',
      description: '10:00 First mention\n11:00 Second mention',
    });
    const {api} = makeHarness({videos: [video]});

    await expect(api.getVideo(video.id, true)).resolves.toEqual([
      expect.objectContaining({
        title: video.snippet.title,
        offset: 0,
        length: 1200,
      }),
    ]);
  });

  it('scans past an incidental earlier timestamp to find a later zero-start chapter block', async () => {
    const video = makeVideo({
      id: 'laterzero01',
      duration: 'PT3M',
      title: 'Chaptered video',
      description: '10:00 Preface\n0:00 Intro\n1:00 Main',
    });
    const {api} = makeHarness({videos: [video]});

    expect(chapterSummary(await api.getVideo(video.id, true))).toEqual([
      {title: 'Intro (Chaptered video)', offset: 0, length: 60},
      {title: 'Main (Chaptered video)', offset: 60, length: 120},
    ]);
  });

  it.each([
    ['descending offsets', '0:00 Intro\n1:30 Middle\n1:00 Backwards'],
    ['repeated offsets', '0:00 Intro\n1:00 Middle\n1:00 Duplicate'],
    ['an offset at the video duration', '0:00 Intro\n2:00 At end'],
    ['an offset outside the video duration', '0:00 Intro\n2:01 Too late'],
    ['an empty label', '0:00\n1:00 Main'],
  ])('falls back to the unsplit video for %s', async (_caseName, description) => {
    const video = makeVideo({
      id: 'invalid0001',
      duration: 'PT2M',
      title: 'Unsplit video',
      description,
    });
    const {api} = makeHarness({videos: [video]});

    await expect(api.getVideo(video.id, true)).resolves.toEqual([
      expect.objectContaining({
        title: video.snippet.title,
        offset: 0,
        length: 120,
      }),
    ]);
  });

  it('calculates every valid chapter length from the next offset and video duration', async () => {
    const video = makeVideo({
      id: 'valid000001',
      duration: 'PT2M',
      title: 'Chaptered video',
      description: '00:00 Intro\n0:45 Verse\n1:30 Outro',
    });
    const {api} = makeHarness({videos: [video]});

    await expect(api.getVideo(video.id, true)).resolves.toSatisfy(songs => {
      expect(chapterSummary(songs)).toEqual([
        {title: 'Intro (Chaptered video)', offset: 0, length: 45},
        {title: 'Verse (Chaptered video)', offset: 45, length: 45},
        {title: 'Outro (Chaptered video)', offset: 90, length: 30},
      ]);
      return true;
    });
  });

  it('preserves valid chapters that have duplicate non-empty labels', async () => {
    const video = makeVideo({
      id: 'duplicate01',
      duration: 'PT2M',
      title: 'Chaptered video',
      description: '0:00 Part\n0:30 Part\n1:00 Finale',
    });
    const {api} = makeHarness({videos: [video]});

    const songs = await api.getVideo(video.id, true);

    expect(chapterSummary(songs)).toEqual([
      {title: 'Part (Chaptered video)', offset: 0, length: 30},
      {title: 'Part (Chaptered video)', offset: 30, length: 30},
      {title: 'Finale (Chaptered video)', offset: 60, length: 60},
    ]);
  });
});

describe('YoutubeAPI search audio preference', () => {
  // Real results for "Perfect Strangers - Jonas Blue".
  const musicVideo = makeVideo({id: 'musicvideo1', title: 'Jonas Blue - Perfect Strangers ft. JP Cooper', channelTitle: 'JonasBlueVEVO', duration: 'PT3M28S'});
  const song = makeVideo({id: 'topicaudio1', title: 'Perfect Strangers', channelTitle: 'Jonas Blue - Topic', duration: 'PT3M17S'});
  const karaoke = makeVideo({id: 'karaokever1', title: 'Perfect Strangers (Originally Performed by Jonas Blue Feat. Jp Cooper)', channelTitle: 'Release - Topic', duration: 'PT3M18S'});
  const videos = [musicVideo, song, karaoke];

  beforeEach(() => {
    ytDlpMocks.searchYouTubeMusicSongIds.mockReset();
  });

  const searchUrls = async (query: string, preferAudio: boolean, musicIds: string[] | Error) => {
    if (musicIds instanceof Error) {
      ytDlpMocks.searchYouTubeMusicSongIds.mockRejectedValueOnce(musicIds);
    } else {
      ytDlpMocks.searchYouTubeMusicSongIds.mockResolvedValueOnce(musicIds);
    }

    const {api} = makeHarness({videos, searchIds: [musicVideo.id]});
    return (await api.search(query, false, preferAudio)).map(result => result.url);
  };

  it('takes the top YouTube Music song, keeping its order over equally matching covers', async () => {
    expect(await searchUrls('Perfect Strangers - Jonas Blue', true, [song.id, karaoke.id])).toEqual([song.id]);
  });

  it('prefers a lower song that covers more of the typed words', async () => {
    // Real results for "One More - Mark Knight Remix -Edit".
    const remix = makeVideo({id: 'onemoremix1', title: 'One More (Mark Knight Remix)', channelTitle: 'SG Lewis - Topic', duration: 'PT5M49S'});
    const edit = makeVideo({id: 'onemoreedit', title: 'One More (Mark Knight Remix Edit)', channelTitle: 'SG Lewis - Topic', duration: 'PT3M34S'});
    ytDlpMocks.searchYouTubeMusicSongIds.mockResolvedValueOnce([remix.id, edit.id]);
    const {api} = makeHarness({videos: [remix, edit]});

    expect((await api.search('One More - Mark Knight Remix -Edit', false, true)).map(result => result.url)).toEqual([edit.id]);
  });

  it.each([
    ['audio is not preferred', false, [song.id]],
    ['YouTube Music finds nothing', true, []],
    ['the song shares too few typed words', true, [karaoke.id]],
    ['YouTube Music search fails', true, new Error('yt-dlp failed')],
  ])('uses the regular YouTube search when %s', async (_label, preferAudio, musicIds) => {
    const query = preferAudio && Array.isArray(musicIds) && musicIds.length > 0 ? 'strangers in the night sinatra' : 'Perfect Strangers - Jonas Blue';

    expect(await searchUrls(query, preferAudio as boolean, musicIds as string[] | Error)).toEqual([musicVideo.id]);
  });
});

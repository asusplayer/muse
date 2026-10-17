import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  savedPlaylist: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../src/utils/db.js', () => ({prisma: {savedPlaylist: mocks.savedPlaylist}}));
vi.mock('../src/utils/get-guild-settings.js', () => ({getGuildSettings: vi.fn().mockResolvedValue({playlistLimit: 50, preferAudio: true})}));
vi.mock('../src/services/player.js', () => ({default: class {}, STATUS: {}, MediaSource: {Youtube: 0}}));

import Playlist, {parseStoredSongs} from '../src/commands/playlist.js';

const song = (title: string) => ({
  title, artist: 'Artist', url: `url-${title}`, length: 200, offset: 0, playlist: null,
  isLive: false, thumbnailUrl: null, source: 0, addedInChannelId: 'channel', requestedBy: 'user',
});

const stored = (title: string) => {
  const {addedInChannelId: _channel, requestedBy: _user, ...metadata} = song(title);
  return metadata;
};

const addSongsToQueue = vi.fn();
const player = {getCurrent: vi.fn(), getQueue: vi.fn()};
const getSongs = vi.fn();
const command = new Playlist({addSongsToQueue} as never, {get: () => player} as never, {getSongs} as never);

const run = async (subcommand: string, {name = 'mix', overwrite = null as boolean | null, userId = 'author'} = {}) => {
  const reply = vi.fn();
  await command.execute({
    guild: {id: 'guild', ownerId: 'owner'},
    member: {user: {id: userId}},
    reply,
    deferReply: vi.fn(),
    editReply: reply,
    options: {
      getSubcommand: () => subcommand,
      getString: (option: string) => option === 'url' ? ' https://open.spotify.com/playlist/abc ' : name,
      getBoolean: (option: string) => option === 'overwrite' ? overwrite : null,
    },
  } as never);
  return reply;
};

const savedRow = (songs: unknown[], authorId = 'author') => ({id: 7, guildId: 'guild', name: 'mix', authorId, songs: JSON.stringify(songs)});

beforeEach(() => {
  vi.clearAllMocks();
  player.getCurrent.mockReturnValue(song('Now'));
  player.getQueue.mockReturnValue([song('Next')]);
});

describe('/playlist', () => {
  it('saves the current song and the queue, then loads the same songs back', async () => {
    mocks.savedPlaylist.findUnique.mockResolvedValueOnce(null);
    await run('save');

    const {data} = mocks.savedPlaylist.create.mock.calls[0][0] as {data: {songs: string; authorId: string}};
    expect(data.authorId).toBe('author');
    expect(JSON.parse(data.songs)).toEqual([stored('Now'), stored('Next')]);

    mocks.savedPlaylist.findUnique.mockResolvedValueOnce({...savedRow([]), songs: data.songs});
    await run('load');
    const [{loadSongs}] = addSongsToQueue.mock.calls[0] as [{loadSongs: () => Promise<unknown>}];
    expect(await loadSongs()).toEqual([[stored('Now'), stored('Next')], '']);
  });

  it('refuses to save over an existing playlist without overwrite', async () => {
    mocks.savedPlaylist.findUnique.mockResolvedValueOnce(savedRow([]));

    await expect(run('save')).rejects.toThrow('already exists');
    expect(mocks.savedPlaylist.update).not.toHaveBeenCalled();
  });

  it.each([
    ['the author', 'author', true],
    ['the server owner', 'owner', true],
    ['someone else', 'stranger', false],
  ])('lets %s overwrite and remove a playlist: %s', async (_label, userId, allowed) => {
    mocks.savedPlaylist.findUnique.mockResolvedValue(savedRow([]));

    const overwrite = run('save', {overwrite: true, userId});
    const remove = run('remove', {userId});

    if (allowed) {
      await Promise.all([overwrite, remove]);
      expect(mocks.savedPlaylist.update).toHaveBeenCalledOnce();
      expect(mocks.savedPlaylist.delete).toHaveBeenCalledWith({where: {id: 7}});
    } else {
      await expect(overwrite).rejects.toThrow('only change your own');
      await expect(remove).rejects.toThrow('only change your own');
      expect(mocks.savedPlaylist.update).not.toHaveBeenCalled();
      expect(mocks.savedPlaylist.delete).not.toHaveBeenCalled();
    }
  });

  it('imports a playlist URL without touching the queue', async () => {
    mocks.savedPlaylist.findUnique.mockResolvedValueOnce(null);
    getSongs.mockResolvedValueOnce([[song('One'), song('Two')], '1 song was not found']);

    const reply = await run('import');

    expect(getSongs).toHaveBeenCalledWith('https://open.spotify.com/playlist/abc', 50, false, true);
    const {data} = mocks.savedPlaylist.create.mock.calls[0][0] as {data: {songs: string}};
    expect(JSON.parse(data.songs)).toEqual([stored('One'), stored('Two')]);
    expect(addSongsToQueue).not.toHaveBeenCalled();
    const [{embeds: [embed]}] = reply.mock.calls[0] as [{embeds: Array<{toJSON: () => {description: string}}>}];
    expect(embed.toJSON().description).toBe('👍 saved **mix** with 2 songs (1 song was not found)');
  });

  it('checks a taken name before looking up the import', async () => {
    mocks.savedPlaylist.findUnique.mockResolvedValueOnce(savedRow([]));

    await expect(run('import')).rejects.toThrow('already exists');
    expect(getSongs).not.toHaveBeenCalled();
  });

  it('refuses to save an empty queue', async () => {
    player.getCurrent.mockReturnValue(null);
    player.getQueue.mockReturnValue([]);

    await expect(run('save')).rejects.toThrow('nothing is playing');
  });

  it('skips broken stored entries', () => {
    expect(parseStoredSongs(JSON.stringify([stored('Good'), {title: 'missing fields'}, null]))).toEqual({songs: [stored('Good')], skipped: 2});
    expect(parseStoredSongs('not json')).toEqual({songs: [], skipped: 0});
  });
});

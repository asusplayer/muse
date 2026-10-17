import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  playHistory: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('../src/utils/db.js', () => ({prisma: {playHistory: mocks.playHistory}}));
vi.mock('../src/services/player.js', () => ({default: class {}, STATUS: {}, MediaSource: {Youtube: 0}}));
vi.mock('../src/utils/get-guild-settings.js', () => ({getGuildSettings: vi.fn()}));

import History from '../src/commands/history.js';
import {MAX_HISTORY_PER_GUILD, recordPlay} from '../src/services/play-history.js';

const song = {
  title: 'Song', artist: 'Artist', url: 'abc', source: 0, length: 200, offset: 0,
  thumbnailUrl: null, isLive: false, playlist: null, addedInChannelId: 'channel', requestedBy: 'user',
};

const entry = (id: number, title = `Song ${id}`, url = `url${id}`) => ({
  id, guildId: 'guild', title, artist: 'Artist', url, source: 0, length: 200, offset: 0,
  thumbnailUrl: null, isLive: false, requestedBy: 'user', playedAt: new Date(0),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('play history', () => {
  it(`keeps only the newest ${MAX_HISTORY_PER_GUILD} plays per guild`, async () => {
    mocks.playHistory.findFirst.mockResolvedValueOnce({id: 42});

    await recordPlay('guild', song);

    expect(mocks.playHistory.create).toHaveBeenCalledWith({data: expect.objectContaining({guildId: 'guild', title: 'Song', requestedBy: 'user'})});
    expect(mocks.playHistory.findFirst).toHaveBeenCalledWith(expect.objectContaining({skip: MAX_HISTORY_PER_GUILD - 1}));
    expect(mocks.playHistory.deleteMany).toHaveBeenCalledWith({where: {guildId: 'guild', id: {lt: 42}}});
  });

  it('deletes nothing while the history is short', async () => {
    mocks.playHistory.findFirst.mockResolvedValueOnce(null);

    await recordPlay('guild', song);

    expect(mocks.playHistory.deleteMany).not.toHaveBeenCalled();
  });
});

describe('/history', () => {
  const addSongsToQueue = vi.fn();
  const command = new History({addSongsToQueue} as never);

  const interaction = (focused: string, song?: string) => {
    const respond = vi.fn();
    return {
      respond,
      interaction: {
        guild: {id: 'guild'},
        respond,
        options: {
          getFocused: () => focused,
          getString: () => song,
          getBoolean: () => null,
          getSubcommand: () => 'play',
        },
      } as never,
    };
  };

  it('suggests each song once, filtered by the typed text', async () => {
    mocks.playHistory.findMany.mockResolvedValueOnce([entry(3, 'Alge', 'a'), entry(2, 'Katsching', 'b'), entry(1, 'Alge', 'a')]);
    const {interaction: autocomplete, respond} = interaction('');

    await command.handleAutocompleteInteraction(autocomplete);
    expect(respond).toHaveBeenCalledWith([{name: 'Alge — Artist', value: '3'}, {name: 'Katsching — Artist', value: '2'}]);

    mocks.playHistory.findMany.mockResolvedValueOnce([entry(3, 'Alge', 'a'), entry(2, 'Katsching', 'b')]);
    const {interaction: filtered, respond: filteredRespond} = interaction('kats');
    await command.handleAutocompleteInteraction(filtered);
    expect(filteredRespond).toHaveBeenCalledWith([{name: 'Katsching — Artist', value: '2'}]);
  });

  it('queues the chosen song again', async () => {
    mocks.playHistory.findMany.mockResolvedValueOnce([entry(3)]);

    await command.execute(interaction('', '3').interaction);

    const [{loadSongs}] = addSongsToQueue.mock.calls[0] as [{loadSongs: () => Promise<unknown>}];
    expect(await loadSongs()).toEqual([[expect.objectContaining({title: 'Song 3', url: 'url3', playlist: null})], '']);
  });

  it('rejects a song that is no longer in the history', async () => {
    mocks.playHistory.findMany.mockResolvedValueOnce([entry(3)]);

    await expect(command.execute(interaction('', '99').interaction)).rejects.toThrow('no longer in the history');
    expect(addSongsToQueue).not.toHaveBeenCalled();
  });
});

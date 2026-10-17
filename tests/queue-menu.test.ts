import 'reflect-metadata';
import {describe, expect, it, vi} from 'vitest';
import type {StringSelectMenuInteraction} from 'discord.js';

vi.mock('../src/services/player.js', () => ({
  default: class {},
  STATUS: {PLAYING: 0, PAUSED: 1, IDLE: 2},
  MediaSource: {Youtube: 0, HLS: 1, SoundCloud: 2},
  DEFAULT_VOLUME: 100,
}));

vi.mock('../src/utils/get-guild-settings.js', () => ({
  getGuildSettings: vi.fn().mockResolvedValue({defaultQueuePageSize: 10}),
}));

import Queue, {buildQueueMenus, QUEUE_MENU_IDS} from '../src/commands/queue.js';

const makeSong = (index: number) => ({
  title: `Song ${index}`, artist: 'Artist', url: `video${index}`, length: 120, offset: 0, playlist: null,
  isLive: false, thumbnailUrl: null, source: 0, addedInChannelId: 'channel', requestedBy: 'requester',
});

// A player over a real array, so remove/move change what the next render shows.
const makePlayer = (count: number) => {
  const queue = [makeSong(1), ...Array.from({length: count}, (_, i) => makeSong(i + 2))];
  return {
    queue,
    status: 1, loopCurrentSong: false, loopCurrentQueue: false,
    getCurrent: () => queue[0],
    getQueue: () => queue.slice(1),
    queueSize: () => queue.length - 1,
    getPosition: () => 0,
    getVolume: () => 100,
    getVoiceChannelId: () => 'voice-id',
    removeFromQueue: vi.fn((index: number) => queue.splice(index, 1)),
    move: vi.fn((from: number, to: number) => queue.splice(to, 0, queue.splice(from, 1)[0])),
    refreshNowPlayingMessage: vi.fn().mockResolvedValue(undefined),
  };
};

type Menu = {components: Array<{custom_id: string; options: Array<{label: string; value: string}>}>};

const select = async (player: ReturnType<typeof makePlayer>, customId: string, menus: Menu[], label: string, userChannelId = 'voice-id') => {
  const {options} = menus[0].components[0];
  const option = options.find(candidate => candidate.label === label)!;
  const update = vi.fn().mockResolvedValue(undefined);
  const followUp = vi.fn().mockResolvedValue(undefined);
  const interaction = {
    customId,
    guildId: 'guild-id',
    guild: {voiceStates: {cache: new Map([['user-id', {channelId: userChannelId}]])}},
    user: {id: 'user-id'},
    values: [option.value],
    component: {options},
    update,
    followUp,
  } as unknown as StringSelectMenuInteraction;

  await new Queue({get: () => player} as never).handleSelectMenuInteraction(interaction);
  return {update, followUp};
};

describe('/queue select menus', () => {
  it('offers the songs of the shown page and nothing for an empty queue', () => {
    expect(buildQueueMenus(makePlayer(0) as never, 1, 10)).toEqual([]);

    const menus = buildQueueMenus(makePlayer(12) as never, 2, 10) as unknown as Menu[];
    expect(menus.map(menu => menu.components[0].custom_id)).toEqual([QUEUE_MENU_IDS.playNext, QUEUE_MENU_IDS.remove]);
    expect(menus[0].components[0].options.map(option => option.label)).toEqual(['11. Song 12', '12. Song 13']);
  });

  it('removes the picked song and redraws the queue', async () => {
    const player = makePlayer(3);
    const menus = buildQueueMenus(player as never, 1, 10) as unknown as Menu[];

    const {update} = await select(player, QUEUE_MENU_IDS.remove, menus, '2. Song 3');

    expect(player.getQueue().map(song => song.title)).toEqual(['Song 2', 'Song 4']);
    const [{components}] = update.mock.calls[0] as [{components: Menu[]}];
    expect(components[0].components[0].options.map(option => option.label)).toEqual(['1. Song 2', '2. Song 4']);
  });

  it('moves the picked song to the front', async () => {
    const player = makePlayer(3);
    await select(player, QUEUE_MENU_IDS.playNext, buildQueueMenus(player as never, 1, 10) as unknown as Menu[], '3. Song 4');

    expect(player.getQueue().map(song => song.title)).toEqual(['Song 4', 'Song 2', 'Song 3']);
  });

  it('refuses to touch the queue when it changed since the menu was drawn', async () => {
    const player = makePlayer(3);
    const menus = buildQueueMenus(player as never, 1, 10) as unknown as Menu[];
    player.queue.splice(1, 1);

    const {followUp} = await select(player, QUEUE_MENU_IDS.remove, menus, '2. Song 3');

    expect(player.removeFromQueue).not.toHaveBeenCalled();
    expect(followUp).toHaveBeenCalledWith(expect.objectContaining({ephemeral: true}));
  });

  it('rejects members outside the bot voice channel', async () => {
    const player = makePlayer(2);
    const menus = buildQueueMenus(player as never, 1, 10) as unknown as Menu[];

    await expect(select(player, QUEUE_MENU_IDS.remove, menus, '1. Song 2', 'other')).rejects.toThrow('join my voice channel');
    expect(player.removeFromQueue).not.toHaveBeenCalled();
  });
});

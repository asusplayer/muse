import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  getGuildSettings: vi.fn(),
}));

vi.mock('../src/utils/get-guild-settings.js', () => ({
  getGuildSettings: mocks.getGuildSettings,
}));

import {assertCanSkipMultiple, castSkipVote, requiredVotes, SkipVotes} from '../src/services/vote-skip.js';

const LISTENERS = ['a', 'b', 'c', 'd'];

const makePlayer = (entryId: number | null = 1) => {
  const player = {
    entryId,
    skipVotes: new SkipVotes(),
    getCurrent: vi.fn(() => ({requestedBy: 'requester'})),
    getCurrentQueueEntryId: vi.fn(() => player.entryId),
    getVoiceChannelId: vi.fn(() => 'voice-id'),
  };
  return player;
};

type FakePlayer = ReturnType<typeof makePlayer>;

const members = (ids: string[]) => {
  const list = [...ids.map(id => ({id, user: {bot: false}})), {id: 'bot', user: {bot: true}}];
  return {filter: (fn: (m: typeof list[number]) => boolean) => list.filter(fn)};
};

const vote = async (player: FakePlayer, userId: string, {admin = false, listeners = LISTENERS, roles = [] as string[]} = {}) => castSkipVote({
  guildId: 'guild',
  user: {id: userId},
  member: {roles},
  memberPermissions: {has: () => admin},
  guild: {channels: {cache: new Map([['voice-id', {isVoiceBased: () => true, members: members(listeners)}]])}},
} as never, player as never);

beforeEach(() => {
  mocks.getGuildSettings.mockResolvedValue({voteSkip: true, voteSkipPercent: 50});
});

describe('vote skip', () => {
  it.each([
    [1, 50, 1],
    [3, 50, 2],
    [4, 50, 2],
    [5, 100, 5],
    [0, 50, 1],
  ])('needs ceil(%i listeners × %i%%) = %i votes', (listeners, percent, expected) => {
    expect(requiredVotes(listeners, percent)).toBe(expected);
  });

  it('skips once enough distinct listeners voted, counting repeat votes once', async () => {
    const player = makePlayer();

    expect(await vote(player, 'a')).toEqual({kind: 'vote', votes: 1, required: 2});
    expect(await vote(player, 'a')).toEqual({kind: 'vote', votes: 1, required: 2});
    expect(await vote(player, 'b')).toEqual({kind: 'skip'});
  });

  it('starts over when the song changes', async () => {
    const player = makePlayer();
    await vote(player, 'a');

    player.entryId = 2;

    expect(await vote(player, 'b')).toEqual({kind: 'vote', votes: 1, required: 2});
  });

  it('ignores votes from members who left the channel', async () => {
    const player = makePlayer();
    await vote(player, 'a');

    expect(await vote(player, 'b', {listeners: ['b', 'c', 'd']})).toEqual({kind: 'vote', votes: 1, required: 2});
  });

  it.each([
    ['the requester', 'requester', false],
    ['an admin', 'a', true],
  ])('lets %s skip right away', async (_label, userId, admin) => {
    expect(await vote(makePlayer(), userId, {admin})).toEqual({kind: 'skip'});
  });

  it('skips right away when vote skip is off', async () => {
    mocks.getGuildSettings.mockResolvedValue({voteSkip: false, voteSkipPercent: 50});

    expect(await vote(makePlayer(), 'a')).toEqual({kind: 'skip'});
  });

  it('makes everyone without the DJ role vote, even with vote skip off', async () => {
    mocks.getGuildSettings.mockResolvedValue({voteSkip: false, voteSkipPercent: 50, djRoleId: 'dj'});

    expect(await vote(makePlayer(), 'a')).toEqual({kind: 'vote', votes: 1, required: 2});
    expect(await vote(makePlayer(), 'b', {roles: ['dj']})).toEqual({kind: 'skip'});
    expect(await vote(makePlayer(), 'requester')).toEqual({kind: 'skip'});
    expect(await vote(makePlayer(), 'c', {admin: true})).toEqual({kind: 'skip'});
  });

  it('rejects votes from members outside the voice channel', async () => {
    await expect(vote(makePlayer(), 'stranger')).rejects.toThrow('you need to be listening in my voice channel to vote');
  });

  it('only lets the requester or an admin skip several songs', async () => {
    const interaction = (userId: string) => ({guildId: 'guild', user: {id: userId}, memberPermissions: {has: () => false}}) as never;

    await expect(assertCanSkipMultiple(interaction('a'), makePlayer() as never)).rejects.toThrow('only the requester, a DJ or an admin');
    await expect(assertCanSkipMultiple(interaction('requester'), makePlayer() as never)).resolves.toBeUndefined();
  });
});

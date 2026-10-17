import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ButtonStyle} from 'discord.js';
import type {ButtonInteraction} from 'discord.js';

vi.mock('../src/services/player.js', () => ({
  default: class {},
  STATUS: {PLAYING: 0, PAUSED: 1, IDLE: 2},
  MediaSource: {Youtube: 0, HLS: 1, SoundCloud: 2},
  DEFAULT_VOLUME: 100,
}));

vi.mock('../src/utils/get-guild-settings.js', () => ({
  getGuildSettings: vi.fn().mockResolvedValue({voteSkip: false, voteSkipPercent: 50}),
}));

import NowPlaying from '../src/commands/now-playing.js';
import {getGuildSettings} from '../src/utils/get-guild-settings.js';
import {buildPlayerControls, PLAYER_BUTTON_IDS} from '../src/utils/build-embed.js';

const STATUS = {PLAYING: 0, PAUSED: 1, IDLE: 2} as const;

const makePlayer = (overrides: Record<string, unknown> = {}) => ({
  status: STATUS.PLAYING as number,
  loopCurrentSong: false,
  loopCurrentQueue: false,
  canGoBack: vi.fn(() => true),
  isQueueEmpty: vi.fn(() => false),
  queueSize: vi.fn(() => 2),
  getCurrent: vi.fn(() => ({title: 'Song'})),
  getVoiceChannelId: vi.fn(() => 'voice-id'),
  getCurrentQueueEntryId: vi.fn(() => 1),
  getConfiguredVolume: vi.fn(() => 50),
  isAutoplayEnabled: vi.fn(() => false),
  autoplay: null as boolean | null,
  back: vi.fn().mockResolvedValue(undefined),
  forward: vi.fn().mockResolvedValue(undefined),
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  stop: vi.fn(),
  shuffle: vi.fn(),
  setVolume: vi.fn(),
  refreshNowPlayingMessage: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

type FakePlayer = ReturnType<typeof makePlayer>;

const makeInteraction = (customId: string, userChannelId: string | null = 'voice-id') => {
  const reply = vi.fn().mockResolvedValue(undefined);
  const deferUpdate = vi.fn().mockResolvedValue(undefined);
  const followUp = vi.fn().mockResolvedValue(undefined);
  const voiceStates = new Map(userChannelId ? [['user-id', {channelId: userChannelId}]] : []);
  const interaction = {
    customId,
    guildId: 'guild-id',
    guild: {voiceStates: {cache: voiceStates}},
    user: {id: 'user-id'},
    reply,
    deferUpdate,
    followUp,
  } as unknown as ButtonInteraction;

  return {interaction, reply, deferUpdate, followUp};
};

const press = async (player: FakePlayer, customId: string, userChannelId?: string | null) => {
  const command = new NowPlaying({get: () => player} as never);
  const handles = makeInteraction(customId, userChannelId);
  await command.handleButtonInteraction(handles.interaction);
  return handles;
};

type ButtonJson = {custom_id: string; disabled?: boolean; style: number; emoji?: {name?: string}};

const buttonsOf = (player: FakePlayer) => buildPlayerControls(player as never)
  .flatMap(row => row.components as unknown as ButtonJson[]);

const button = (player: FakePlayer, customId: string) => buttonsOf(player).find(b => b.custom_id === customId)!;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('player control buttons', () => {
  it('registers every rendered button with the now-playing command', () => {
    const command = new NowPlaying({} as never);
    const rendered = buttonsOf(makePlayer()).map(b => b.custom_id);

    expect([...rendered].sort()).toEqual([...command.handledButtonIds].sort());
  });

  it('reflects playback state in the rendered buttons', () => {
    const playing = makePlayer();
    expect(button(playing, PLAYER_BUTTON_IDS.playPause).emoji?.name).toBe('⏸️');
    expect(button(playing, PLAYER_BUTTON_IDS.loop).style).toBe(ButtonStyle.Secondary);

    const paused = makePlayer({
      status: STATUS.PAUSED,
      loopCurrentSong: true,
      canGoBack: vi.fn(() => false),
      isQueueEmpty: vi.fn(() => true),
    });
    expect(button(paused, PLAYER_BUTTON_IDS.playPause).emoji?.name).toBe('▶️');
    expect(button(paused, PLAYER_BUTTON_IDS.loop)).toMatchObject({style: ButtonStyle.Success, emoji: {name: '🔂'}});
    expect(button(paused, PLAYER_BUTTON_IDS.previous).disabled).toBe(true);
    expect(button(paused, PLAYER_BUTTON_IDS.shuffle).disabled).toBe(true);
  });

  it.each([
    ['outside any voice channel', null],
    ['in a different voice channel', 'other-voice'],
  ])('rejects presses from a member %s', async (_label, channelId) => {
    const player = makePlayer();
    const {reply, deferUpdate} = await press(player, PLAYER_BUTTON_IDS.skip, channelId);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ephemeral: true}));
    expect(deferUpdate).not.toHaveBeenCalled();
    expect(player.forward).not.toHaveBeenCalled();
  });

  it('rejects presses when the bot is not connected', async () => {
    const player = makePlayer({getVoiceChannelId: vi.fn(() => undefined)});
    const {reply} = await press(player, PLAYER_BUTTON_IDS.stop);

    expect(reply).toHaveBeenCalled();
    expect(player.stop).not.toHaveBeenCalled();
  });

  it.each([
    [PLAYER_BUTTON_IDS.previous, 'back'],
    [PLAYER_BUTTON_IDS.skip, 'forward'],
    [PLAYER_BUTTON_IDS.stop, 'stop'],
    [PLAYER_BUTTON_IDS.shuffle, 'shuffle'],
  ] as const)('%s calls player.%s and refreshes the message', async (customId, method) => {
    const player = makePlayer();
    const {deferUpdate} = await press(player, customId);

    expect(deferUpdate).toHaveBeenCalledOnce();
    expect(player[method]).toHaveBeenCalledOnce();
    expect(player.refreshNowPlayingMessage).toHaveBeenCalledOnce();
  });

  it('toggles between pause and resume', async () => {
    const playing = makePlayer();
    await press(playing, PLAYER_BUTTON_IDS.playPause);
    expect(playing.pause).toHaveBeenCalledOnce();
    expect(playing.play).not.toHaveBeenCalled();

    const paused = makePlayer({status: STATUS.PAUSED});
    await press(paused, PLAYER_BUTTON_IDS.playPause);
    expect(paused.play).toHaveBeenCalledOnce();
  });

  it('cycles loop off -> song -> queue -> off', async () => {
    const player = makePlayer();

    await press(player, PLAYER_BUTTON_IDS.loop);
    expect([player.loopCurrentSong, player.loopCurrentQueue]).toEqual([true, false]);
    await press(player, PLAYER_BUTTON_IDS.loop);
    expect([player.loopCurrentSong, player.loopCurrentQueue]).toEqual([false, true]);
    await press(player, PLAYER_BUTTON_IDS.loop);
    expect([player.loopCurrentSong, player.loopCurrentQueue]).toEqual([false, false]);
  });

  it('skips queue loop when nothing is queued', async () => {
    const player = makePlayer({loopCurrentSong: true, queueSize: vi.fn(() => 0)});

    await press(player, PLAYER_BUTTON_IDS.loop);

    expect([player.loopCurrentSong, player.loopCurrentQueue]).toEqual([false, false]);
  });

  it('steps volume by 10 and clamps to 0-100', async () => {
    const player = makePlayer({getConfiguredVolume: vi.fn(() => 95)});
    await press(player, PLAYER_BUTTON_IDS.volumeUp);
    expect(player.setVolume).toHaveBeenCalledWith(100);

    const quiet = makePlayer({getConfiguredVolume: vi.fn(() => 5)});
    await press(quiet, PLAYER_BUTTON_IDS.volumeDown);
    expect(quiet.setVolume).toHaveBeenCalledWith(0);
  });

  it('toggles autoplay for the session and shows it on the button', async () => {
    const player = makePlayer();
    expect(button(player, PLAYER_BUTTON_IDS.autoplay).style).toBe(ButtonStyle.Secondary);

    await press(player, PLAYER_BUTTON_IDS.autoplay);
    expect(player.autoplay).toBe(true);

    const enabled = makePlayer({isAutoplayEnabled: vi.fn(() => true)});
    expect(button(enabled, PLAYER_BUTTON_IDS.autoplay).style).toBe(ButtonStyle.Success);
    await press(enabled, PLAYER_BUTTON_IDS.autoplay);
    expect(enabled.autoplay).toBe(false);
  });

  it('lets only DJs use the controls once a DJ role is set, but everyone can vote to skip', async () => {
    vi.mocked(getGuildSettings).mockResolvedValue({voteSkip: false, voteSkipPercent: 50, djRoleId: 'dj-role'} as never);
    const player = makePlayer();

    const {followUp} = await press(player, PLAYER_BUTTON_IDS.stop);
    expect(player.stop).not.toHaveBeenCalled();
    expect(followUp).toHaveBeenCalledWith(expect.objectContaining({ephemeral: true}));

    // Non-DJs go through the vote instead of skipping straight away.
    await press(player, PLAYER_BUTTON_IDS.skip);
    expect(player.forward).not.toHaveBeenCalled();

    vi.mocked(getGuildSettings).mockResolvedValue({voteSkip: false, voteSkipPercent: 50} as never);
  });

  it('reports failures privately without touching the shared message content', async () => {
    const player = makePlayer({back: vi.fn().mockRejectedValue(new Error('No songs in queue to go back to.'))});
    const {followUp} = await press(player, PLAYER_BUTTON_IDS.previous);

    expect(followUp).toHaveBeenCalledOnce();
    const [payload] = followUp.mock.calls[0] as [{ephemeral: boolean; embeds: Array<{toJSON: () => {description: string}}>}];
    expect(payload.ephemeral).toBe(true);
    expect(payload.embeds[0].toJSON().description).toBe('🚫 ope: no song to go back to');
    expect(player.refreshNowPlayingMessage).toHaveBeenCalledOnce();
  });
});

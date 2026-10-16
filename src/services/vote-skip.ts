import {ButtonInteraction, ChatInputCommandInteraction, PermissionFlagsBits} from 'discord.js';
import type {Setting} from '@prisma/client';
import type Player from './player.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import messages from '../messages.js';

type SkipInteraction = ChatInputCommandInteraction | ButtonInteraction;

export type SkipVoteOutcome = {kind: 'skip'} | {kind: 'vote'; votes: number; required: number};

export const requiredVotes = (listeners: number, percent: number) => Math.max(1, Math.ceil(listeners * percent / 100));

// Votes belong to one queue entry; voting on a new entry starts over.
export class SkipVotes {
  private entryId: number | null = null;
  private readonly voters = new Set<string>();

  add(entryId: number, userId: string): void {
    if (entryId !== this.entryId) {
      this.entryId = entryId;
      this.voters.clear();
    }

    this.voters.add(userId);
  }

  countAmong(entryId: number, listenerIds: ReadonlySet<string>): number {
    if (entryId !== this.entryId) {
      return 0;
    }

    return [...this.voters].filter(id => listenerIds.has(id)).length;
  }
}

const canSkipWithoutVote = (interaction: SkipInteraction, player: Player, settings: Setting) => (
  !settings.voteSkip
  || player.getCurrent()?.requestedBy === interaction.user.id
  || Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
);

const getListenerIds = (interaction: SkipInteraction, player: Player): Set<string> => {
  const channelId = player.getVoiceChannelId();
  const channel = channelId ? interaction.guild?.channels.cache.get(channelId) : undefined;
  if (!channel?.isVoiceBased()) {
    return new Set();
  }

  return new Set(channel.members.filter(member => !member.user.bot).map(member => member.id));
};

export const castSkipVote = async (interaction: SkipInteraction, player: Player): Promise<SkipVoteOutcome> => {
  const settings = await getGuildSettings(interaction.guildId!);
  const entryId = player.getCurrentQueueEntryId();
  if (entryId === null || canSkipWithoutVote(interaction, player, settings)) {
    return {kind: 'skip'};
  }

  const listenerIds = getListenerIds(interaction, player);
  if (!listenerIds.has(interaction.user.id)) {
    throw new Error(messages.voteSkip.notListening);
  }

  player.skipVotes.add(entryId, interaction.user.id);
  const votes = player.skipVotes.countAmong(entryId, listenerIds);
  const required = requiredVotes(listenerIds.size, settings.voteSkipPercent);

  return votes >= required ? {kind: 'skip'} : {kind: 'vote', votes, required};
};

export const assertCanSkipMultiple = async (interaction: SkipInteraction, player: Player): Promise<void> => {
  const settings = await getGuildSettings(interaction.guildId!);
  if (!canSkipWithoutVote(interaction, player, settings)) {
    throw new Error(messages.voteSkip.multipleNeedsPermission);
  }
};

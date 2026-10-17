import {ChatInputCommandInteraction, Interaction, PermissionFlagsBits} from 'discord.js';
import type {Setting} from '@prisma/client';
import {getGuildSettings} from './get-guild-settings.js';
import messages from '../messages.js';

// Without a DJ role everyone controls playback; with one, only its members and server managers do.
export const isDJ = (interaction: Interaction, settings: Pick<Setting, 'djRoleId'>): boolean => {
  if (!settings.djRoleId || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }

  // Uncached members arrive as raw API data with plain role ids.
  const roles = interaction.member?.roles;
  return Array.isArray(roles) ? roles.includes(settings.djRoleId) : Boolean(roles?.cache.has(settings.djRoleId));
};

export const assertDJ = async (interaction: Interaction): Promise<void> => {
  if (!isDJ(interaction, await getGuildSettings(interaction.guildId!))) {
    throw new Error(messages.errors.djOnly);
  }
};

// Queueing stays open to everyone; skipping the current track along with it does not.
export const wantsToSkipCurrentTrack = (interaction: ChatInputCommandInteraction) => interaction.options.getBoolean('skip') ?? false;

import {
  ActionRowBuilder,
  APIActionRowComponent,
  APIMessageActionRowComponent,
  ChatInputCommandInteraction,
  MessageActionRowComponentBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Player, {QueuedSong} from '../services/player.js';
import Command from './index.js';
import {buildErrorEmbed, buildQueueEmbed} from '../utils/build-embed.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {getDisplayTitle} from '../utils/song-title.js';
import {truncate} from '../utils/string.js';
import {errorText} from '../utils/error-text.js';
import {assertDJ} from '../utils/dj.js';
import messages from '../messages.js';

export const QUEUE_MENU_IDS = {
  remove: 'queue:remove',
  playNext: 'queue:play-next',
} as const;

// Discord allows at most 25 options per select menu.
const MAX_MENU_OPTIONS = 25;

const songOptionLabel = (song: QueuedSong, position: number) => truncate(`${position}. ${getDisplayTitle(song)}`, 100);

// Options carry the position plus the page to redraw; the label double-checks the song is still there.
export const buildQueueMenus = (player: Player, page: number, pageSize: number): Array<APIActionRowComponent<APIMessageActionRowComponent>> => {
  const start = (page - 1) * pageSize;
  const options = player.getQueue()
    .slice(start, start + Math.min(pageSize, MAX_MENU_OPTIONS))
    .map((song, index) => ({label: songOptionLabel(song, start + index + 1), value: `${start + index + 1}:${page}:${pageSize}`}));

  if (options.length === 0) {
    return [];
  }

  const menu = (customId: string, placeholder: string) => new ActionRowBuilder<MessageActionRowComponentBuilder>()
    .addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(options))
    .toJSON() as unknown as APIActionRowComponent<APIMessageActionRowComponent>;

  return [menu(QUEUE_MENU_IDS.playNext, messages.queue.playNextPlaceholder), menu(QUEUE_MENU_IDS.remove, messages.queue.removePlaceholder)];
};

const renderQueue = (player: Player, page: number, pageSize: number) => {
  const lastPage = Math.max(1, Math.ceil(player.queueSize() / pageSize));
  const shownPage = Math.min(page, lastPage);
  return {embeds: [buildQueueEmbed(player, shownPage, pageSize)], components: buildQueueMenus(player, shownPage, pageSize)};
};

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('queue')
    .setDescription('show the current queue')
    .addIntegerOption(option => option
      .setName('page')
      .setDescription('page of queue to show [default: 1]')
      .setMinValue(1)
      .setRequired(false))
    .addIntegerOption(option => option
      .setName('page-size')
      .setDescription('how many items to display per page [default: 10, max: 30]')
      .setMinValue(1)
      .setMaxValue(30)
      .setRequired(false));

  public readonly handledSelectMenuIds = Object.values(QUEUE_MENU_IDS);

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;
    const player = this.playerManager.get(guildId);

    const pageSizeFromOptions = interaction.options.getInteger('page-size');
    const pageSize = pageSizeFromOptions ?? (await getGuildSettings(guildId)).defaultQueuePageSize;
    const page = interaction.options.getInteger('page') ?? 1;

    const embed = buildQueueEmbed(player, page, pageSize);

    await interaction.reply({embeds: [embed], components: buildQueueMenus(player, page, pageSize)});
  }

  public async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guildId!);
    const botChannelId = player.getVoiceChannelId();
    if (!botChannelId || interaction.guild?.voiceStates.cache.get(interaction.user.id)?.channelId !== botChannelId) {
      throw new Error(messages.playerControls.notInBotChannel);
    }

    await assertDJ(interaction);

    const [value] = interaction.values;
    const [position, page, pageSize] = value.split(':').map(Number);
    const chosenLabel = interaction.component.options.find(option => option.value === value)?.label;
    const song = player.getQueue()[position - 1];

    if (!song || songOptionLabel(song, position) !== chosenLabel) {
      await interaction.update(renderQueue(player, page, pageSize));
      await interaction.followUp({embeds: [buildErrorEmbed(errorText(messages.queue.changed))], ephemeral: true});
      return;
    }

    if (interaction.customId === QUEUE_MENU_IDS.remove) {
      player.removeFromQueue(position);
    } else {
      player.move(position, 1);
    }

    await interaction.update(renderQueue(player, page, pageSize));
    await player.refreshNowPlayingMessage();
  }
}

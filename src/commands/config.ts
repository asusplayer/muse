import {SlashCommandBuilder} from '@discordjs/builders';
import {ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits} from 'discord.js';
import {inject, injectable} from 'inversify';
import {prisma} from '../utils/db.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {buildMessageEmbed} from '../utils/build-embed.js';
import messages from '../messages.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('config')
    .setDescription('configure bot settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand(subcommand => subcommand
      .setName('set-playlist-limit')
      .setDescription('set the maximum number of tracks that can be added from a playlist')
      .addIntegerOption(option => option
        .setName('limit')
        .setDescription('maximum number of tracks')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-wait-after-queue-empties')
      .setDescription('set the time to wait before leaving the voice channel when queue empties')
      .addIntegerOption(option => option
        .setName('delay')
        .setDescription('delay in seconds (set to 0 to never leave)')
        .setRequired(true)
        .setMinValue(0)))
    .addSubcommand(subcommand => subcommand
      .setName('set-leave-if-no-listeners')
      .setDescription('set whether to leave when all other participants leave')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether to leave when everyone else leaves')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-queue-add-response-hidden')
      .setDescription('set whether bot responses to queue additions are only displayed to the requester')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether bot responses to queue additions are only displayed to the requester')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-reduce-vol-when-voice')
      .setDescription('set whether to turn down the volume when people speak')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether to turn down the volume when people speak')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-reduce-vol-when-voice-target')
      .setDescription('set the target volume when people speak')
      .addIntegerOption(option => option
        .setName('volume')
        .setDescription('volume percentage (0 is muted, 100 is max & default)')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-auto-announce-next-song')
      .setDescription('set whether to announce the next song in the queue automatically')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether to announce the next song in the queue automatically')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-persistent-now-playing')
      .setDescription('set whether to keep a now playing message updated in the request channel')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether to keep a now playing message updated in the request channel')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-default-volume')
      .setDescription('set default volume used when entering the voice channel')
      .addIntegerOption(option => option
        .setName('level')
        .setDescription('volume percentage (0 is muted, 100 is max & default)')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-default-queue-page-size')
      .setDescription('set the default page size of the /queue command')
      .addIntegerOption(option => option
        .setName('page-size')
        .setDescription('page size of the /queue command')
        .setMinValue(1)
        .setMaxValue(30)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-vote-skip')
      .setDescription('set whether skipping requires votes from listeners')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether skipping requires votes (requester and admins can always skip)')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-vote-skip-percent')
      .setDescription('set the share of listeners needed to skip a song')
      .addIntegerOption(option => option
        .setName('percent')
        .setDescription('percentage of listeners in the voice channel')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-now-playing-lyrics')
      .setDescription('set whether the now playing message shows synced lyrics')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether the now playing message shows synced lyrics')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-prefer-audio')
      .setDescription('set whether searches prefer the YouTube Music audio version over the music video')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether searches prefer the YouTube Music audio version')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-autoplay')
      .setDescription('set whether similar songs play automatically when the queue ends')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether similar songs play automatically when the queue ends')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-dj-role')
      .setDescription('limit playback controls to a role; leave empty so everyone controls playback')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('role allowed to control playback')))
    .addSubcommand(subcommand => subcommand
      .setName('get')
      .setDescription('show all settings'));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  // eslint-disable-next-line complexity
  async execute(interaction: ChatInputCommandInteraction) {
    // Ensure guild settings exist before trying to update
    await getGuildSettings(interaction.guild!.id);

    switch (interaction.options.getSubcommand()) {
      case 'set-playlist-limit': {
        const limit: number = interaction.options.getInteger('limit')!;

        if (limit < 1) {
          throw new Error(messages.config.invalidLimit);
        }

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            playlistLimit: limit,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.limitUpdated)]});

        break;
      }

      case 'set-wait-after-queue-empties': {
        const delay = interaction.options.getInteger('delay')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            secondsToWaitAfterQueueEmpties: delay,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.waitDelayUpdated)]});

        break;
      }

      case 'set-leave-if-no-listeners': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            leaveIfNoListeners: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.leaveSettingUpdated)]});

        break;
      }

      case 'set-queue-add-response-hidden': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            queueAddResponseEphemeral: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.queueAddNotificationUpdated)]});

        break;
      }

      case 'set-auto-announce-next-song': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            autoAnnounceNextSong: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.autoAnnounceUpdated)]});

        break;
      }

      case 'set-persistent-now-playing': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            persistentNowPlayingMessage: value,
          },
        });

        if (!value) {
          await this.playerManager.get(interaction.guild!.id).clearNowPlayingMessage();
        }

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.persistentNowPlayingMessageUpdated)]});

        break;
      }

      case 'set-default-volume': {
        const value = interaction.options.getInteger('level')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            defaultVolume: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.volumeSettingUpdated)]});

        break;
      }

      case 'set-default-queue-page-size': {
        const value = interaction.options.getInteger('page-size')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            defaultQueuePageSize: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.defaultQueuePageSizeUpdated)]});

        break;
      }

      case 'set-reduce-vol-when-voice': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            turnDownVolumeWhenPeopleSpeak: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.turnDownVolumeUpdated)]});

        break;
      }

      case 'set-reduce-vol-when-voice-target': {
        const value = interaction.options.getInteger('volume')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            turnDownVolumeWhenPeopleSpeakTarget: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.turnDownVolumeTargetUpdated)]});

        break;
      }

      case 'set-vote-skip': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            voteSkip: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.voteSkipUpdated)]});

        break;
      }

      case 'set-vote-skip-percent': {
        const value = interaction.options.getInteger('percent')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            voteSkipPercent: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.voteSkipPercentUpdated)]});

        break;
      }

      case 'set-now-playing-lyrics': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            nowPlayingLyrics: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.nowPlayingLyricsUpdated)]});

        break;
      }

      case 'set-prefer-audio': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            preferAudio: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.preferAudioUpdated)]});

        break;
      }

      case 'set-autoplay': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            autoplay: value,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.autoplayUpdated)]});

        break;
      }

      case 'set-dj-role': {
        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            djRoleId: interaction.options.getRole('role')?.id ?? null,
          },
        });

        await interaction.reply({embeds: [buildMessageEmbed(messages.config.djRoleUpdated)]});

        break;
      }

      case 'get': {
        const embed = new EmbedBuilder().setTitle(messages.config.title);

        const config = await getGuildSettings(interaction.guild!.id);

        const settingsToShow = {
          [messages.config.labels.playlistLimit]: config.playlistLimit,
          [messages.config.labels.waitBeforeLeave]: config.secondsToWaitAfterQueueEmpties === 0
            ? 'never leave'
            : `${config.secondsToWaitAfterQueueEmpties}s`,
          [messages.config.labels.leaveIfNoListeners]: config.leaveIfNoListeners ? messages.common.yes : messages.common.no,
          [messages.config.labels.autoAnnounceNextSong]: config.autoAnnounceNextSong ? messages.common.yes : messages.common.no,
          [messages.config.labels.persistentNowPlayingMessage]: config.persistentNowPlayingMessage ? messages.common.yes : messages.common.no,
          [messages.config.labels.queueAddResponseEphemeral]: config.queueAddResponseEphemeral ? messages.common.yes : messages.common.no,
          [messages.config.labels.defaultVolume]: config.defaultVolume,
          [messages.config.labels.defaultQueuePageSize]: config.defaultQueuePageSize,
          [messages.config.labels.turnDownVolumeWhenPeopleSpeak]: config.turnDownVolumeWhenPeopleSpeak ? messages.common.yes : messages.common.no,
          [messages.config.labels.turnDownVolumeWhenPeopleSpeakTarget]: config.turnDownVolumeWhenPeopleSpeakTarget,
          [messages.config.labels.voteSkip]: config.voteSkip ? messages.common.yes : messages.common.no,
          [messages.config.labels.voteSkipPercent]: `${config.voteSkipPercent}%`,
          [messages.config.labels.nowPlayingLyrics]: config.nowPlayingLyrics ? messages.common.yes : messages.common.no,
          [messages.config.labels.preferAudio]: config.preferAudio ? messages.common.yes : messages.common.no,
          [messages.config.labels.autoplay]: config.autoplay ? messages.common.yes : messages.common.no,
          [messages.config.labels.djRole]: config.djRoleId ? `<@&${config.djRoleId}>` : messages.common.noDjRole,
        };

        let description = '';
        for (const [key, value] of Object.entries(settingsToShow)) {
          description += `**${key}**: ${value}\n`;
        }

        embed.setDescription(description);

        await interaction.reply({embeds: [embed]});

        break;
      }

      default:
        throw new Error(messages.errors.unknownSubcommand);
    }
  }
}

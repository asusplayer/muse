import {ButtonInteraction, ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Player, {STATUS} from '../services/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {buildErrorEmbed, buildMessageEmbed, buildPlayingMessageEmbed, PLAYER_BUTTON_IDS} from '../utils/build-embed.js';
import {errorText} from '../utils/error-text.js';
import {castSkipVote} from '../services/vote-skip.js';
import messages from '../messages.js';

const VOLUME_STEP = 10;

const clampVolume = (level: number) => Math.min(100, Math.max(0, level));

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('now-playing')
    .setDescription('shows the currently played song');

  public readonly handledButtonIds = Object.values(PLAYER_BUTTON_IDS);

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (!player.getCurrent()) {
      throw new Error(messages.nowPlaying.nothingPlaying);
    }

    await interaction.reply({
      embeds: [buildPlayingMessageEmbed(player)],
    });
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guildId!);
    const botChannelId = player.getVoiceChannelId();
    const userChannelId = interaction.guild?.voiceStates.cache.get(interaction.user.id)?.channelId;

    if (!botChannelId || userChannelId !== botChannelId) {
      await interaction.reply({
        embeds: [buildErrorEmbed(errorText(messages.playerControls.notInBotChannel))],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      await this.runControl(interaction, player);
    } catch (error: unknown) {
      // Never let bot.ts replace the shared player message with an error.
      await interaction.followUp({
        embeds: [buildErrorEmbed(errorText(error as Error))],
        ephemeral: true,
      }).catch(() => undefined);
    }

    await player.refreshNowPlayingMessage();
  }

  private async runControl(interaction: ButtonInteraction, player: Player): Promise<void> {
    switch (interaction.customId) {
      case PLAYER_BUTTON_IDS.previous:
        try {
          await player.back();
        } catch (error: unknown) {
          if (error instanceof Error && error.message === 'No songs in queue to go back to.') {
            throw new Error(messages.unskip.noSongToGoBack);
          }

          throw error;
        }

        break;
      case PLAYER_BUTTON_IDS.playPause:
        if (player.status === STATUS.PLAYING) {
          player.pause();
        } else if (player.getCurrent()) {
          await player.play();
        } else {
          throw new Error(messages.resume.nothingToPlay);
        }

        break;
      case PLAYER_BUTTON_IDS.skip: {
        const outcome = await castSkipVote(interaction, player);
        if (outcome.kind === 'vote') {
          await interaction.followUp({embeds: [buildMessageEmbed(messages.voteSkip.voteCounted(outcome.votes, outcome.required))]});
          break;
        }

        try {
          await player.forward(1);
        } catch (error: unknown) {
          if (error instanceof Error && error.message === 'No songs in queue to forward to.') {
            throw new Error(messages.errors.noSongToSkip);
          }

          throw error;
        }

        break;
      }

      case PLAYER_BUTTON_IDS.stop:
        player.stop();
        break;
      case PLAYER_BUTTON_IDS.loop:
        this.cycleLoop(player);
        break;
      case PLAYER_BUTTON_IDS.shuffle:
        if (player.isQueueEmpty()) {
          throw new Error(messages.shuffle.notEnoughSongs);
        }

        player.shuffle();
        break;
      case PLAYER_BUTTON_IDS.volumeDown:
        player.setVolume(clampVolume(player.getConfiguredVolume() - VOLUME_STEP));
        break;
      case PLAYER_BUTTON_IDS.volumeUp:
        player.setVolume(clampVolume(player.getConfiguredVolume() + VOLUME_STEP));
        break;
      case PLAYER_BUTTON_IDS.autoplay:
        player.autoplay = !player.isAutoplayEnabled();
        break;
      default:
        break;
    }
  }

  // Cycles off -> song -> queue -> off, skipping queue loop when nothing is queued.
  private cycleLoop(player: Player): void {
    if (player.loopCurrentSong) {
      player.loopCurrentSong = false;
      player.loopCurrentQueue = player.queueSize() >= 1;
    } else if (player.loopCurrentQueue) {
      player.loopCurrentQueue = false;
    } else {
      player.loopCurrentSong = true;
    }
  }
}

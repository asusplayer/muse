import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {buildMessageEmbed, buildPlayingMessageEmbed} from '../utils/build-embed.js';
import messages from '../messages.js';
import {assertCanSkipMultiple, castSkipVote} from '../services/vote-skip.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('skip')
    .setDescription('skip the next songs')
    .addIntegerOption(option => option
      .setName('number')
      .setDescription('number of songs to skip [default: 1]')
      .setRequired(false));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const numToSkip = interaction.options.getInteger('number') ?? 1;

    if (numToSkip < 1) {
      throw new Error(messages.skip.invalidNumber);
    }

    const player = this.playerManager.get(interaction.guild!.id);

    if (numToSkip > 1) {
      await assertCanSkipMultiple(interaction, player);
    } else {
      const outcome = await castSkipVote(interaction, player);
      if (outcome.kind === 'vote') {
        await interaction.reply({embeds: [buildMessageEmbed(messages.voteSkip.voteCounted(outcome.votes, outcome.required))]});
        return;
      }
    }

    await interaction.deferReply({ephemeral: true});

    try {
      await player.forward(numToSkip);
      await interaction.followUp({
        embeds: [buildMessageEmbed(messages.skip.success), ...(player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [])],
      });
      await interaction.deleteReply().catch(() => undefined);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'No songs in queue to forward to.') {
        throw new Error(messages.errors.noSongToSkip);
      }

      throw error;
    }
  }
}

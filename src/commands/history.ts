import {SlashCommandBuilder} from '@discordjs/builders';
import {APIEmbedField, AutocompleteInteraction, ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import {Pagination} from 'pagination.djs';
import Command from './index.js';
import {wantsToSkipCurrentTrack} from '../utils/dj.js';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import {getHistory, toSongMetadata} from '../services/play-history.js';
import {TYPES} from '../types.js';
import {buildMessageEmbed} from '../utils/build-embed.js';
import {truncate} from '../utils/string.js';
import messages from '../messages.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const ENTRIES_PER_PAGE = 10;

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('history')
    .setDescription('songs played recently on this server')
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('list recently played songs'))
    .addSubcommand(subcommand => subcommand
      .setName('play')
      .setDescription('play a recently played song again')
      .addStringOption(option => option
        .setName('song')
        .setDescription('recently played song')
        .setRequired(true)
        .setAutocomplete(true))
      .addBooleanOption(option => option
        .setName('immediate')
        .setDescription('add track to the front of the queue'))
      .addBooleanOption(option => option
        .setName('skip')
        .setDescription('skip the currently playing track')));

  requiresDJ = wantsToSkipCurrentTrack;

  constructor(@inject(TYPES.Services.AddQueryToQueue) private readonly addQueryToQueue: AddQueryToQueue) {
  }

  requiresVC = (interaction: ChatInputCommandInteraction) => interaction.options.getSubcommand() === 'play';

  async execute(interaction: ChatInputCommandInteraction) {
    switch (interaction.options.getSubcommand()) {
      case 'list':
        await this.list(interaction);
        break;
      case 'play':
        await this.play(interaction);
        break;
      default:
        throw new Error(messages.errors.unknownSubcommand);
    }
  }

  async handleAutocompleteInteraction(interaction: AutocompleteInteraction) {
    const query = interaction.options.getFocused().trim().toLowerCase();
    const history = await getHistory(interaction.guild!.id);

    const seen = new Set<string>();
    const choices = [];
    for (const entry of history) {
      const name = truncate(`${entry.title} — ${entry.artist}`, 100);
      // The same song is often played several times; offer it once.
      const key = `${entry.source}:${entry.url}:${entry.offset}`;
      if (seen.has(key) || (query && !name.toLowerCase().includes(query))) {
        continue;
      }

      seen.add(key);
      choices.push({name, value: String(entry.id)});
      if (choices.length === MAX_AUTOCOMPLETE_CHOICES) {
        break;
      }
    }

    await interaction.respond(choices);
  }

  private async list(interaction: ChatInputCommandInteraction) {
    const history = await getHistory(interaction.guild!.id);

    if (history.length === 0) {
      await interaction.reply({embeds: [buildMessageEmbed(messages.history.empty)], ephemeral: true});
      return;
    }

    const fields: APIEmbedField[] = history.map(entry => ({
      inline: false,
      name: truncate(entry.title, 256),
      value: `${truncate(entry.artist, 100)} · <t:${Math.floor(entry.playedAt.getTime() / 1000)}:R> · <@${entry.requestedBy}>`,
    }));

    await new Pagination(
      interaction as ChatInputCommandInteraction<'cached'>,
      {ephemeral: true, limit: ENTRIES_PER_PAGE})
      .setTitle(messages.history.title)
      .setFields(fields)
      .paginateFields(true)
      .render();
  }

  private async play(interaction: ChatInputCommandInteraction) {
    const id = Number(interaction.options.getString('song')!);
    const entry = (await getHistory(interaction.guild!.id)).find(candidate => candidate.id === id);

    if (!entry) {
      throw new Error(messages.history.notFound);
    }

    await this.addQueryToQueue.addSongsToQueue({
      interaction,
      loadSongs: async () => [[toSongMetadata(entry)], ''],
      shuffleAdditions: false,
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      skipCurrentTrack: interaction.options.getBoolean('skip') ?? false,
    });
  }
}

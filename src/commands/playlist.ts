import {SlashCommandBuilder} from '@discordjs/builders';
import {APIEmbedField, AutocompleteInteraction, ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import {Pagination} from 'pagination.djs';
import type {SavedPlaylist} from '@prisma/client';
import Command from './index.js';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import PlayerManager from '../managers/player.js';
import type {SongMetadata} from '../services/player.js';
import {TYPES} from '../types.js';
import {prisma} from '../utils/db.js';
import {buildMessageEmbed} from '../utils/build-embed.js';
import messages from '../messages.js';

const MAX_NAME_LENGTH = 100;

const toStoredSong = ({title, artist, url, length, offset, playlist, isLive, thumbnailUrl, source}: SongMetadata): SongMetadata => ({
  title, artist, url, length, offset, playlist, isLive, thumbnailUrl, source,
});

const isStoredSong = (value: unknown): value is SongMetadata => {
  const song = value as Partial<SongMetadata> | null;
  return typeof song === 'object' && song !== null
    && typeof song.title === 'string'
    && typeof song.artist === 'string'
    && typeof song.url === 'string'
    && typeof song.length === 'number'
    && typeof song.offset === 'number'
    && typeof song.isLive === 'boolean'
    && typeof song.source === 'number'
    && (song.thumbnailUrl === null || typeof song.thumbnailUrl === 'string');
};

// Rows are stored JSON, so a broken or hand-edited entry is skipped instead of failing the whole load.
export const parseStoredSongs = (json: string): {songs: SongMetadata[]; skipped: number} => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {songs: [], skipped: 0};
  }

  const entries = Array.isArray(parsed) ? parsed as unknown[] : [];
  const songs = entries.filter(isStoredSong).map(song => ({...song, playlist: song.playlist ?? null}));
  return {songs, skipped: entries.length - songs.length};
};

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('save the queue as a server playlist and load it later')
    .addSubcommand(subcommand => subcommand
      .setName('save')
      .setDescription('save the current song and the queue as a playlist')
      .addStringOption(option => option
        .setName('name')
        .setDescription('name of the playlist')
        .setMaxLength(MAX_NAME_LENGTH)
        .setRequired(true))
      .addBooleanOption(option => option
        .setName('overwrite')
        .setDescription('replace an existing playlist with this name')))
    .addSubcommand(subcommand => subcommand
      .setName('load')
      .setDescription('add a saved playlist to the queue')
      .addStringOption(option => option
        .setName('name')
        .setDescription('name of the playlist')
        .setRequired(true)
        .setAutocomplete(true))
      .addBooleanOption(option => option
        .setName('shuffle')
        .setDescription('shuffle the songs'))
      .addBooleanOption(option => option
        .setName('immediate')
        .setDescription('add the songs to the front of the queue')))
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('list saved playlists'))
    .addSubcommand(subcommand => subcommand
      .setName('remove')
      .setDescription('remove a saved playlist')
      .addStringOption(option => option
        .setName('name')
        .setDescription('name of the playlist')
        .setRequired(true)
        .setAutocomplete(true)));

  constructor(
    @inject(TYPES.Services.AddQueryToQueue) private readonly addQueryToQueue: AddQueryToQueue,
    @inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager,
  ) {
  }

  requiresVC = (interaction: ChatInputCommandInteraction) => interaction.options.getSubcommand() === 'load';

  async execute(interaction: ChatInputCommandInteraction) {
    switch (interaction.options.getSubcommand()) {
      case 'save':
        await this.save(interaction);
        break;
      case 'load':
        await this.load(interaction);
        break;
      case 'list':
        await this.list(interaction);
        break;
      case 'remove':
        await this.remove(interaction);
        break;
      default:
        throw new Error(messages.errors.unknownSubcommand);
    }
  }

  async handleAutocompleteInteraction(interaction: AutocompleteInteraction) {
    const query = interaction.options.getFocused().trim().toLowerCase();
    let playlists = await prisma.savedPlaylist.findMany({where: {guildId: interaction.guild!.id}, orderBy: {name: 'asc'}});

    playlists = playlists.filter(playlist => playlist.name.toLowerCase().startsWith(query));
    if (interaction.options.getSubcommand() === 'remove') {
      playlists = playlists.filter(playlist => this.canChange(interaction.member!.user.id, interaction.guild!.ownerId, playlist));
    }

    await interaction.respond(playlists.slice(0, 25).map(playlist => ({name: playlist.name, value: playlist.name})));
  }

  private canChange(userId: string, ownerId: string, playlist: SavedPlaylist) {
    return playlist.authorId === userId || userId === ownerId;
  }

  private async find(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();
    return prisma.savedPlaylist.findUnique({where: {guildId_name: {guildId: interaction.guild!.id, name}}});
  }

  private async save(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();
    const player = this.playerManager.get(interaction.guild!.id);
    const current = player.getCurrent();
    const songs = [...(current ? [current] : []), ...player.getQueue()].map(toStoredSong);

    if (songs.length === 0) {
      throw new Error(messages.playlist.nothingToSave);
    }

    const existing = await this.find(interaction);
    if (existing) {
      if (!interaction.options.getBoolean('overwrite')) {
        throw new Error(messages.playlist.alreadyExists);
      }

      if (!this.canChange(interaction.member!.user.id, interaction.guild!.ownerId, existing)) {
        throw new Error(messages.playlist.onlyOwnPlaylists);
      }

      await prisma.savedPlaylist.update({where: {id: existing.id}, data: {songs: JSON.stringify(songs)}});
    } else {
      await prisma.savedPlaylist.create({
        data: {guildId: interaction.guild!.id, name, authorId: interaction.member!.user.id, songs: JSON.stringify(songs)},
      });
    }

    await interaction.reply({embeds: [buildMessageEmbed(messages.playlist.saved(name, songs.length))]});
  }

  private async load(interaction: ChatInputCommandInteraction) {
    const playlist = await this.find(interaction);
    if (!playlist) {
      throw new Error(messages.playlist.notFound);
    }

    const {songs, skipped} = parseStoredSongs(playlist.songs);

    await this.addQueryToQueue.addSongsToQueue({
      interaction,
      loadSongs: async () => [songs, skipped > 0 ? messages.playlist.skippedBroken(skipped) : ''],
      shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      skipCurrentTrack: false,
    });
  }

  private async list(interaction: ChatInputCommandInteraction) {
    const playlists = await prisma.savedPlaylist.findMany({where: {guildId: interaction.guild!.id}, orderBy: {name: 'asc'}});

    if (playlists.length === 0) {
      await interaction.reply({embeds: [buildMessageEmbed(messages.playlist.noneYet)], ephemeral: true});
      return;
    }

    const fields: APIEmbedField[] = playlists.map(playlist => ({
      inline: false,
      name: playlist.name,
      value: `${messages.playlist.songCount(parseStoredSongs(playlist.songs).songs.length)} · <@${playlist.authorId}>`,
    }));

    await new Pagination(
      interaction as ChatInputCommandInteraction<'cached'>,
      {ephemeral: true, limit: 25})
      .setFields(fields)
      .paginateFields(true)
      .render();
  }

  private async remove(interaction: ChatInputCommandInteraction) {
    const playlist = await this.find(interaction);
    if (!playlist) {
      throw new Error(messages.playlist.notFound);
    }

    if (!this.canChange(interaction.member!.user.id, interaction.guild!.ownerId, playlist)) {
      throw new Error(messages.playlist.onlyOwnPlaylists);
    }

    await prisma.savedPlaylist.delete({where: {id: playlist.id}});

    await interaction.reply({embeds: [buildMessageEmbed(messages.playlist.removed)]});
  }
}

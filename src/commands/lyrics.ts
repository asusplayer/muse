import {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import {Pagination} from 'pagination.djs';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import LyricsService from '../services/lyrics.js';
import Command from './index.js';
import {chunk} from '../utils/arrays.js';
import {truncate} from '../utils/string.js';
import {getDisplayTitle} from '../utils/song-title.js';
import messages from '../messages.js';

const LINES_PER_PAGE = 40;
const MAX_DESCRIPTION_LENGTH = 4096;

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('show the lyrics of the current song');

  private readonly playerManager: PlayerManager;
  private readonly lyrics: LyricsService;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager, @inject(TYPES.Services.Lyrics) lyrics: LyricsService) {
    this.playerManager = playerManager;
    this.lyrics = lyrics;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const song = this.playerManager.get(interaction.guild!.id).getCurrent();
    if (!song) {
      throw new Error(messages.nowPlaying.nothingPlaying);
    }

    await interaction.deferReply({ephemeral: true});

    const lyrics = await this.lyrics.getLyrics(song);
    const text = lyrics?.plain ?? lyrics?.synced?.map(line => line.line).join('\n');
    if (!text?.trim()) {
      throw new Error(messages.lyrics.notFound);
    }

    const pages = chunk(text.split('\n'), LINES_PER_PAGE)
      .map(lines => truncate(lines.join('\n'), MAX_DESCRIPTION_LENGTH));

    await new Pagination(interaction as ChatInputCommandInteraction<'cached'>, {ephemeral: true})
      .setTitle(truncate(messages.lyrics.title(getDisplayTitle(song)), 256))
      .setDescriptions(pages)
      .render();
  }
}

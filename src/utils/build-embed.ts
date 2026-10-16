import getYouTubeID from 'get-youtube-id';
import {
  ActionRowBuilder,
  APIActionRowComponent,
  APIMessageActionRowComponent,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageActionRowComponentBuilder,
} from 'discord.js';
import Player, {MediaSource, QueuedSong, STATUS} from '../services/player.js';
import getProgressBar from './get-progress-bar.js';
import {prettyTime} from './time.js';
import {truncate} from './string.js';
import messages from '../messages.js';
import {getLyricLinesAt} from '../services/lyrics.js';

const getMaxSongTitleLength = (title: string) => {
  // eslint-disable-next-line no-control-regex
  const nonASCII = /[^\x00-\x7F]+/;
  return nonASCII.test(title) ? 28 : 48;
};

const getSongTitle = ({title, url, offset, source}: QueuedSong, shouldTruncate = false) => {
  if (source === MediaSource.HLS) {
    return `[${title}](${url})`;
  }

  const cleanSongTitle = title.replace(/\[.*\]/, '').trim();

  const songTitle = shouldTruncate ? truncate(cleanSongTitle, getMaxSongTitleLength(cleanSongTitle)) : cleanSongTitle;
  if (source === MediaSource.SoundCloud) {
    const soundCloudTitle = truncate(songTitle, 256);
    // Keep long share parameters in the playable URL without overflowing Discord embeds.
    return url.length > 1024 ? soundCloudTitle : `[${soundCloudTitle}](${url})`;
  }

  const youtubeId = url.length === 11 ? url : getYouTubeID(url) ?? '';

  return `[${songTitle}](https://www.youtube.com/watch?v=${youtubeId}${offset === 0 ? '' : '&t=' + String(offset)})`;
};

const getQueueInfo = (player: Player) => {
  const queueSize = player.queueSize();
  if (queueSize === 0) {
    return '-';
  }

  return queueSize === 1 ? '1 song' : `${queueSize} songs`;
};

const getPlayerUI = (player: Player) => {
  const song = player.getCurrent();

  if (!song) {
    return '';
  }

  const position = player.getPosition();
  const button = player.status === STATUS.PLAYING ? '⏹️' : '▶️';
  const progressBar = getProgressBar(10, position / song.length);
  const elapsedTime = song.isLive ? 'live' : `${prettyTime(position)}/${prettyTime(song.length)}`;
  const loop = player.loopCurrentSong ? '🔂' : player.loopCurrentQueue ? '🔁' : '';
  const vol: string = typeof player.getVolume() === 'number' ? `${player.getVolume()!}%` : '';
  return `${button} ${progressBar} \`[${elapsedTime}]\`🔉 ${vol} ${loop}`;
};

const UP_NEXT_PREVIEW_SIZE = 3;
const EMBED_FIELD_VALUE_LIMIT = 1024;

// The message is edited about once a second and Discord needs a moment to show it,
// so lyrics shown at the exact position trail the audio; looking ahead compensates.
const LYRICS_LEAD_SECONDS = 1.5;

const getUpNextPreview = (player: Player): string | null => {
  const queue = player.getQueue();
  if (queue.length === 0) {
    return null;
  }

  const lines = queue.slice(0, UP_NEXT_PREVIEW_SIZE).map((song, index) => {
    const duration = song.isLive ? 'live' : prettyTime(song.length);
    return `\`${index + 1}.\` ${getSongTitle(song, true)} \`[${duration}]\``;
  });

  const remaining = queue.length - lines.length;
  const moreLine = remaining > 0 ? messages.nowPlaying.moreInQueue(remaining) : '';
  let value = '';
  for (const line of lines) {
    const candidate = value === '' ? line : `${value}\n${line}`;
    if (candidate.length + moreLine.length + 1 > EMBED_FIELD_VALUE_LIMIT) {
      break;
    }

    value = candidate;
  }

  if (value === '') {
    value = truncate(queue[0].title, EMBED_FIELD_VALUE_LIMIT - moreLine.length - 1);
  }

  return moreLine === '' ? value : `${value}\n${moreLine}`;
};

export const PLAYER_BUTTON_IDS = {
  previous: 'np:previous',
  playPause: 'np:play-pause',
  skip: 'np:skip',
  stop: 'np:stop',
  loop: 'np:loop',
  shuffle: 'np:shuffle',
  volumeDown: 'np:volume-down',
  volumeUp: 'np:volume-up',
} as const;

const controlButton = (customId: string, emoji: string, options: {disabled?: boolean; active?: boolean} = {}) =>
  new ButtonBuilder()
    .setCustomId(customId)
    .setEmoji(emoji)
    .setStyle(options.active ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setDisabled(options.disabled ?? false);

// Serialized to JSON: the installed discord.js builders and message types disagree on API type versions.
export const buildPlayerControls = (player: Player): Array<APIActionRowComponent<APIMessageActionRowComponent>> => {
  const loopEmoji = player.loopCurrentSong ? '🔂' : '🔁';

  const rows = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      controlButton(PLAYER_BUTTON_IDS.previous, '⏮️', {disabled: !player.canGoBack()}),
      controlButton(PLAYER_BUTTON_IDS.playPause, player.status === STATUS.PLAYING ? '⏸️' : '▶️'),
      controlButton(PLAYER_BUTTON_IDS.skip, '⏭️'),
      controlButton(PLAYER_BUTTON_IDS.stop, '⏹️'),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      controlButton(PLAYER_BUTTON_IDS.loop, loopEmoji, {active: player.loopCurrentSong || player.loopCurrentQueue}),
      controlButton(PLAYER_BUTTON_IDS.shuffle, '🔀', {disabled: player.isQueueEmpty()}),
      controlButton(PLAYER_BUTTON_IDS.volumeDown, '🔉'),
      controlButton(PLAYER_BUTTON_IDS.volumeUp, '🔊'),
    ),
  ];

  return rows.map(row => row.toJSON() as unknown as APIActionRowComponent<APIMessageActionRowComponent>);
};

export const buildMessageEmbed = (description: string): EmbedBuilder =>
  new EmbedBuilder().setColor('DarkGreen').setDescription(description);

export const buildErrorEmbed = (description: string): EmbedBuilder =>
  new EmbedBuilder().setColor('DarkRed').setDescription(description);

export const buildPlayingMessageEmbed = (player: Player): EmbedBuilder => {
  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error(messages.queue.noPlayingSong);
  }

  const {artist, thumbnailUrl, requestedBy} = currentlyPlaying;
  const message = new EmbedBuilder();
  message
    .setColor(player.status === STATUS.PLAYING ? 'DarkGreen' : 'DarkRed')
    .setTitle(player.status === STATUS.PLAYING ? 'Now Playing' : 'Paused')
    .setDescription(`
      **${getSongTitle(currentlyPlaying)}**
      Requested by: <@${requestedBy}>\n
      ${getPlayerUI(player)}
    `)
    .setFooter({text: `Source: ${artist}`});

  const lyricLines = player.getCurrentLyrics()?.synced;
  if (lyricLines?.length) {
    const {previous, current, next} = getLyricLinesAt(lyricLines, player.getPlaybackPosition() + (currentlyPlaying.offset ?? 0) + LYRICS_LEAD_SECONDS);
    message.addFields({name: messages.nowPlaying.lyrics, value: truncate([previous, `**${current ?? '♪'}**`, next].filter(Boolean).join('\n'), 1024)});
  }

  const upNext = getUpNextPreview(player);
  if (upNext) {
    message.addFields({name: messages.nowPlaying.upNext, value: upNext});
  }

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};

export const buildQueueEmbed = (player: Player, page: number, pageSize: number): EmbedBuilder => {
  if (page < 1) {
    throw new Error('page must be at least 1');
  }

  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error(messages.queue.empty);
  }

  const queueSize = player.queueSize();
  const maxQueuePage = Math.max(1, Math.ceil(queueSize / pageSize));

  if (page > maxQueuePage) {
    throw new Error(messages.queue.tooBig);
  }

  const queuePageBegin = (page - 1) * pageSize;
  const queuePageEnd = queuePageBegin + pageSize;
  const queuedSongs = player
    .getQueue()
    .slice(queuePageBegin, queuePageEnd)
    .map((song, index) => {
      const songNumber = index + 1 + queuePageBegin;
      const duration = song.isLive ? 'live' : prettyTime(song.length);

      return `\`${songNumber}.\` ${getSongTitle(song, true)} \`[${duration}]\``;
    });

  const {artist, thumbnailUrl, playlist, requestedBy} = currentlyPlaying;
  const playlistTitle = playlist ? `(${playlist.title})` : '';
  const totalLength = player.getQueue().reduce((accumulator, current) => accumulator + current.length, 0);

  const message = new EmbedBuilder();

  let description = `**${getSongTitle(currentlyPlaying)}**\n`;
  description += `Requested by: <@${requestedBy}>\n\n`;
  description += `${getPlayerUI(player)}\n\n`;

  if (player.getQueue().length > 0) {
    description += '**Up next:**\n';
    for (const [index, song] of queuedSongs.entries()) {
      // Leave room for a useful hint instead of rejecting the entire /queue response.
      const overflowMessage = `… ${queuedSongs.length - index} more on this page; use a smaller page-size to view them.`;
      if (description.length + song.length + 1 + overflowMessage.length > 4096) {
        description += overflowMessage;
        break;
      }

      description += `${song}\n`;
    }
  }

  message
    .setTitle(player.status === STATUS.PLAYING ? `Now Playing ${player.loopCurrentSong ? '(loop on)' : ''}` : 'Queued songs')
    .setColor(player.status === STATUS.PLAYING ? 'DarkGreen' : 'NotQuiteBlack')
    .setDescription(description)
    .addFields([{name: 'In queue', value: getQueueInfo(player), inline: true}, {
      name: 'Total length', value: `${totalLength > 0 ? prettyTime(totalLength) : '-'}`, inline: true,
    }, {name: 'Page', value: `${page} out of ${maxQueuePage}`, inline: true}])
    .setFooter({text: `Source: ${artist} ${playlistTitle}`});

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};

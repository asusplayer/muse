import type {PlayHistory} from '@prisma/client';
import {prisma} from '../utils/db.js';
import type {QueuedSong, SongMetadata} from './player-types.js';

export const MAX_HISTORY_PER_GUILD = 200;

export const recordPlay = async (guildId: string, song: QueuedSong): Promise<void> => {
  await prisma.playHistory.create({
    data: {
      guildId,
      title: song.title,
      artist: song.artist,
      url: song.url,
      source: song.source,
      length: song.length,
      offset: song.offset,
      thumbnailUrl: song.thumbnailUrl,
      isLive: song.isLive,
      requestedBy: song.requestedBy,
    },
  });

  const oldestKept = await prisma.playHistory.findFirst({
    where: {guildId},
    orderBy: {id: 'desc'},
    skip: MAX_HISTORY_PER_GUILD - 1,
    select: {id: true},
  });
  if (oldestKept) {
    await prisma.playHistory.deleteMany({where: {guildId, id: {lt: oldestKept.id}}});
  }
};

export const getHistory = async (guildId: string, limit = MAX_HISTORY_PER_GUILD): Promise<PlayHistory[]> => prisma.playHistory.findMany({
  where: {guildId},
  orderBy: {id: 'desc'},
  take: limit,
});

export const toSongMetadata = (entry: PlayHistory): SongMetadata => ({
  title: entry.title,
  artist: entry.artist,
  url: entry.url,
  source: entry.source,
  length: entry.length,
  offset: entry.offset,
  thumbnailUrl: entry.thumbnailUrl,
  isLive: entry.isLive,
  playlist: null,
});

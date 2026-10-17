import type {SongMetadata} from '../services/player-types.js';

// YouTube Music "Topic" uploads name the artist only in the channel, so add it to the shown title.
export const getDisplayTitle = ({title, artist}: Pick<SongMetadata, 'title' | 'artist'>): string => {
  const topicArtist = artist.replace(/\s+-\s+Topic$/i, '');
  return topicArtist !== artist && !title.toLowerCase().includes(topicArtist.toLowerCase()) ? `${topicArtist} - ${title}` : title;
};

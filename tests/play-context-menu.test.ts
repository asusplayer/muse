import 'reflect-metadata';
import {describe, expect, it} from 'vitest';
import Play, {getQueryFromMessage} from '../src/commands/play.js';
import {getCommandBodies} from '../src/utils/register-commands-on-guild.js';

const message = (content: string, embedUrls: Array<string | null> = []) => ({content, embeds: embedUrls.map(url => ({url}))}) as never;

describe('Play message context menu', () => {
  it('takes the first link from the text, then a link preview, then the text', () => {
    expect(getQueryFromMessage(message('listen https://open.spotify.com/track/abc?si=1 and https://youtu.be/x'))).toBe('https://open.spotify.com/track/abc?si=1');
    expect(getQueryFromMessage(message('', [null, 'https://www.youtube.com/watch?v=id']))).toBe('https://www.youtube.com/watch?v=id');
    expect(getQueryFromMessage(message('  clean bandit symphony  '))).toBe('clean bandit symphony');
    expect(getQueryFromMessage(message('   '))).toBeUndefined();
  });

  it('is registered next to the /play slash command', () => {
    const play = new Play(undefined as never, {} as never, {} as never);
    const bodies = getCommandBodies([play]);

    expect(bodies.map(body => body.name)).toEqual(['play', 'Play']);
    expect(bodies[1]).toMatchObject({type: 3});
  });
});

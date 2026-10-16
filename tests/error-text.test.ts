import {describe, expect, it} from 'vitest';
import {sanitizeErrorForLog} from '../src/utils/error-text.js';

describe('sanitizeErrorForLog', () => {
  it('names the failing API endpoint without its query', () => {
    const error = Object.assign(new Error('Response code 400 (Bad Request)'), {
      name: 'HTTPError',
      response: {url: 'https://www.googleapis.com/youtube/v3/videos?part=snippet&id=abc&key=secret-key'},
    });

    const logged = sanitizeErrorForLog(error);

    expect(logged).toBe('HTTPError: Response code 400 (Bad Request) [www.googleapis.com/youtube/v3/videos]');
    expect(logged).not.toContain('secret-key');
  });

  it('leaves other errors unchanged', () => {
    expect(sanitizeErrorForLog(new Error('boom'))).toBe('Error: boom');
  });
});

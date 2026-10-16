import messages from '../messages.js';

export const sanitizeErrorDetail = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .replace(/(["']?\b(?:api[-_]?key|key|token|authorization|cookie)["']?\s*[:=]\s*)(?:["'][^"']*["']|Bearer\s+[^,;\s]+|[^,;\s}\]]+)/gi, '$1[redacted]')
    .replace(/\b(authorization|cookie)\s*[:=]\s*[^\r\n]*/gi, '$1: [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
};

// HTTP client errors (got) only say "Response code 400"; host and path show which API failed. The query is dropped since it can hold keys.
const getRequestEndpoint = (error: unknown) => {
  const {response, options} = error as {response?: {url?: string}; options?: {url?: URL | string}};
  const url = response?.url ?? options?.url;
  if (!url) {
    return '';
  }

  try {
    const {host, pathname} = new URL(String(url));
    return ` [${host}${pathname}]`;
  } catch {
    return '';
  }
};

export const sanitizeErrorForLog = (error: unknown) => {
  const name = error instanceof Error ? error.name : 'Error';
  const detail = sanitizeErrorDetail(error);

  return `${name}: ${detail || 'unknown error'}${getRequestEndpoint(error)}`;
};

export const errorText = (error?: string | Error): string => {
  if (!error) {
    return messages.common.unknownError;
  }

  return `${messages.common.errorPrefix} ${typeof error === 'string' ? error : sanitizeErrorDetail(error)}`;
};

import type { APIRequestContext } from '@playwright/test';

export type MailpitMessage = {
  id: string;
  subject: string;
  to: string[];
  text: string;
  html: string;
};

export type MailpitClient = {
  waitForMail(args: {
    to: string;
    subject?: string;
    linkPattern?: RegExp;
    timeoutMs?: number;
  }): Promise<MailpitMessage>;
  extractLinks(message: MailpitMessage): string[];
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: unexpected Mailpit response.`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function readRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((recipient) => {
    if (recipient === null || typeof recipient !== 'object' || Array.isArray(recipient)) return [];
    const address = (recipient as Record<string, unknown>).Address;
    return typeof address === 'string' ? [address.toLowerCase()] : [];
  });
}

function appendPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function cleanLink(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/[),.;]+$/, '');
}

export function createMailpitClient(request: APIRequestContext, mailpitUrl: string): MailpitClient {
  async function waitForMail({
    to,
    subject,
    linkPattern,
    timeoutMs = 30_000,
  }: Parameters<MailpitClient['waitForMail']>[0]) {
    const deadline = Date.now() + timeoutMs;
    const query = new URLSearchParams({ query: `to:${to}` });
    const searchUrl = `${appendPath(mailpitUrl, '/api/v1/search')}?${query.toString()}`;
    const checkedMessageIds = new Set<string>();

    while (Date.now() < deadline) {
      const searchResponse = await request.get(searchUrl);
      if (!searchResponse.ok()) throw new Error(`Mailpit search: HTTP ${searchResponse.status()}.`);
      const payload = asRecord((await searchResponse.json()) as unknown, 'Mailpit search');
      const summaries = Array.isArray(payload.messages) ? payload.messages : [];

      for (const item of summaries) {
        const summary = asRecord(item, 'Mailpit message');
        const messageTo = readRecipients(summary.To);
        const messageSubject = readString(summary, 'Subject');
        if (!messageTo.includes(to.toLowerCase()) || (subject && messageSubject !== subject)) continue;

        const id = readString(summary, 'ID');
        if (!id || checkedMessageIds.has(id)) continue;
        checkedMessageIds.add(id);
        const messageUrl = appendPath(mailpitUrl, `/api/v1/message/${encodeURIComponent(id)}`);
        const messageResponse = await request.get(messageUrl);
        if (!messageResponse.ok()) throw new Error(`Mailpit message: HTTP ${messageResponse.status()}.`);
        const fullMessage = asRecord((await messageResponse.json()) as unknown, 'Mailpit message');
        const message = {
          id,
          subject: readString(fullMessage, 'Subject') || messageSubject,
          to: readRecipients(fullMessage.To),
          text: readString(fullMessage, 'Text'),
          html: readString(fullMessage, 'HTML'),
        };
        if (linkPattern && !extractLinks(message).some((link) => linkPattern.test(link))) continue;
        return message;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, Math.min(250, remainingMs)));
    }

    const filters = [subject && `subject "${subject}"`, linkPattern && `link pattern ${linkPattern}`].filter(Boolean);
    throw new Error(
      `Mailpit: no message for ${to}${filters.length ? ` with ${filters.join(' and ')}` : ''} within ${timeoutMs} ms.`,
    );
  }

  function extractLinks(message: MailpitMessage): string[] {
    const links = new Set<string>();
    const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
    for (const match of message.html.matchAll(hrefPattern)) {
      const link = cleanLink(match[1] ?? '');
      if (link) links.add(link);
    }

    const textPattern = /https?:\/\/[^\s<>"']+/gi;
    for (const match of `${message.text}\n${message.html}`.matchAll(textPattern)) {
      const link = cleanLink(match[0]);
      if (link) links.add(link);
    }
    return [...links];
  }

  return { waitForMail, extractLinks };
}

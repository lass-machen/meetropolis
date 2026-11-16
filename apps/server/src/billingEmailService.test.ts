import { describe, expect, it, vi } from 'vitest';
import { createBillingEmailService, type BillingEmail } from './billingEmailService.js';
import type { EmailModule } from './emailLoader.js';

const mail: BillingEmail = {
  to: 'owner@example.test',
  subject: 'Payment failed',
  text: 'Your payment failed.',
  html: '<p>Your payment failed.</p>',
};

function fakeLogger() {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function fakeModule(sendRaw: (email: BillingEmail) => Promise<boolean>): EmailModule {
  return { version: 1, sendRaw } as unknown as EmailModule;
}

describe('createBillingEmailService', () => {
  it('reports not delivered and warns once without an email module', async () => {
    const logger = fakeLogger();
    const service = createBillingEmailService({ emailModule: null, delivering: false, logger });
    const result = await service.send(mail);
    expect(result).toEqual({ delivered: false });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith({
      event: 'billing.email_module_unavailable',
      to: mail.to,
      subject: mail.subject,
    });
  });

  it('sends the mail but reports not delivered when the provider only logs', async () => {
    const logger = fakeLogger();
    const sendRaw = vi.fn(() => Promise.resolve(true));
    const service = createBillingEmailService({ emailModule: fakeModule(sendRaw), delivering: false, logger });
    const result = await service.send(mail);
    expect(sendRaw).toHaveBeenCalledTimes(1);
    expect(sendRaw).toHaveBeenCalledWith(mail);
    expect(result).toEqual({ delivered: false });
  });

  it('reports delivered when the provider really delivers', async () => {
    const logger = fakeLogger();
    const sendRaw = vi.fn(() => Promise.resolve(true));
    const service = createBillingEmailService({ emailModule: fakeModule(sendRaw), delivering: true, logger });
    const result = await service.send(mail);
    expect(sendRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ delivered: true });
  });

  it('reports not delivered when the delivering provider reports a failed send', async () => {
    const logger = fakeLogger();
    const sendRaw = vi.fn(() => Promise.resolve(false));
    const service = createBillingEmailService({ emailModule: fakeModule(sendRaw), delivering: true, logger });
    const result = await service.send(mail);
    expect(sendRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ delivered: false });
  });

  it('rejects with the provider error instead of swallowing it', async () => {
    const logger = fakeLogger();
    const failure = new Error('smtp unavailable');
    const sendRaw = vi.fn(() => Promise.reject(failure));
    const service = createBillingEmailService({ emailModule: fakeModule(sendRaw), delivering: true, logger });
    await expect(service.send(mail)).rejects.toBe(failure);
  });
});

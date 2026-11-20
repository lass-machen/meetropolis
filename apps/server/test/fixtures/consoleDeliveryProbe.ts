import { ConsoleEmailProvider } from '../../src/email/consoleProvider.js';
await new ConsoleEmailProvider().send({
  to: 'private-fixture@example.test',
  subject: 'PRIVATE_SUBJECT',
  text: 'PRIVATE_BODY https://example.test/#/verify?token=PRIVATE_TOKEN',
  html: '<p>PRIVATE_HTML</p>',
});

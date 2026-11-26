import net from 'net';

/**
 * A minimal real SMTP server on 127.0.0.1 that does NOT offer STARTTLS: the
 * situation a downgrade on the network path produces. Used to check that the
 * mail providers refuse to send in plain text unless told otherwise. It speaks
 * just enough SMTP for nodemailer (EHLO, AUTH-less MAIL/RCPT/DATA, RSET, QUIT).
 */
export interface PlainSmtpServer {
  port: number;
  /** Raw DATA payloads of the messages accepted so far. */
  received: string[];
  close(): Promise<void>;
}

export async function startPlainSmtpServer(): Promise<PlainSmtpServer> {
  const received: string[] = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let data = '';
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 plain.test ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            received.push(data);
            data = '';
            reply('250 queued');
          } else {
            data += `${line}\n`;
          }
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'EHLO') {
          reply('250-plain.test');
          reply('250 8BITMIME');
        } else if (
          command === 'HELO' ||
          command === 'MAIL' ||
          command === 'RCPT' ||
          command === 'RSET' ||
          command === 'NOOP'
        ) {
          reply('250 ok');
        } else if (command === 'DATA') {
          inData = true;
          reply('354 end with <CRLF>.<CRLF>');
        } else if (command === 'QUIT') {
          reply('221 bye');
          socket.end();
        } else {
          reply('502 not implemented');
        }
      }
    });
    socket.on('error', () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('plain SMTP server has no port');
  return {
    port: address.port,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

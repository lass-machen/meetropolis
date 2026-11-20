/**
 * Shared guard for tests that write to a real database.
 *
 * Accept only a loopback database that is known to be disposable: the CI service on 35440,
 * or the database the test stack assigned to its slot (MT_PORT_DB, slot ports 42000-42399).
 * Other loopback ports may belong to the gate database or to other projects.
 */
export function isDisposableTestDatabase(url: URL, assignedPort: string = process.env.MT_PORT_DB ?? ''): boolean {
  if (url.hostname !== '127.0.0.1') return false;
  if (url.port === '35440') return true;
  const port = Number(url.port);
  return assignedPort !== '' && url.port === assignedPort && Number.isInteger(port) && port >= 42000 && port <= 42399;
}

export const DISPOSABLE_TEST_DATABASE_HINT =
  'the local test database on port 35440 or its test stack slot (MT_PORT_DB)';

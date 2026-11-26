import { test } from '../fixtures';
import { waitForParticipant } from '../fixtures/helpers';

test('member and guest see each other @smoke', async ({ roomUsers, stack }) => {
  test.skip(stack.edition === 'oss', 'Guests require the enterprise edition (tenants)');
  // Fresh tenant (EE): roomUsers without the tenant option creates one.
  const [member, guest] = await roomUsers(2, { roles: ['member', 'guest'] });
  if (!member || !guest) throw new Error('roomUsers did not return a member and a guest.');

  await waitForParticipant(member.page, guest.user);
  await waitForParticipant(guest.page, member.user);
});

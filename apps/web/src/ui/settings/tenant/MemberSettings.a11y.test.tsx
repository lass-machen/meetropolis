// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import axe from 'axe-core';
// Initialises i18next, so the role select labels come from the shipped English locale.
import '../../../app/providers/i18n';
import { MemberSettings } from './MemberSettings';
import type { Member } from './types';

const members: Member[] = [
  { id: 'm1', email: 'alice@example.test', name: 'Alice', role: 'admin' },
  { id: 'm2', email: 'bob@example.test', name: 'Bob', role: 'member' },
];

describe('MemberSettings role select accessibility', () => {
  it('gives every role select an accessible name', async () => {
    const { container } = render(
      <MemberSettings
        members={members}
        saving={false}
        onChangeRole={vi.fn()}
        onRemoveMember={vi.fn()}
        onInvite={vi.fn()}
        onSuccess={vi.fn()}
        onError={vi.fn()}
        onResetPassword={vi.fn()}
        onEditMember={vi.fn()}
      />,
    );

    const r = await axe.run(container, { runOnly: { type: 'rule', values: ['button-name'] } });
    expect(r.violations).toEqual([]);
  });
});

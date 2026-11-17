// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import { Modal } from './Modal';

// Radix renders the dialog into a portal, so axe must run against document.body.
async function expectNoNestedInteractive() {
  const r = await axe.run(document.body, { runOnly: { type: 'rule', values: ['nested-interactive'] } });
  expect(r.violations).toEqual([]);
}

describe('Modal header accessibility', () => {
  it('reports no nested-interactive violation for a titled, closable, draggable modal', async () => {
    render(
      <Modal open={true} onOpenChange={vi.fn()} title="Settings" draggable>
        <div>Body</div>
      </Modal>,
    );

    await expectNoNestedInteractive();
  });

  it('reports no nested-interactive violation for the close-only variant', async () => {
    render(
      <Modal open={true} onOpenChange={vi.fn()} draggable>
        <div>Body</div>
      </Modal>,
    );

    await expectNoNestedInteractive();
  });
});

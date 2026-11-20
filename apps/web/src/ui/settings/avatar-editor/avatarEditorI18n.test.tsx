// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSpriteCatalog } from '@meetropolis/shared';
import catalogJson from '@meetropolis/shared/sprite/catalog.json';
import { EDITOR_TABS } from './editorLayout';
import { initialConfig } from './slotConfig';

const catalog = assertSpriteCatalog(catalogJson);

const seen = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      seen.keys.push(key);
      if (key === 'avatarEditor.unavailableItem') return `${String(options?.label)}: not available`;
      const labels: Record<string, string> = {
        'avatarEditor.tab.body': 'Body',
        'avatarEditor.tab.clothing': 'Clothing',
        'avatarEditor.tab.extras': 'Extras',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('./useSpriteCatalog', () => ({
  useSpriteCatalog: () => ({ catalog, loading: false, error: null }),
}));

vi.mock('./useAvatarDraft', () => ({
  useAvatarDraft: () => ({
    config: initialConfig(catalog),
    setConfig: () => {},
    save: () => {},
    saving: false,
    status: null,
    loading: false,
    loadError: null,
  }),
}));

// jsdom has no canvas 2d implementation; tiles only need their labels here.
vi.mock('./PixelCanvas', () => ({
  PixelCanvas: () => null,
}));

// Static imports after the mocks so the components see the mocked hooks.
import { AvatarEditor } from './AvatarEditor';
import { SpriteTile } from './SpriteTile';

beforeEach(() => {
  seen.keys.length = 0;
});

describe('avatar editor tabs use translated labels', () => {
  it('resolves every tab through a tab label key', () => {
    expect(EDITOR_TABS.map((tab) => tab.labelKey)).toEqual([
      'avatarEditor.tab.body',
      'avatarEditor.tab.clothing',
      'avatarEditor.tab.extras',
    ]);
  });

  it('renders the translated tab labels and looks them up via t', () => {
    render(<AvatarEditor onSaved={() => {}} />);

    expect(screen.getByRole('button', { name: 'Body' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clothing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Extras' })).toBeTruthy();
    for (const key of ['avatarEditor.tab.body', 'avatarEditor.tab.clothing', 'avatarEditor.tab.extras']) {
      expect(seen.keys).toContain(key);
    }
  });
});

describe('unavailable sprite tile label', () => {
  it('translates the unavailable marker with the option label', () => {
    // The hood needs a top palette, so it has no sheet under the base outfit.
    const previewConfig = { ...initialConfig(catalog), outfit: 'base', hat: 'hood' };
    render(
      <SpriteTile
        catalog={catalog}
        previewConfig={previewConfig}
        label="Beanie"
        selected={false}
        disabled
        onClick={() => {}}
      />,
    );

    expect(screen.getByRole('img', { name: 'Beanie: not available' })).toBeTruthy();
    expect(seen.keys).toContain('avatarEditor.unavailableItem');
  });
});

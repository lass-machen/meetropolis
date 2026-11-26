export const DEFAULT_AVATARS = [
  {
    key: 'business_man',
    displayName: 'Business Man',
    spriteUrl: '/assets/sprites/atelier-v1/business_man.36311df39e9f.png',
  },
  {
    key: 'business_woman',
    displayName: 'Business Woman',
    spriteUrl: '/assets/sprites/atelier-v1/business_woman.45dca8a84981.png',
  },
  {
    key: 'casual_woman',
    displayName: 'Casual Woman',
    spriteUrl: '/assets/sprites/atelier-v1/casual_woman.ab39c8c31f0c.png',
  },
  {
    key: 'dev_hoodie',
    displayName: 'Developer',
    spriteUrl: '/assets/sprites/atelier-v1/dev_hoodie.d4774f6a8b1a.png',
  },
  {
    key: 'manager_woman',
    displayName: 'Manager',
    spriteUrl: '/assets/sprites/atelier-v1/manager_woman.df14c70aed86.png',
  },
  {
    key: 'suit_man',
    displayName: 'Suit Man',
    spriteUrl: '/assets/sprites/atelier-v1/suit_man.6594b26689d8.png',
  },
] as const;

export function fallbackAvatarSpriteUrl(key: string): string {
  return DEFAULT_AVATARS.find((avatar) => avatar.key === key)?.spriteUrl ?? `assets/sprites/${key}.png`;
}

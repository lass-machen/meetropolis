export const DEFAULT_AVATARS = [
  {
    key: 'business_man',
    displayName: 'Business Man',
    spriteUrl: '/assets/sprites/atelier-v1/business_man.d1d7a78d7e68.png',
  },
  {
    key: 'business_woman',
    displayName: 'Business Woman',
    spriteUrl: '/assets/sprites/atelier-v1/business_woman.f01546e80735.png',
  },
  {
    key: 'casual_woman',
    displayName: 'Casual Woman',
    spriteUrl: '/assets/sprites/atelier-v1/casual_woman.348f4f49cbd0.png',
  },
  {
    key: 'dev_hoodie',
    displayName: 'Developer',
    spriteUrl: '/assets/sprites/atelier-v1/dev_hoodie.8b424e037c79.png',
  },
  {
    key: 'manager_woman',
    displayName: 'Manager',
    spriteUrl: '/assets/sprites/atelier-v1/manager_woman.af80ed75d4ab.png',
  },
  {
    key: 'suit_man',
    displayName: 'Suit Man',
    spriteUrl: '/assets/sprites/atelier-v1/suit_man.4dc2fcec15cd.png',
  },
] as const;

export function fallbackAvatarSpriteUrl(key: string): string {
  return DEFAULT_AVATARS.find((avatar) => avatar.key === key)?.spriteUrl ?? `assets/sprites/${key}.png`;
}

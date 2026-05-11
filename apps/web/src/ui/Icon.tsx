import React from 'react';
import {
  BellOff,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CreditCard,
  Folder,
  Globe,
  Laptop,
  LocateFixed,
  LogOut,
  Mail,
  Maximize2,
  Menu,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  Moon,
  Package,
  PackageOpen,
  Palette,
  PenTool,
  Plug,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  ScreenShare,
  Settings,
  Shield,
  Smartphone,
  SquarePen,
  Sun,
  Trash2,
  TriangleAlert,
  UserCog,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';

export type IconName =
  | 'bell-off'
  | 'building'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'credit-card'
  | 'folder'
  | 'globe'
  | 'laptop'
  | 'logout'
  | 'mail'
  | 'maximize'
  | 'menu'
  | 'microphone'
  | 'microphone-off'
  | 'minimize'
  | 'monitor'
  | 'moon'
  | 'package'
  | 'package-open'
  | 'palette'
  | 'pen-ruler'
  | 'pen-square'
  | 'plug'
  | 'radio'
  | 'recenter'
  | 'refresh-cw'
  | 'reset'
  | 'save'
  | 'screen-share'
  | 'settings'
  | 'shield'
  | 'smartphone'
  | 'sun'
  | 'trash'
  | 'triangle-alert'
  | 'user-cog'
  | 'users'
  | 'video'
  | 'video-off'
  | 'xmark';

type LucideComponent = React.ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}>;

const ICON_MAP: Record<IconName, LucideComponent> = {
  'bell-off': BellOff,
  building: Building2,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'credit-card': CreditCard,
  folder: Folder,
  globe: Globe,
  laptop: Laptop,
  logout: LogOut,
  mail: Mail,
  maximize: Maximize2,
  menu: Menu,
  microphone: Mic,
  'microphone-off': MicOff,
  minimize: Minimize2,
  monitor: Monitor,
  moon: Moon,
  package: Package,
  'package-open': PackageOpen,
  palette: Palette,
  'pen-ruler': PenTool,
  'pen-square': SquarePen,
  plug: Plug,
  radio: Radio,
  recenter: LocateFixed,
  'refresh-cw': RefreshCw,
  reset: RotateCcw,
  save: Save,
  'screen-share': ScreenShare,
  settings: Settings,
  shield: Shield,
  smartphone: Smartphone,
  sun: Sun,
  trash: Trash2,
  'triangle-alert': TriangleAlert,
  'user-cog': UserCog,
  users: Users,
  video: Video,
  'video-off': VideoOff,
  xmark: X,
};

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2x' | '3x' | number;

const SIZE_PX: Record<Exclude<IconSize, number>, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  '2x': 32,
  '3x': 48,
};

function resolveSize(size: IconSize | undefined): number {
  if (size == null) return 16;
  if (typeof size === 'number') return size;
  return SIZE_PX[size];
}

export type IconProps = {
  name: IconName;
  size?: IconSize | undefined;
  strokeWidth?: number | undefined;
  className?: string | undefined;
  title?: string | undefined;
  ariaLabel?: string | undefined;
  style?: React.CSSProperties | undefined;
};

export function Icon({ name, size, strokeWidth = 2, className, title, ariaLabel, style }: IconProps) {
  const Component = ICON_MAP[name];
  const px = resolveSize(size);
  const decorative = !ariaLabel;
  return (
    <span
      className={className}
      title={title}
      role={decorative ? undefined : 'img'}
      aria-label={ariaLabel}
      aria-hidden={decorative ? true : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px,
        height: px,
        flex: '0 0 auto',
        ...style,
      }}
    >
      <Component size={px} strokeWidth={strokeWidth} aria-hidden />
    </span>
  );
}

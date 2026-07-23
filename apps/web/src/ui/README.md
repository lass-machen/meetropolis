# UI System Overview

A layered design-system inside `apps/web/src/ui/`. Lower layers are
unstyled, behaviour-only primitives; higher layers add Meetropolis
styling and conventions.

- **Primitives** (`ui/primitives/*`): Dialog, Popover, Tooltip, Portal,
  VisuallyHidden. Behaviour-only wrappers around headless libs (focus
  trap, ESC, ARIA). Use these when you need fine-grained control over
  styling.
- **System** (`ui/system/*`): Button, Input, Select, Card, Toolbar,
  Modal, Toast. Opinionated, themed components built on top of the
  primitives. Default choice for product UI.
- **Utilities / tokens** (`styles/theme.css`): colour, radius, shadow
  tokens plus `.btn*`, `.panel`, `.stack-*` utility classes.
- **Theming** (`ui/theme.tsx`): `ThemeProvider`, `ThemeToggleButton`.

## Migration notes

- Legacy `Overlay` -> `ui/system/Modal` (a11y, focus management and
  ESC handling via the headless primitive).
- Avoid new inline styles. Prefer the utility classes and the system
  components.

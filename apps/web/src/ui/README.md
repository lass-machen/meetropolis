UI System Überblick

- Primitives: `ui/primitives/*` (Dialog, Popover, Tooltip, Portal, VisuallyHidden)
- System: `ui/system/*` (Button, Input, Select, Card, Toolbar, Modal, Toast)
- Utilities/Tokens: `styles/theme.css` (Farben, Radien, Schatten, `.btn*`, `.panel`, `.stack-*`)
- Theming: `ui/theme.tsx` (`ThemeProvider`, `ThemeToggleButton`)

Migration
- `Overlay` → `ui/system/Modal` (A11y/Fokus/ESC via Headless)
- Vermeide neue Inline-Styles; nutze Utilities und System-Komponenten



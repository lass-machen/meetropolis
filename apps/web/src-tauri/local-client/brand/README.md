Brand-Assets
============

Lege hier deine Branding-Dateien ab. Empfohlene Dateinamen:

- `logo.png` (quadratisch, für Header) – alternativ `logo.svg`
- `wordmark.png` (Breitbild-Logo mit Schriftzug)
- `favicon.png` (quadratisch, 256–512px) – alternativ `favicon.ico`

Verwendung in der App:
- Das Favicon wird über `apps/web/index.html` von `/brand/favicon.png` geladen.
- Der Header nutzt standardmäßig `/brand/logo.png` (siehe `apps/web/src/ui/branding/BrandLogo.tsx`).
- Der Schriftzug ist optional über `/brand/wordmark.png` verfügbar (`BrandWordmark`).

Hinweise:
- SVG wird bevorzugt, da es scharf in allen Auflösungen rendert.
- Wenn du andere Dateinamen verwenden willst, kannst du der `BrandLogo`-Komponente einen eigenen `src`-Pfad übergeben.


import { test, expect } from '@playwright/test';

// TODO(TEST): E2E benötigt laufende Web- und Server-Instanz mit Auth.
// Dieser Test dient als Platzhalter, bis die CI-Umgebung für Editor-Interaktionen bereitsteht.
// Prüfpunkte gem. Akzeptanzkriterien:
// - Boden/Wände malen -> Reload -> sichtbar
// - Kollision löschen -> Reload -> passierbar
// - Realtime-Update zwischen zwei Clients (<1s)

test.skip('Map-Editor v2-only persists ground/walls/collision via chunks', async ({ page }) => {
  await page.goto('http://localhost:5173');
  // Hier würden Login, Editor-Öffnen, Malen/Löschen und Reload geprüft.
  // Siehe TODO(TEST) oben – wird aktiviert, sobald Test-Backend in CI verfügbar ist.
  expect(true).toBeTruthy();
});



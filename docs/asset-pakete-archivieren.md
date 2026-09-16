# Asset-Pakete archivieren

Archivieren entfernt ein Asset-Paket aus `GET /asset-packs` und damit aus der
Editor-Palette aller Tenants. Das gilt auch für Plattform-Owner. Nur interne
Plattform-Owner dürfen den Zustand über die API ändern:

```http
PATCH /asset-packs/<ID-oder-UUID>/archive
Content-Type: application/json

{ "archived": true }
```

Mit `{ "archived": false }` wird das Paket wieder in der Palette sichtbar.
Ein Einzelabruf über `GET /asset-packs/<ID-oder-UUID>` bleibt auch für ein
archiviertes Paket möglich, sofern der aufrufende Benutzer Zugriff auf dessen
Tenant-Bereich hat.

Archivieren löscht ausdrücklich weder den Datenbankeintrag noch Dateien oder
platzierte Objekte. Bestehende `MapObject`-Einträge werden unverändert
ausgeliefert und verwenden weiterhin ihre eigene `dataUrl`. Auch operative
Zugriffe auf Paketdaten, etwa für Kollisions-Backfills, bleiben ungefiltert.
Archivieren ist kein Berechtigungsentzug: Direkte Integrationen können ein
weiterhin zugängliches Paket per UUID abrufen und verwenden.
Die Richtungsvarianten-Registry wird aus der sichtbaren Palette aufgebaut;
archivierte Richtungsvarianten werden deshalb nicht neu registriert und ein
bereits platziertes Objekt fällt auf seine gespeicherte Basisgrafik mit
programmatischer Drehung zurück.

Der Enterprise-Katalog bleibt ebenfalls ungefiltert. Er ist ein Verwaltungs-
und Vertriebswerkzeug, keine Editor-Palette, und muss archivierte Pakete zum
Prüfen und Wiederherstellen weiterhin auffindbar halten. Installieren oder
Zuordnen hebt das Archivflag nicht auf.

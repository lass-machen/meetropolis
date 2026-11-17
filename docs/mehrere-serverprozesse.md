# Mehrere Serverprozesse

## Überblick

Ohne `REDIS_URL` läuft der Server in einem einzigen Prozess, genau wie bisher. Es wird keine Redis-Verbindung aufgebaut, und alle Zähler, die Raumliste und die Anwesenheitsdaten bleiben im Prozess.

Mit `REDIS_URL` können mehrere Serverprozesse dieselbe Installation bedienen. Die Prozesse teilen sich dann über Redis die Anwesenheitsdaten von Colyseus, die Raumregistrierung über den Redis-Treiber von Colyseus und alle Zähler, die sonst nur im jeweiligen Prozess gelten würden. Ein Raum existiert dabei weiterhin genau einmal, nämlich auf dem Prozess, der ihn erzeugt hat. Die übrigen Prozesse finden ihn über die gemeinsame Registrierung.

## Konfiguration

Zwei Umgebungsvariablen steuern den Betrieb mit mehreren Prozessen:

- `REDIS_URL` ist die Verbindungsadresse des Redis-Dienstes, den alle Prozesse gemeinsam nutzen, zum Beispiel `redis://redis:6379`. Sobald die Variable gesetzt und nicht leer ist, läuft der Server im Mehrprozessbetrieb. Ohne sie bleibt alles beim Einzelprozess.
- `COLYSEUS_PUBLIC_ADDRESS` ist die öffentliche Adresse genau dieses Prozesses, bestehend aus Host und Pfad ohne Protokoll, zum Beispiel `api.example.org/p1`. Jeder Prozess braucht eine eigene Adresse, weil Sitzungsreservierungen den Client direkt zu dem Prozess schicken, der den Raum hält.

Für den Mehrprozessbetrieb sind vier zusätzliche Pakete installiert:

- `@colyseus/redis-presence` stellt die prozessübergreifenden Anwesenheitsdaten und Kanäle von Colyseus bereit.
- `@colyseus/redis-driver` stellt die gemeinsame Raumregistrierung bereit, über die jeder Prozess alle Räume findet.
- `rate-limit-redis` speichert die Zähler der HTTP-Begrenzungen in Redis.
- `ioredis` ist der Redis-Client, über den die übrigen geteilten Zähler und die gemeinsame Verbindung laufen.

## Routing

Die HTTP-Anfragen für die Raumsuche und Raumerzeugung dürfen auf jedem Prozess landen. Jeder Prozess findet über die gemeinsame Registrierung heraus, ob ein passender Raum bereits existiert, und bei welchem Prozess er liegt. Die Sitzungsreservierung, die der Client als Antwort erhält, trägt die öffentliche Adresse des Prozesses, der den Raum hält. Der Client baut seine WebSocket-Verbindung dann zu dieser Adresse auf, technisch zur Adresse `<Adresse>/<processId>/<roomId>` aus öffentlicher Adresse, Prozesskennung und Raumkennung.

Damit das funktioniert, braucht der Reverse Proxy je Prozess einen eigenen Pfadpräfix, der zu genau diesem Prozess führt und den Präfix vor der Weitergabe entfernt. Sitzungen müssen nicht an einem Prozess kleben, denn die Verbindung geht nach der Reservierung ohnehin direkt zum raumhaltenden Prozess. Klebende Sitzungen (Sticky Sessions) sind daher nicht nötig.

Ein Beispiel mit dem Hostnamen `api.example.org` und zwei Prozessen:

| Prozess               | `COLYSEUS_PUBLIC_ADDRESS` | Proxy-Regel                                                                                                       |
| --------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Erster Serverprozess  | `api.example.org/p1`      | Anfragen an `api.example.org/p1/` gehen an den ersten Prozess, der Präfix `/p1` wird vor der Weitergabe entfernt  |
| Zweiter Serverprozess | `api.example.org/p2`      | Anfragen an `api.example.org/p2/` gehen an den zweiten Prozess, der Präfix `/p2` wird vor der Weitergabe entfernt |

Alle übrigen API-Anfragen darf der Proxy frei auf beide Prozesse verteilen.

Pfade, die der Proxy auf dem allgemeinen Weg nicht aus dem Internet weiterreicht (etwa `/internal`), müssen auch unter jedem Prozesspräfix ausgeschlossen bleiben, weil der Proxy den Präfix entfernt und die Anfrage sonst als interner Pfad ankäme.

## Was prozessübergreifend geteilt wird

- Alle HTTP-Rate-Limits und zusätzlich das Limit für WebSocket-Upgrades zählen in Redis statt im Prozess. Ihre Schlüssel tragen das Präfix `rl:<name>:`, wobei der Name den jeweiligen Begrenzer bezeichnet. Ein Budget gilt damit für die ganze Installation und vervielfacht sich nicht mehr mit der Zahl der Prozesse.
- Das Upload-Budget je Nutzerin und Nutzer wird in Redis gezählt, sodass gleichzeitige und aufeinanderfolgende Uploads auf verschiedenen Prozessen dasselbe Budget verbrauchen.
- Die Invalidierung des Session-Caches wird an alle Prozesse gemeldet. Ein abgemeldeter oder gesperrter Zugang verliert seine zwischengespeicherte Sitzung damit überall, nicht erst nach Ablauf der kurzen Cache-Laufzeit im jeweiligen Prozess.
- Editor-Broadcasts und der Entzug von Zugriffen laufen über die Anwesenheitskanäle von Colyseus und erreichen den Raum auch dann, wenn der auslösende HTTP-Request auf einem anderen Prozess gelandet ist als der raumhaltende.
- Die Raumliste der Administrationsansicht kommt aus der globalen Registrierung und zeigt Räume aller Prozesse, nicht nur die des antwortenden Prozesses.
- Gleichzeitiges Erzeugen desselben Mandanten-Rooms auf mehreren Prozessen wird von Colyseus über die Anwesenheitsdaten serialisiert, sodass am Ende nur ein Raum für den Mandanten entsteht.

## Verhalten bei nicht erreichbarem Redis

Fällt Redis aus oder ist nicht erreichbar, bleiben die Rate-Limits und das Upload-Budget wirksam: Sie fallen auf prozesslokale Zähler zurück, anstatt Anfragen ungeprüft durchzulassen oder mit einem Serverfehler zu beantworten. Jeder betroffene Begrenzer meldet den Fehler im Server-Log, höchstens einmal alle 30 Sekunden, damit das Log bei einem längeren Ausfall nicht vollläuft. Die Budgets gelten in dieser Zeit nur noch je Prozess und können sich entsprechend vervielfachen.

Die Raumsuche über Prozessgrenzen hinweg funktioniert ohne Redis nicht mehr: Ein Prozess sieht dann nur noch seine eigenen Räume, und Clients erhalten keine Reservierung für Räume eines anderen Prozesses. Der Betrieb mit mehreren Prozessen setzt einen erreichbaren Redis-Dienst daher voraus; ohne ihn ist der Einzelprozess der unterstützte Zustand.

## Bekannte Grenzen

Die folgenden Zustände bleiben bewusst prozesslokal:

- Der Worker für Löschaufgaben läuft in jedem Prozess mit, weil jede Aufgabe atomar aus der Datenbank beansprucht wird und ein zweiter Prozess dieselbe Aufgabe deshalb nicht noch einmal ausführt.
- Caches, die aus Dateien oder der Umgebung abgeleitet sind, hält jeder Prozess für sich, weil sie überall identisch ausfallen und keine Entscheidung von ihnen abhängt; dazu zählen der Avatar-Katalog, die Secret-Caches, die geladenen optionalen Module und die Tools-Datei.
- Das Löschjournal reiht seine Einträge innerhalb des Prozesses und sichert sich prozessübergreifend über eine Dateisperre, weil die Journaldatei selbst der gemeinsame Zustand ist.
- Room-Zustände wie Spieler, Zonen und Timer leben im Raum selbst, weil der Raum genau einmal auf einem Prozess existiert und alle Verbindungen zu ihm dort zusammenlaufen.
- Lastgrenzen optionaler geschlossener Module zählen je Prozess, weil sie reine Mengengrenzen ohne Budget je Person sind; die wirksame Gesamtgrenze ist die Zahl der Prozesse mal die jeweilige Grenze.
- Das Mobile Gateway bleibt im Mehrprozessbetrieb abgeschaltet: Bei gesetztem `REDIS_URL` registriert der Server die Mobile-Routen trotz `MOBILE_GATEWAY_ENABLED` nicht und loggt einen Fehler mit dem Ereignis `mobile.routes_disabled_multi_process`, weil Sitzungen prozessgebunden sind.

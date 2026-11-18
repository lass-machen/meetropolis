# Prometheus scrape listener

The public HTTP port (default 2567) answers `GET` and `HEAD` `/metrics`
with 404, with or without cookies or tools credentials. Scrapes go to a
separate listener.

| Variable       | Default              | Role                                         |
| -------------- | -------------------- | -------------------------------------------- |
| `METRICS_PORT` | unset (listener off) | TCP port of the scrape listener              |
| `METRICS_HOST` | loopback             | Bind address; compose sets the container NIC |

The bundled `compose.yaml` sets `METRICS_PORT` and `METRICS_HOST` on the
server service and does **not** add a `ports` mapping for the scrape
listener. `prometheus/prometheus.yml` targets `server:9100`. A scraper
must share the compose network. Publishing the port to the host, or
proxying it, would expose the metrics surface; do not add either.

An invalid `METRICS_PORT` (not a TCP port, equal to `PORT`, or a bind
failure) stops startup. Both listeners close on graceful shutdown.

Self-hosters who already scrape `server:2567/metrics` must point the
scrape job at `server:9100` (or the `METRICS_PORT` they chose).

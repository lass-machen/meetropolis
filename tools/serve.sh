#!/usr/bin/env bash
# DEPRECATED: Tools are now served via the Express server at /tools (Basic Auth protected).
# Set TOOLS_USER and TOOLS_PASSWORD in your .env to enable.
# This script is kept as a fallback for local development without the server running.
#
# Serve the Meetropolis standalone tools via a local HTTP server.
# This avoids file:// CORS issues when connecting to the production API.
#
# Usage:
#   ./tools/serve.sh          # default port 8900
#   ./tools/serve.sh 3333     # custom port

PORT="${1:-8900}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Serving tools at http://localhost:${PORT}"
echo ""
echo "  Map Editor:           http://localhost:${PORT}/map-editor.html"
echo "  Avatar Pack Manager:  http://localhost:${PORT}/avatar-pack-manager.html"
echo "  Super Admin:          http://localhost:${PORT}/super-admin.html"
echo "  NPC Admin:            http://localhost:${PORT}/npc-admin.html"
echo ""
echo "Press Ctrl+C to stop."
echo ""

# Use Python 3 (ships with macOS) as a simple static file server
python3 -m http.server "$PORT" --directory "$DIR"

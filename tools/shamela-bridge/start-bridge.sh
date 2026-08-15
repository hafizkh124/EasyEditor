#!/usr/bin/env bash
echo "========================================================"
echo "  Al-Ulama Easy Editor - Local Shamela 4 Bridge Launcher"
echo "========================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js was not found on this computer."
    echo ""
    echo "The bridge needs Node.js to run. Download and install it from:"
    echo "    https://nodejs.org/"
    echo "Then run this script again."
    echo ""
    exit 1
fi

echo "Starting local HTTP bridge on http://127.0.0.1:8000 ..."
echo "Please keep this terminal window open while using local search."
echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
node "$SCRIPT_DIR/server.mjs"

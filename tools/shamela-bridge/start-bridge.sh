#!/usr/bin/env bash
echo "========================================================"
echo "  Al-Ulama Easy Editor - Local Shamela 4 Bridge Launcher"
echo "========================================================"
echo ""
echo "Starting local HTTP bridge on http://127.0.0.1:8000 ..."
echo "Please keep this terminal window open while using local search."
echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
node "$SCRIPT_DIR/server.mjs"

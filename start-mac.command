#!/bin/bash
# Double-click this file on a Mac to start Orbital Couriers.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS installer from https://nodejs.org, install it, then double-click this file again."
  read -p "Press Enter to close."
  exit 1
fi
node server.js

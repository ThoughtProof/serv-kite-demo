#!/usr/bin/env bash
# Recording demo: 3 real runs against local Sentinel #115 (127.0.0.1:3011), kite_pay MOCK by default (KITE_PAY_MODE=LIVE: real USDC on Base via Kite Passport prod).
# Usage: ./demo-record.sh [--fast] [--no-color]
# Colors are ON by default. They are disabled only by --no-color or by NO_COLOR set when calling this script.
set -euo pipefail
cd "$(dirname "$0")"
# FORCE_COLOR=0 inherited from the box env made Node print a NO_COLOR/FORCE_COLOR warning; drop it.
unset FORCE_COLOR
exec node scripts/demo-record.ts "$@"

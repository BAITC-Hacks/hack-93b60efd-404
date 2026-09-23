#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required in the server process environment." >&2
  exit 1
fi
if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "GEMINI_API_KEY is required for the live voice session." >&2
  exit 1
fi

uv sync --frozen
npm --prefix frontend ci

export VOICE_ROUTER_DNS_RESOLVER="${VOICE_ROUTER_DNS_RESOLVER:-1.1.1.1}"
uv run python -m voice_router.server &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT INT TERM

npm --prefix frontend run dev

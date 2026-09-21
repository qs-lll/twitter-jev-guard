#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"

if [[ -z "${TYPESAFE_API_KEY:-}" ]]; then
  print -n "TypeSafe API key: "
  read -r TYPESAFE_API_KEY
  export TYPESAFE_API_KEY
fi

exec node server/index.js

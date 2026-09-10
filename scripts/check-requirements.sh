#!/usr/bin/env bash
# Companio — local setup requirements check.
#
# This is a Node.js project (npm workspaces monorepo), not Python, so
# there's no requirements.txt — package.json + package-lock.json already
# pin every JS dependency, and `npm install` fetches them. What this
# script checks instead is the machine-level tooling that has to be
# installed by hand before that works: the runtime, the database
# containers, and version control.
#
# Usage: bash scripts/check-requirements.sh

echo "== Companio setup requirements =="
echo

check() {
  name="$1"; cmd="$2"; hint="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    version=$("$cmd" --version 2>&1 | head -1)
    echo "[OK]   $name — $version"
  else
    echo "[MISSING] $name — $hint"
  fi
}

check "Node.js (need 20+)" node "Install from https://nodejs.org (LTS)"
check "npm" npm "Comes bundled with Node.js"
check "git" git "Install from https://git-scm.com"
check "Docker" docker "Install Docker Desktop: https://www.docker.com/products/docker-desktop/ (needs WSL2 on Windows — the installer prompts for it)"

echo
if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    echo "[OK]   Docker Compose plugin — $(docker compose version)"
  else
    echo "[MISSING] Docker Compose plugin (should ship with Docker Desktop — reinstall if missing)"
  fi
  if docker info >/dev/null 2>&1; then
    echo "[OK]   Docker daemon is running"
  else
    echo "[MISSING] Docker Desktop is installed but not running — start it (system tray whale icon) and wait for it to finish starting"
  fi
fi

echo
echo "== Project-level checks =="
cd "$(dirname "$0")/.." || exit 1
[ -f .env ] && echo "[OK]   .env exists" || echo "[MISSING] .env — run: cp .env.example .env"
[ -f node_modules/.bin/next ] && echo "[OK]   npm install has completed (apps/web ready)" || echo "[MISSING] npm install not finished yet — run: npm install"
[ -f node_modules/.bin/nest ] && echo "[OK]   npm install has completed (apps/api ready)" || echo "[MISSING] npm install not finished yet — run: npm install"

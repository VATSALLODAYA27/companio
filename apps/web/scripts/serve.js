#!/usr/bin/env node
'use strict';

// Cross-platform port resolution for `next dev` / `next start`.
//
// The previous versions of these scripts used POSIX-only shell syntax
// (`next dev -p ${WEB_PORT:-3000}`). That works in bash/zsh, but npm runs
// package scripts through `cmd.exe` on Windows regardless of which shell
// you invoked `npm run` from (Git Bash included) — and cmd.exe has no
// `${VAR:-default}` syntax, so it passed the literal string
// "${WEB_PORT:-3000}" straight to `next dev -p`, which then failed with
// "argument '${WEB_PORT:-3000}' is invalid. ... is not a non-negative
// number." This script does the same fallback in plain Node.js instead,
// which behaves identically on Windows, macOS, and Linux.

const { spawnSync } = require('child_process');
const path = require('path');

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'start') {
  console.error('Usage: node scripts/serve.js <dev|start>');
  process.exit(1);
}

const port = process.env.WEB_PORT || '3000';
const nextBin = require.resolve('next/dist/bin/next');

const result = spawnSync(process.execPath, [nextBin, mode, '-p', port], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

process.exit(result.status === null ? 1 : result.status);

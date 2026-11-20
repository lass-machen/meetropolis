#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.env.HUSKY === '0') {
  console.error('install-hooks: skipped (HUSKY=0)');
  process.exit(0);
}

function gitOut(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

if (gitOut(['rev-parse', '--is-inside-work-tree']) !== 'true') {
  process.exit(0);
}

const gitDir = gitOut(['rev-parse', '--git-dir']);
const commonDir = gitOut(['rev-parse', '--git-common-dir']);
if (gitDir !== null && commonDir !== null) {
  if (path.resolve(process.cwd(), gitDir) !== path.resolve(process.cwd(), commonDir)) {
    console.error('install-hooks: skipped (linked worktree)');
    process.exit(0);
  }
}

execFileSync('git', ['config', 'core.hooksPath', '.husky'], { stdio: 'inherit' });

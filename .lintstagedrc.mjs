import path from 'node:path';

const workspaces = [
  { directory: 'apps/web', name: '@meetropolis/web' },
  // Database tests need DATABASE_URL and run through `npm run test:db`;
  // the hook runs the server's unit test project only.
  { directory: 'apps/server', name: '@meetropolis/server', vitestArgs: ['--project', 'server'] },
  { directory: 'packages/shared', name: '@meetropolis/shared' },
];

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

const typescriptTasks = (files) => {
  const root = process.cwd();
  const stagedFiles = files.map((file) => {
    const absolute = path.resolve(file);
    return {
      absolute,
      relative: path.relative(root, absolute).split(path.sep).join('/'),
    };
  });
  const filesArgument = stagedFiles.map(({ absolute }) => quote(absolute)).join(' ');
  const tasks = [`eslint --fix ${filesArgument}`, `prettier --write ${filesArgument}`];

  for (const workspace of workspaces) {
    const workspaceFiles = stagedFiles.filter(({ relative }) => relative.startsWith(`${workspace.directory}/`));
    if (workspaceFiles.length === 0) continue;

    tasks.push(`npm -w ${workspace.name} run typecheck`);

    const workspaceRoot = path.resolve(root, workspace.directory);
    const relatedFiles = workspaceFiles
      .map(({ absolute }) => quote(path.relative(workspaceRoot, absolute).split(path.sep).join('/')))
      .join(' ');
    const vitestArgs = (workspace.vitestArgs ?? []).map((arg) => ` ${arg}`).join('');
    tasks.push(`npx vitest related --run --root ${quote(workspaceRoot)}${vitestArgs} ${relatedFiles}`);
  }

  return tasks;
};

export default {
  '*.{ts,tsx}': typescriptTasks,
  '*.{js,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  '*.{json,md,yml,yaml,css,html}': ['prettier --write'],
};

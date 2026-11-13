import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { StackControl, StackService, TestStackEnv } from './types';

const run = promisify(execFile);

const PROJECT_PATTERN = /^mtest-[0-9]+$/;

async function findContainerId(project: string, service: StackService): Promise<string> {
  const { stdout } = await run('docker', [
    'ps',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--filter',
    `label=com.docker.compose.service=${service}`,
  ]);
  const ids = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (ids.length !== 1) {
    throw new Error(`stackControl: ${service} in ${project} hat ${ids.length} Container, erwartet genau 1.`);
  }
  const id = ids[0];
  if (!id) throw new Error(`stackControl: ${service} in ${project} hat keinen Container.`);
  return id;
}

export async function provideStackControl(args: {
  stack: TestStackEnv;
  provide: (control: StackControl) => Promise<void>;
}): Promise<void> {
  const project = args.stack.project;
  if (!PROJECT_PATTERN.test(project)) {
    throw new Error(`stackControl: ungültiges Projekt ${project}, erwartet mtest-<n>.`);
  }
  const paused = new Set<StackService>();
  const control: StackControl = {
    pause: async (service) => {
      await run('docker', ['pause', await findContainerId(project, service)]);
      paused.add(service);
    },
    unpause: async (service) => {
      await run('docker', ['unpause', await findContainerId(project, service)]);
      paused.delete(service);
    },
  };
  try {
    await args.provide(control);
  } finally {
    for (const service of paused) {
      await run('docker', ['unpause', await findContainerId(project, service)]);
    }
  }
}

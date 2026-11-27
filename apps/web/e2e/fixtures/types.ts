import type { BrowserContext, Page } from '@playwright/test';
import type { Client } from 'pg';

import type { FreshTenant, Role, SeedData, TestUser } from '../support/api';
import type { MailpitClient } from '../support/mailpit';

export type Edition = 'ee' | 'oss';
export type MediaPermission = 'granted' | 'denied' | 'prompt';
export type StackService = 'livekit' | 'mailpit' | 'server';

export type StackControl = {
  pause(service: StackService): Promise<void>;
  unpause(service: StackService): Promise<void>;
};

export type TestStackEnv = {
  baseUrl: string;
  apiUrl: string;
  databaseUrl: string;
  mailpitUrl: string;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  seedFile: string;
  operatorEmail: string;
  operatorPassword: string;
  userPassword: string;
  edition: Edition;
  project: string;
};

export type RoomUser = { user: TestUser; context: BrowserContext; page: Page };
export type RoomUserOptions = {
  tenant?: FreshTenant | 'seed';
  roles?: Role[];
  joinOrder?: 'sequential' | 'parallel';
  permissions?: MediaPermission[];
  join?: boolean;
  // Every user in a browser instance of its own. WebKit lets only one page per
  // browser process capture at a time and mutes the others, so two users who
  // both capture must not share an instance.
  separateBrowsers?: boolean;
};
export type RoomUsersFactory = (n: number, options?: RoomUserOptions) => Promise<RoomUser[]>;

export type Fixtures = {
  stack: TestStackEnv;
  seed: SeedData;
  freshTenant: FreshTenant;
  loginAs: (user: TestUser) => Promise<{ context: BrowserContext; page: Page }>;
  roomUsers: RoomUsersFactory;
  mailpit: MailpitClient;
  db: Client;
  stackControl: StackControl;
};

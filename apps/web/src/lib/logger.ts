type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

function getLevelWeight(level: LogLevel): number {
	return ({ debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const)[level];
}

function resolveLogLevel(): LogLevel {
	try {
		const env = (import.meta as any).env || {};
		const raw = (env.VITE_LOG_LEVEL || env.MODE)?.toString().toLowerCase() || '';
		if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'silent') return raw;
		return env.PROD ? 'info' : 'debug';
	} catch {
		return 'debug';
	}
}

const currentLevel: LogLevel = resolveLogLevel();

function logAt(level: LogLevel, ...args: unknown[]) {
	if (getLevelWeight(level) < getLevelWeight(currentLevel)) return;
	const ts = new Date().toISOString();
	switch (level) {
		case 'debug':
			// eslint-disable-next-line no-console
			console.debug(ts, ...args);
			break;
		case 'info':
			// eslint-disable-next-line no-console
			console.info(ts, ...args);
			break;
		case 'warn':
			// eslint-disable-next-line no-console
			console.warn(ts, ...args);
			break;
		case 'error':
			// eslint-disable-next-line no-console
			console.error(ts, ...args);
			break;
	}
}

export const logger = {
	level: currentLevel,
	debug: (...args: unknown[]) => logAt('debug', ...args),
	info: (...args: unknown[]) => logAt('info', ...args),
	warn: (...args: unknown[]) => logAt('warn', ...args),
	error: (...args: unknown[]) => logAt('error', ...args),
};



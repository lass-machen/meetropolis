// Editor-specific logging utility
import { logger } from './logger';
const EDITOR_DEBUG = (import.meta as any).env?.VITE_EDITOR_DEBUG === 'true' || false;

export function editorLog(category: string, message: string, data?: any) {
  if (!EDITOR_DEBUG) return;
  
  const prefix = `[Editor:${category}] ${message}`;
  if (data !== undefined) logger.debug(prefix, data);
  else logger.debug(prefix);
}

export function editorError(category: string, message: string, error: any) {
  logger.error(`[Editor:${category}] ${message}`, error);
}
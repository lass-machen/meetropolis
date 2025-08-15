// Editor-specific logging utility
const EDITOR_DEBUG = true;

export function editorLog(category: string, message: string, data?: any) {
  if (!EDITOR_DEBUG) return;
  
  const timestamp = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[${timestamp}] [Editor:${category}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [Editor:${category}] ${message}`);
  }
}

export function editorError(category: string, message: string, error: any) {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.error(`[${timestamp}] [Editor:${category}] ${message}`, error);
}
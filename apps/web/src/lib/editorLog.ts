// Editor-specific logging utility

export function editorLog(category: string, message: string, data?: any) {
  // Logging disabled for production
  void category;
  void message;
  void data;
}

export function editorError(category: string, message: string, error: any) {
  // Error logging disabled for production  
  void category;
  void message;
  void error;
}
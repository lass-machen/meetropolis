import React from 'react';
import './styles/theme.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from './ui/theme';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);


import { create } from 'zustand';

type Vec2 = { x: number; y: number };

type GameState = {
  playerId: string;
  position: Vec2;
  direction: 'up' | 'down' | 'left' | 'right';
  bubbleRadius: number;
  voiceOnly: boolean;
  setPosition: (p: Vec2, direction: GameState['direction']) => void;
  setVoiceOnly: (v: boolean) => void;
};

export const useGameStore = create<GameState>((set) => ({
  playerId: '',
  position: { x: 80, y: 120 },
  direction: 'down',
  bubbleRadius: 64,
  voiceOnly: import.meta.env.VITE_FEATURE_VOICE_ONLY === 'true',
  setPosition: (p, direction) => set({ position: p, direction }),
  setVoiceOnly: (v) => set({ voiceOnly: v }),
}));

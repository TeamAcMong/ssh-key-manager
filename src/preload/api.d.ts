import type { SkmApi } from '../core/ipc';

declare global {
  interface Window {
    skm: SkmApi;
  }
}

export {};

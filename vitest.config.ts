import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  // Svelte 5 component tests must load Svelte's client build, not the SSR one.
  resolve: { conditions: ['browser'] },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', 'pwa.config.test.ts'],
  },
});

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentdocstore/core': r('./packages/core/src/index.ts'),
      '@agentdocstore/provider-tests': r('./packages/provider-tests/src/index.ts'),
      '@agentdocstore/provider-memory': r('./packages/provider-memory/src/index.ts'),
      '@agentdocstore/provider-fs': r('./packages/provider-fs/src/index.ts'),
      '@agentdocstore/server': r('./packages/server/src/index.ts'),
      '@agentdocstore/mcp': r('./packages/mcp/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/src/**/*.test.ts'],
    environment: 'node',
  },
});

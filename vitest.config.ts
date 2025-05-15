// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Optional: to use Vitest globals like describe, it, expect without importing
    environment: 'node', // Specify test environment
    // reporters: ['verbose'], // Optional: for more detailed output
    coverage: {
      provider: 'v8', // or 'istanbul'
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage/unit',
      all: true, // Include all files in src for coverage, not just tested ones
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli.ts', // CLI entry point might be harder to unit test directly
        'src/server.ts', // Server setup might be more integration test
        'src/debugWebServer.ts', // Optional debug component
        'src/**/*.d.ts',
        'src/interfaces.ts' // Interfaces don't have runnable code
      ],
    },
  },
}); 
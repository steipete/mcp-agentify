// tests/__mocks__/child_process.ts
import { vi } from 'vitest';

export const spawn = vi.fn();
// Add other exports from child_process if your SUT uses them and they need mocking. 
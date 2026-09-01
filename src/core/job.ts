import type { BotJob } from './types.js';

/**
 * Helper function định nghĩa 1 Job chuẩn Type-Safe
 */
export function defineJob(jobConfig: BotJob): BotJob {
  return {
    enabled: true,
    ...jobConfig,
  };
}

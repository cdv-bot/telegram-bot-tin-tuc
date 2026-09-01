import type { BotJob } from './types.js';
import { logger } from './logger.js';

class JobRegistry {
  private jobs: Map<string, BotJob> = new Map();

  register(job: BotJob) {
    if (this.jobs.has(job.id)) {
      logger.warn(`Job ID "${job.id}" đã tồn tại. Ghi đè cấu hình mới.`);
    }
    this.jobs.set(job.id, job);
    logger.debug(`Đã đăng ký Job: [${job.id}] - ${job.name} (Cron: ${job.cronSchedule})`);
  }

  registerAll(jobs: BotJob[]) {
    for (const job of jobs) {
      this.register(job);
    }
  }

  get(jobId: string): BotJob | undefined {
    return this.jobs.get(jobId);
  }

  getByCommand(command: string): BotJob | undefined {
    const cleanCmd = command.replace(/^\//, '');
    for (const job of this.jobs.values()) {
      if (job.command === cleanCmd) {
        return job;
      }
    }
    return undefined;
  }

  getAll(): BotJob[] {
    return Array.from(this.jobs.values());
  }

  getEnabled(): BotJob[] {
    return Array.from(this.jobs.values()).filter((j) => j.enabled !== false);
  }
}

export const jobRegistry = new JobRegistry();

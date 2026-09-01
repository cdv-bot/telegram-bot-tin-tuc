import { jobRegistry } from '../core/jobRegistry.js';
import { dailyNewsJob } from './dailyNews/index.js';
import { githubTrendingJob } from './githubTrending/index.js';
import { tradingSignalJob } from './tradingSignal/index.js';
import { goldPriceJob } from './goldPrice/index.js';
import type { BotJob } from '../core/types.js';

// Danh sách tất cả các Jobs của hệ thống
export const registeredJobs: BotJob[] = [
  dailyNewsJob,
  githubTrendingJob,
  tradingSignalJob,
  goldPriceJob,
];

// Đăng ký toàn bộ vào JobRegistry trung tâm
jobRegistry.registerAll(registeredJobs);

export { dailyNewsJob, githubTrendingJob, tradingSignalJob, goldPriceJob };


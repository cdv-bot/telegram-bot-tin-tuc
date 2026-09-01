import { jobRegistry } from '../core/jobRegistry.js';
import { dailyNewsJob } from './dailyNews/index.js';
import type { BotJob } from '../core/types.js';

// Danh sách tất cả các Jobs của hệ thống
export const registeredJobs: BotJob[] = [
  dailyNewsJob,
  // Khi bạn muốn thêm tính năng mới, chỉ cần import và thêm job vào mảng này:
  // myNewCustomJob,
];

// Đăng ký toàn bộ vào JobRegistry trung tâm
jobRegistry.registerAll(registeredJobs);

export { dailyNewsJob };

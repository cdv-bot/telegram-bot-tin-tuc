import { botEngine } from '../core/botEngine.js';
import { schedulerEngine } from '../core/schedulerEngine.js';
import { jobRegistry } from '../core/jobRegistry.js';
// Nạp các jobs
import '../jobs/index.js';

async function main() {
  const jobId = process.argv[2] || 'daily-news';
  console.log(`\n🚀 [KÍCH HOẠT THỦ CÔNG JOB: "${jobId}"]...\n`);

  try {
    const job = jobRegistry.get(jobId);
    if (!job) {
      console.error(`❌ Không tìm thấy Job có ID: "${jobId}".`);
      console.log('📋 Danh sách các Jobs khả dụng:');
      for (const j of jobRegistry.getAll()) {
        console.log(` - ${j.id} (${j.name})`);
      }
      process.exit(1);
    }

    const bot = botEngine.getBot();
    schedulerEngine.setBot(bot);

    const result = await schedulerEngine.executeJob(job, { triggerType: 'MANUAL_CLI' });

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (result.success) {
      console.log(`✅ THỰC THI THÀNH CÔNG JOB [${job.id}]!`);
      console.log(`• Thời gian hoàn thành: ${result.durationMs}ms`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      process.exit(0);
    } else {
      console.error(`❌ THỰC THI THẤT BẠI JOB [${job.id}]!`);
      console.error(`• Chi tiết lỗi: ${result.error}`);
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Lỗi ngoại lệ:', error.message);
    process.exit(1);
  }
}

main();

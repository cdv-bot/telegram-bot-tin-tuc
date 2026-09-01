import { botEngine } from '../core/botEngine.js';
import { schedulerEngine } from '../core/schedulerEngine.js';
import { dailyNewsJob } from '../jobs/dailyNews/index.js';

async function main() {
  console.log('\n🚀 [KÍCH HOẠT GỬI BẢN TIN TỨC THỦ CÔNG (MANUAL TRIGGER)]...\n');

  try {
    const bot = botEngine.getBot();
    schedulerEngine.setBot(bot);

    const result = await schedulerEngine.executeJob(dailyNewsJob, { triggerType: 'MANUAL_CLI' });

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (result.success) {
      console.log('✅ ĐÃ GỬI BẢN TIN THÀNH CÔNG!');
      console.log(`• Thời gian thực thi: ${result.durationMs}ms`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      process.exit(0);
    } else {
      console.error('❌ GỬI BẢN TIN THẤT BẠI!');
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

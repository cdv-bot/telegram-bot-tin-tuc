import { botEngine } from '../core/botEngine.js';
import { getConfig } from '../core/env.js';
import { jobRegistry } from '../core/jobRegistry.js';
import '../jobs/index.js';

async function main() {
  console.log('\n🔍 [KIỂM TRA KẾT NỐI TELEGRAM BOT API & CÁC JOBS]...\n');

  try {
    const config = getConfig();
    console.log(`• Token: ${config.TELEGRAM_BOT_TOKEN.slice(0, 8)}...${config.TELEGRAM_BOT_TOKEN.slice(-4)}`);
    console.log(`• Target Chat ID: ${config.TELEGRAM_CHAT_ID}`);
    console.log(`• Timezone: ${config.TIMEZONE}`);

    const result = await botEngine.verifyConnection();
    if (result.success) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ KẾT NỐI VÀ XÁC THỰC BOT THÀNH CÔNG!');
      console.log(`• Tên Bot: ${result.botInfo.first_name}`);
      console.log(`• Username: @${result.botInfo.username}`);
      console.log(`• Bot ID: ${result.botInfo.id}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('\n📋 DANH SÁCH AUTOMATION JOBS ĐÃ ĐĂNG KÝ:');
      for (const j of jobRegistry.getAll()) {
        const statusIcon = j.enabled !== false ? '🟢' : '⚪';
        const isAuto = j.autoSchedule !== false && !!j.cronSchedule;
        const cronText = isAuto ? j.cronSchedule : 'Tắt tự động (Chạy qua lệnh Bot)';
        console.log(` ${statusIcon} [${j.id}] ${j.name} (Lệnh: /${j.command || 'none'}, Cron: ${cronText})`);
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      process.exit(0);
    } else {
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('❌ KẾT NỐI THẤT BẠI!');
      console.error(`Chi tiết lỗi: ${result.error}`);
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Lỗi kiểm tra cấu hình:', error.message);
    process.exit(1);
  }
}

main();

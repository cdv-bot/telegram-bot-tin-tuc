# 🤖 Telegram Automation Bot Framework (Plugin-Based Architecture)

Hệ thống Telegram Bot tự động hóa theo kiến trúc **Plugin / Job-Based Engine**. Tách biệt hoàn toàn giữa **Core Engine** và **Các tính năng tự động (Automation Jobs)**.

---

## 🌟 Ưu Điểm Kiến Trúc Mới

- **Cốt lõi độc lập (Core Engine)**: Tự động lo toàn bộ hạ tầng:
  - Khởi tạo Telegram Bot & Health check định kỳ.
  - Tự động map lệnh `/command` từ các Job.
  - Quản lý Croner Scheduler đa lịch trình, đúng múi giờ `Asia/Ho_Chi_Minh`.
  - Cơ chế **Thử lại tự động (Retry 3 lần x 5 phút)** khi gửi tin thất bại.
  - Tự động phân đoạn tin nhắn nếu vượt quá 4096 ký tự của Telegram.
  - Ghi log có cấu trúc và cảnh báo tức thì tới Admin khi có sự cố.
- **Thêm tính năng siêu nhanh**: Bạn **chỉ cần tạo 1 file duy nhất** để thêm bất kỳ tác vụ tự động nào mới.

---

## 💡 Cách Thêm 1 Tính Năng Tự Động Mới (Trong 1 Phút)

### Bước 1: Tạo file job tại `src/jobs/myFeature/index.ts`
```typescript
import { defineJob } from '../../core/job.js';

export const myFeatureJob = defineJob({
  id: 'daily-crypto-alert',                  // ID duy nhất
  name: 'Cảnh Báo Giá Crypto',              // Tên hiển thị
  description: 'Gửi giá BTC/ETH lúc 8h00',  // Mô tả
  cronSchedule: '0 8 * * *',                // Chạy lúc 8:00 sáng mỗi ngày
  command: 'crypto',                        // Tự động sinh lệnh /crypto trên Telegram
  
  // Logic nghiệp vụ: Chỉ cần trả về chuỗi HTML hoặc mảng chuỗi cần gửi
  async run(ctx) {
    ctx.logger.info('Đang lấy dữ liệu giá...');
    // Gọi API...
    return `💰 <b>BÁO CÁO GIÁ CRYPTO</b>\n• BTC: $96,500\n• ETH: $2,800`;
  }
});

export default myFeatureJob;
```

### Bước 2: Khai báo vào `src/jobs/index.ts`
```typescript
import { myFeatureJob } from './myFeature/index.js';

export const registeredJobs: BotJob[] = [
  dailyNewsJob,
  myFeatureJob, // <-- Thêm vào đây!
];
```

🎉 **XONG!** Bot sẽ tự động:
- Lên lịch chạy lúc 8:00 sáng.
- Nhận lệnh `/crypto` trong Telegram.
- Áp dụng Retry 3 lần x 5 phút nếu lỗi mạng.
- Ghi log chi tiết mỗi lần gửi.

---

## 🚀 Cài Đặt & Cấu Hình

### 1. File môi trường (.env)
```env
TELEGRAM_BOT_TOKEN="your_bot_token_here"
TELEGRAM_CHAT_ID="your_telegram_id_here"
TELEGRAM_ADMIN_CHAT_ID=""
CRON_SCHEDULE="30 6 * * *"
TIMEZONE="Asia/Ho_Chi_Minh"
```

### 2. Các Lệnh CLI

| Lệnh | Mục đích |
| :--- | :--- |
| `npm run bot:check` | Kiểm tra kết nối Telegram API & liệt kê danh sách Jobs đã nạp |
| `npm run job:run <job_id>` | **Kích hoạt chạy thử ngay bất kỳ Job nào** (vd: `npm run job:run daily-news`) |
| `npm run digest:now` | Chạy nhanh tính năng Bản tin sáng |
| `npm test` | Chạy toàn bộ 15 Unit & Integration tests |
| `npm run build` | Biên dịch TypeScript |
| `npm start` | Chạy toàn bộ hệ thống Bot & Scheduler |

---

## 📁 Cấu Trúc Thư Mục Sau Refactor

```text
src/
├── core/                         # HỆ THỐNG CỐT LÕI (CORE ENGINE)
│   ├── types.ts                  # BotJob, JobContext, JobResult
│   ├── job.ts                    # Helper defineJob()
│   ├── jobRegistry.ts            # Quản lý & nạp Jobs
│   ├── deliveryService.ts        # Bộ gửi tin Telegram + Retry 3 lần x 5p + Format
│   ├── schedulerEngine.ts        # Động cơ Croner tự động cho mọi Job
│   ├── botEngine.ts              # Telegram Bot & Dynamic Command Mapper
│   ├── logger.ts                 # Pino Logger & Delivery Log
│   └── env.ts                    # Validate biến môi trường (Zod)
│
├── jobs/                         # DANH SÁCH CÁC TÍNH NĂNG TỰ ĐỘNG (PLUGINS)
│   ├── dailyNews/                # Tính năng 1: Bản tin tức hàng ngày (6h30)
│   │   ├── index.ts              # defineJob({ id: 'daily-news', ... })
│   │   ├── fetcher.ts            # Thu thập RSS
│   │   ├── deduplicator.ts       # Lọc trùng 48h & độ tương đồng
│   │   ├── summarizer.ts         # Tóm tắt súc tích
│   │   └── formatter.ts          # Template HTML
│   └── index.ts                  # Central Registry Exporter
│
├── cli/
│   ├── checkConnection.ts        # CLI check kết nối & list jobs
│   ├── runJob.ts                 # CLI chạy job tức thì
│   └── manualDigest.ts           # CLI trigger bản tin
│
└── index.ts                      # Entrypoint khởi động gọn nhẹ (15 dòng)
```

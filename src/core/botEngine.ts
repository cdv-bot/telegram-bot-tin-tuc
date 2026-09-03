import { Bot, InlineKeyboard } from 'grammy';
import { getConfig } from './env.js';
import { logger } from './logger.js';
import { jobRegistry } from './jobRegistry.js';
import { schedulerEngine } from './schedulerEngine.js';

export class BotEngine {
  private bot: Bot | null = null;
  private forexBot: Bot | null = null;
  private healthIntervalId: NodeJS.Timeout | null = null;

  getMainBot(): Bot {
    if (this.bot) return this.bot;
    const config = getConfig();
    this.bot = new Bot(config.TELEGRAM_BOT_TOKEN);

    this.bot.catch((err) => {
      const ctx = err.ctx;
      logger.error({ error: err.error, updateId: ctx.update.update_id }, '⚠️ [Main Bot] Lỗi xảy ra trong quá trình xử lý');
    });

    schedulerEngine.setBot(this.bot);
    return this.bot;
  }

  getForexBot(): Bot | null {
    const config = getConfig();
    if (!config.TELEGRAM_FOREX_BOT_TOKEN) return null;
    if (this.forexBot) return this.forexBot;

    this.forexBot = new Bot(config.TELEGRAM_FOREX_BOT_TOKEN);

    this.forexBot.catch((err) => {
      const ctx = err.ctx;
      logger.error({ error: err.error, updateId: ctx.update.update_id }, '⚠️ [Forex Bot] Lỗi xảy ra trong quá trình xử lý');
    });

    schedulerEngine.setForexBot(this.forexBot);
    return this.forexBot;
  }

  // Phương thức tương thích ngược
  getBot(): Bot {
    return this.getMainBot();
  }

  async verifyConnections(): Promise<{ mainBot?: any; forexBot?: any }> {
    const mainBot = this.getMainBot();
    const mainInfo = await mainBot.api.getMe();
    logger.info(`✅ [Main Bot: News & GitHub] Xác thực thành công: @${mainInfo.username} (ID: ${mainInfo.id})`);

    const forexBot = this.getForexBot();
    let forexInfo: any = null;
    if (forexBot) {
      forexInfo = await forexBot.api.getMe();
      logger.info(`✅ [Forex Bot: Trading Limit] Xác thực thành công: @${forexInfo.username} (ID: ${forexInfo.id})`);
    }

    return { mainBot: mainInfo, forexBot: forexInfo };
  }

  async verifyConnection() {
    try {
      const res = await this.verifyConnections();
      return { success: true, botInfo: res.mainBot };
    } catch (error: any) {
      const message = error?.message || String(error);
      logger.error({ error: message }, '❌ Không thể kết nối hoặc xác thực Telegram Bot');
      return { success: false, error: message };
    }
  }

  startPeriodicHealthCheck(intervalMs?: number) {
    const config = getConfig();
    const interval = intervalMs || config.HEALTH_CHECK_INTERVAL_MS;

    logger.info(`Đã kích hoạt giám sát kết nối định kỳ (chu kỳ: ${Math.round(interval / 60000)} phút)`);

    this.healthIntervalId = setInterval(async () => {
      logger.debug('Đang kiểm tra kết nối định kỳ tới Telegram API...');
      const result = await this.verifyConnection();
      if (!result.success) {
        logger.warn(`⚠️ Cảnh báo: Định kỳ kiểm tra kết nối Telegram thất bại: ${result.error}`);
      }
    }, interval);
  }

  /**
   * Đăng ký lệnh cho từng Bot tương ứng
   */
  registerCommands() {
    const mainBot = this.getMainBot();
    const forexBot = this.getForexBot();
    const config = getConfig();

    // Thiết lập orderTracker gửi qua Forex Bot nếu có, hoặc qua Main Bot
    import('../jobs/tradingSignal/orderTracker.js').then(({ orderTracker }) => {
      orderTracker.setBot(forexBot || mainBot);
    });

    // =========================================================================
    // 1. ĐĂNG KÝ LỆNH CHO MAIN BOT (Tin tức & GitHub Trending)
    // =========================================================================
    mainBot.command('digest', async (ctx) => {
      const job = jobRegistry.get('daily-news');
      if (job) {
        await ctx.reply(`⏳ Đang tổng hợp <b>${job.name}</b>...`, { parse_mode: 'HTML' });
        const result = await schedulerEngine.executeJob(job, {
          customChatId: ctx.chat.id,
          triggerType: 'BOT_COMMAND',
        });
        if (!result.success) {
          await ctx.reply(`❌ Có lỗi: ${result.error || 'Không xác định'}`);
        }
      }
    });

    // Lắng nghe lệnh GitHub Trending trên Main Bot
    const handleGitHubTrending = async (ctx: any) => {
      const job = jobRegistry.get('github-trending');
      if (job) {
        await ctx.reply(`⏳ Đang lấy danh sách <b>${job.name}</b>...`, { parse_mode: 'HTML' });
        const result = await schedulerEngine.executeJob(job, {
          customChatId: ctx.chat.id,
          triggerType: 'BOT_COMMAND',
        });
        if (!result.success) {
          await ctx.reply(`❌ Có lỗi: ${result.error || 'Không xác định'}`);
        }
      }
    };

    mainBot.hears(/^\/(?:github[-_]?trending|trending|github)(?:@\w+)?(?:\s+(.*))?$/i, handleGitHubTrending);
    mainBot.command(['github_trending', 'githubtrending', 'trending', 'github'], handleGitHubTrending);

    // Lệnh tiện ích chung trên Main Bot
    this.registerCommonCommands(mainBot, 'Tin Tức & GitHub Trending');

    // =========================================================================
    // 2. ĐĂNG KÝ LỆNH CHO FOREX BOT (Trading Limit & Giá Vàng)
    // =========================================================================
    const targetForexBot = forexBot || mainBot;

    // 2.1 Lệnh Đặt Limit Trading (/bl, /sl, /buylimit, /selllimit...)
    targetForexBot.hears(/^\/(?:bl|buylimit|buy_limit|sl|selllimit|sell_limit|sl_limit|slimit)(?:@\w+)?(?:\s+(.*))?$/i, async (ctx) => {
      const { parseTradeOrder, formatTradeOrderToHtml, orderTracker } = await import('../jobs/tradingSignal/index.js');
      const text = ctx.message?.text || '';
      const parsed = parseTradeOrder(text);

      if (!parsed.success) {
        let helpMsg = `⚠️ <b>${parsed.error}</b>\n\n`;
        helpMsg += `👉 <b>Cú pháp chuẩn:</b>\n`;
        helpMsg += `• <b>Buy Limit:</b> <code>/bl &lt;Entry&gt; &lt;TP&gt; &lt;SL&gt;</code>\n`;
        helpMsg += `  <i>Ví dụ:</i> <code>/bl 4420</code> hoặc <code>/bl 4420 4430 4410</code>\n`;
        helpMsg += `  <i>Hoặc kèm mã:</i> <code>/bl XAUUSD 4420 4430 4410</code>\n\n`;
        helpMsg += `• <b>Sell Limit:</b> <code>/sl &lt;Entry&gt; &lt;TP&gt; &lt;SL&gt;</code>\n`;
        helpMsg += `  <i>Ví dụ:</i> <code>/sl 4430</code> hoặc <code>/sl 4430 4425 4435</code>\n`;
        helpMsg += `  <i>Hoặc kèm mã:</i> <code>/sl BTC 95000 90000 97000</code>`;
        await ctx.reply(helpMsg, { parse_mode: 'HTML' });
        return;
      }

      const tracked = orderTracker.addOrder(parsed.order, ctx.chat.id);
      const html = formatTradeOrderToHtml(tracked);
      const keyboard = new InlineKeyboard().text(`🗑️ Hủy lệnh #${tracked.id}`, `del:${tracked.id}`);
      await ctx.reply(html, { parse_mode: 'HTML', reply_markup: keyboard });
    });

    // 2.2 Lệnh xem danh sách lệnh đang theo dõi (/orders, /active, /lenh)
    targetForexBot.command(['orders', 'active', 'lenh'], async (ctx) => {
      const { orderTracker } = await import('../jobs/tradingSignal/index.js');
      const active = orderTracker.getActiveOrders(ctx.chat.id);
      if (active.length === 0) {
        await ctx.reply('📭 <i>Bạn hiện không có lệnh Limit nào đang theo dõi.</i>\n\n👉 Đặt lệnh mới: <code>/bl 4426 4427 4425</code>', { parse_mode: 'HTML' });
        return;
      }

      let msg = `📋 <b>DANH SÁCH LỆNH ĐANG THEO DÕI (${active.length}):</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      const keyboard = new InlineKeyboard();

      active.forEach((o, i) => {
        const icon = o.orderType.startsWith('BUY') ? '🟢' : '🔴';
        const statusIcon = o.status === 'FILLED' ? '⚡ [ĐÃ KHỚP ENTRY]' : '⏳ [CHỜ KHỚP]';
        msg += `<b>${i + 1}.</b> <code>#${o.id}</code> | ${icon} <b>${o.orderType.replace('_', ' ')}</b> ${statusIcon}\n`;
        msg += `   📍 Entry: <code>${o.entry}</code> | 🎯 TP: <code>${o.tp}</code> | 🛑 SL: <code>${o.sl}</code>\n`;
        msg += `   ⚖️ R:R: <code>1:${o.riskRewardRatio}</code>\n\n`;

        keyboard.text(`🗑️ Xóa #${o.id}`, `del:${o.id}`).row();
      });

      keyboard.text(`🗑️ Xóa toàn bộ (${active.length} lệnh)`, `del:all`);
      msg += `💡 <i>Bấm nút bên dưới để xóa nhanh, hoặc gõ: <code>/del &lt;mã_lệnh&gt;</code></i>`;
      await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: keyboard });
    });

    // 2.3 Lệnh xóa / hủy lệnh Limit (/del, /delete, /xoa, /cancel, /huy)
    targetForexBot.hears(/^\/(?:del|delete|xoa|cancel|huy)(?:@\w+)?(?:\s+(.*))?$/i, async (ctx) => {
      const { orderTracker } = await import('../jobs/tradingSignal/index.js');
      const text = ctx.message?.text || '';
      const parts = text.trim().split(/\s+/);
      const target = parts[1] ? parts[1].replace('#', '') : '';

      if (!target) {
        const active = orderTracker.getActiveOrders(ctx.chat.id);
        if (active.length === 0) {
          await ctx.reply('📭 <i>Hiện không có lệnh nào để xóa.</i>', { parse_mode: 'HTML' });
          return;
        }

        const keyboard = new InlineKeyboard();
        active.forEach((o) => {
          keyboard.text(`🗑️ Xóa #${o.id} (${o.orderType.replace('_', ' ')} ${o.entry})`, `del:${o.id}`).row();
        });
        keyboard.text('🗑️ Xóa toàn bộ lệnh', 'del:all');

        await ctx.reply('👉 <b>Chọn lệnh bạn muốn xóa:</b>', { parse_mode: 'HTML', reply_markup: keyboard });
        return;
      }

      if (target.toLowerCase() === 'all') {
        const count = orderTracker.deleteAllOrders(ctx.chat.id);
        await ctx.reply(`🗑️ Đã xóa toàn bộ <b>${count}</b> lệnh khỏi hệ thống!`, { parse_mode: 'HTML' });
        return;
      }

      const ok = orderTracker.deleteOrder(target, ctx.chat.id);
      if (ok) {
        await ctx.reply(`✅ Đã xóa thành công lệnh <code>#${target}</code>!`, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(`❌ Không tìm thấy mã lệnh <code>#${target}</code>.`, { parse_mode: 'HTML' });
      }
    });

    // 2.4 Callback Button xóa lệnh
    targetForexBot.callbackQuery(/^del:(.+)$/, async (ctx) => {
      const { orderTracker } = await import('../jobs/tradingSignal/index.js');
      const match = ctx.match;
      const target = typeof match === 'string' ? match : Array.isArray(match) ? match[1] : (match as any)[1] || '';

      if (!target) return;

      if (target === 'all') {
        const count = orderTracker.deleteAllOrders(ctx.chat?.id);
        await ctx.answerCallbackQuery({ text: `Đã xóa toàn bộ ${count} lệnh!` });
        await ctx.reply(`🗑️ <b>Đã xóa thành công toàn bộ ${count} lệnh theo dõi!</b>`, { parse_mode: 'HTML' });
      } else {
        const ok = orderTracker.deleteOrder(target, ctx.chat?.id);
        if (ok) {
          await ctx.answerCallbackQuery({ text: `Đã xóa lệnh #${target}!` });
          await ctx.reply(`🗑️ Đã xóa lệnh <code>#${target}</code> thành công!`, { parse_mode: 'HTML' });
        } else {
          await ctx.answerCallbackQuery({ text: `Lệnh #${target} không còn tồn tại!` });
        }
      }
    });

    // 2.5 Giá Vàng Realtime (/gold, /xau, /giavang, /goldprice, /vang)
    targetForexBot.hears(/^\/(?:gold|xau|giavang|goldprice|vang)(?:@\w+)?(?:\s+(.*))?$/i, async (ctx) => {
      const job = jobRegistry.get('gold-price');
      if (job) {
        await ctx.reply(`⏳ Đang lấy giá vàng thế giới realtime từ Gold Price API...`, { parse_mode: 'HTML' });
        const result = await schedulerEngine.executeJob(job, {
          customChatId: ctx.chat.id,
          triggerType: 'BOT_COMMAND',
        });
        if (!result.success) {
          await ctx.reply(`❌ Có lỗi khi lấy giá vàng: ${result.error || 'Không xác định'}`);
        }
      }
    });

    // Tiện ích chung trên Forex Bot
    if (forexBot) {
      this.registerCommonCommands(forexBot, 'Forex Limit & Trading Alert');
    }
  }

  private registerCommonCommands(botInstance: Bot, botRole: string) {
    const config = getConfig();

    // Lệnh /id
    botInstance.command(['id', 'chatid', 'roomid', 'myid'], async (ctx) => {
      const typeLabel = ctx.chat.type === 'private' ? 'Cá nhân (Private)' : ctx.chat.type === 'group' ? 'Nhóm (Group)' : ctx.chat.type === 'supergroup' ? 'Siêu nhóm (Supergroup)' : 'Kênh (Channel)';
      let msg = `📍 <b>THÔNG TIN PHÒNG CHAT NÀY:</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `• <b>Chat ID:</b> <code>${ctx.chat.id}</code>\n`;
      msg += `• <b>Loại phòng:</b> ${typeLabel}\n`;
      if ('title' in ctx.chat && ctx.chat.title) {
        msg += `• <b>Tên phòng:</b> ${ctx.chat.title}\n`;
      }
      await ctx.reply(msg, { parse_mode: 'HTML' });
    });

    // Lệnh /start và /help
    botInstance.command(['start', 'help'], async (ctx) => {
      let msg = `👋 <b>Chào mừng bạn đến với ${botRole} Bot!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      msg += `📋 <b>Danh sách tính năng & Lệnh khả dụng:</b>\n`;

      if (botRole.includes('Forex')) {
        msg += `• <b>/bl &lt;Entry&gt; &lt;TP&gt; &lt;SL&gt;</b>: Đặt lệnh Buy Limit\n`;
        msg += `• <b>/sl &lt;Entry&gt; &lt;TP&gt; &lt;SL&gt;</b>: Đặt lệnh Sell Limit\n`;
        msg += `• <b>/orders</b>: Xem danh sách lệnh đang theo dõi\n`;
        msg += `• <b>/cancel &lt;mã_lệnh&gt;</b>: Hủy lệnh theo dõi\n`;
        msg += `• <b>/gold</b>: Xem giá vàng XAU/USD realtime\n`;
      } else {
        msg += `• <b>/digest</b>: Lấy bản tin điểm tin tức tổng hợp sáng\n`;
        msg += `• <b>/github_trending</b>: Xem top GitHub Trending Repositories (hoặc /trending)\n`;
      }

      msg += `\n⚙️ <b>Lệnh hệ thống:</b>\n`;
      msg += `• /status - Xem trạng thái hệ thống và lịch chạy\n`;
      msg += `• /id - Xem Chat ID phòng hiện tại\n`;
      msg += `• /help - Xem hướng dẫn này\n`;

      await ctx.reply(msg, { parse_mode: 'HTML' });
    });

    // Lệnh /status
    botInstance.command('status', async (ctx) => {
      const uptimeHours = (process.uptime() / 3600).toFixed(2);
      const scheduleInfo = schedulerEngine.getJobScheduleInfo();

      let msg = `📊 <b>TRẠNG THÁI HỆ THỐNG [${botRole}]</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `• <b>Trạng thái</b>: 🟢 Hoạt động bình thường\n`;
      msg += `• <b>Uptime</b>: ${uptimeHours} giờ\n`;
      msg += `• <b>Timezone</b>: ${config.TIMEZONE}\n`;
      msg += `• <b>Số Jobs đang chạy</b>: ${scheduleInfo.length}\n\n`;
      msg += `📅 <b>Lịch trình tác vụ tự động:</b>\n`;

      for (const info of scheduleInfo) {
        msg += `• <b>${info.name}</b>\n  ⏰ Cron: <code>${info.cron}</code> | Kế tiếp: <i>${info.nextRun}</i>\n`;
      }

      await ctx.reply(msg, { parse_mode: 'HTML' });
    });
  }

  /**
   * Tự động đồng bộ danh sách lệnh vào Menu Tag "/" của từng Bot
   */
  async syncBotMenuCommands() {
    try {
      const mainBot = this.getMainBot();
      const mainCommands = [
        { command: 'digest', description: 'Xem bản tin điểm tin tổng hợp sáng' },
        { command: 'github_trending', description: 'Top GitHub Trending hôm nay' },
        { command: 'trending', description: 'Xem nhanh GitHub Trending' },
        { command: 'id', description: 'Xem Chat ID phòng chat hiện tại' },
        { command: 'status', description: 'Xem trạng thái hệ thống & lịch chạy' },
        { command: 'help', description: 'Xem hướng dẫn sử dụng' },
      ];
      await mainBot.api.setMyCommands(mainCommands);
      logger.info(`✅ [Main Bot] Đã đồng bộ ${mainCommands.length} lệnh vào Menu Tag [/]`);

      const forexBot = this.getForexBot();
      if (forexBot) {
        const forexCommands = [
          { command: 'bl', description: 'Đặt lệnh Buy Limit (vd: /bl 4420 4430 4410)' },
          { command: 'sl', description: 'Đặt lệnh Sell Limit (vd: /sl 4430 4425 4435)' },
          { command: 'orders', description: 'Xem danh sách lệnh Limit đang theo dõi' },
          { command: 'cancel', description: 'Hủy lệnh Limit (vd: /cancel ORD-123456 hoặc all)' },
          { command: 'gold', description: 'Xem giá Vàng XAU/USD realtime' },
          { command: 'id', description: 'Xem Chat ID phòng chat hiện tại' },
          { command: 'status', description: 'Xem trạng thái hệ thống & lịch chạy' },
          { command: 'help', description: 'Xem hướng dẫn sử dụng' },
        ];
        await forexBot.api.setMyCommands(forexCommands);
        logger.info(`✅ [Forex Bot] Đã đồng bộ ${forexCommands.length} lệnh vào Menu Tag [/]`);
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, '⚠️ Không thể đồng bộ Menu lệnh tới Telegram API');
    }
  }

  async start() {
    this.registerCommands();
    await this.syncBotMenuCommands();
    this.startPeriodicHealthCheck();

    const mainBot = this.getMainBot();
    logger.info('🚀 Đang chạy Main Bot (@tin_tuc_auto_bot) Long Polling...');
    mainBot.start({
      onStart: (botInfo) => {
        logger.info(`🤖 Main Bot @${botInfo.username} đã sẵn sàng phục vụ.`);
      },
    });

    const forexBot = this.getForexBot();
    if (forexBot) {
      logger.info('🚀 Đang chạy Forex Bot (@forex_limit_bot) Long Polling...');
      forexBot.start({
        onStart: (botInfo) => {
          logger.info(`📈 Forex Bot @${botInfo.username} đã sẵn sàng phục vụ.`);
        },
      });
    }
  }

  stop() {
    if (this.healthIntervalId) {
      clearInterval(this.healthIntervalId);
    }
    if (this.bot) {
      this.bot.stop();
    }
    if (this.forexBot) {
      this.forexBot.stop();
    }
  }
}

export const botEngine = new BotEngine();

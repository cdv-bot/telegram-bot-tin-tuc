import axios from "axios";
import { logger } from "../../core/logger.js";

export interface SjcGoldRawItem {
  buy_1c?: string;
  sell_1c?: string;
  buy_1l?: string;
  sell_1l?: string;
  buy_5c?: string;
  sell_5c?: string;
  buy_nhan1c?: string;
  sell_nhan1c?: string;
  buy_nutrang_75?: string;
  sell_nutrang_75?: string;
  buy_nutrang_99?: string;
  sell_nutrang_99?: string;
  buy_nutrang_9999?: string;
  sell_nutrang_9999?: string;
  datetime?: string;
}

export interface SjcGoldPriceData {
  buy1L: number;
  sell1L: number;
  buyNhan1C: number;
  sellNhan1C: number;
  buyNuTrang9999: number;
  sellNuTrang9999: number;
  buyNuTrang99: number;
  sellNuTrang99: number;
  buyNuTrang75: number;
  sellNuTrang75: number;
  updatedAt: string;
}

class VnAppMobClient {
  private cachedApiKey: string | null = null;
  private readonly baseUrl = "https://api.vnappmob.com/api";

  /**
   * Tự động lấy API key từ env hoặc đăng ký token miễn phí từ API VNAppMob
   */
  async getApiKey(): Promise<string> {
    if (process.env.VNAPPMOB_API_KEY && process.env.VNAPPMOB_API_KEY.trim() !== "") {
      return process.env.VNAPPMOB_API_KEY.trim();
    }

    if (this.cachedApiKey) {
      return this.cachedApiKey;
    }

    try {
      logger.info("🔑 Đang đăng ký API Key miễn phí từ VNAppMob (scope=gold)...");
      const res = await axios.get<{ results: string }>(
        this.baseUrl + "/request_api_key?scope=gold",
        {
          timeout: 10000,
          headers: {
            Accept: "application/json",
            "User-Agent": "TelegramNewsBot/1.0",
          },
        }
      );

      if (res.data && res.data.results) {
        this.cachedApiKey = res.data.results;
        logger.info("✅ Đã nhận API Key từ VNAppMob thành công.");
        return this.cachedApiKey;
      }

      throw new Error("Phản hồi không chứa token results");
    } catch (err: any) {
      logger.error({ error: err.message }, "❌ Lỗi khi lấy API Key VNAppMob");
      throw new Error("Không thể lấy API Key từ VNAppMob: " + err.message);
    }
  }

  /**
   * Gọi API lấy giá vàng SJC thời gian thực
   */
  async getSjcGoldPrice(): Promise<SjcGoldPriceData> {
    const fetchWithToken = async (token: string) => {
      return axios.get<{ results: SjcGoldRawItem[] }>(
        this.baseUrl + "/v2/gold/sjc",
        {
          timeout: 12000,
          headers: {
            Accept: "application/json",
            Authorization: "Bearer " + token,
            "User-Agent": "TelegramNewsBot/1.0",
          },
        }
      );
    };

    let token = await this.getApiKey();
    let res;

    try {
      res = await fetchWithToken(token);
    } catch (err: any) {
      if (err.response && err.response.status === 401) {
        logger.warn("⚠️ Token VNAppMob hết hạn (401), đang làm mới token...");
        this.cachedApiKey = null;
        token = await this.getApiKey();
        res = await fetchWithToken(token);
      } else {
        throw err;
      }
    }

    const rawList = res.data && res.data.results;
    if (!rawList || !Array.isArray(rawList) || rawList.length === 0) {
      throw new Error("Dữ liệu giá vàng trả về từ VNAppMob rỗng");
    }

    const item = rawList[0];
    if (!item) {
      throw new Error("Dữ liệu giá vàng trả về từ VNAppMob rỗng");
    }

    let updatedAtStr = new Date().toISOString();
    if (item.datetime) {
      const ts = parseInt(item.datetime, 10);
      if (!isNaN(ts)) {
        const ms = ts < 10000000000 ? ts * 1000 : ts;
        updatedAtStr = new Date(ms).toISOString();
      }
    }

    return {
      buy1L: parseFloat(item.buy_1l || "0"),
      sell1L: parseFloat(item.sell_1l || "0"),
      buyNhan1C: parseFloat(item.buy_nhan1c || "0"),
      sellNhan1C: parseFloat(item.sell_nhan1c || "0"),
      buyNuTrang9999: parseFloat(item.buy_nutrang_9999 || "0"),
      sellNuTrang9999: parseFloat(item.sell_nutrang_9999 || "0"),
      buyNuTrang99: parseFloat(item.buy_nutrang_99 || "0"),
      sellNuTrang99: parseFloat(item.sell_nutrang_99 || "0"),
      buyNuTrang75: parseFloat(item.buy_nutrang_75 || "0"),
      sellNuTrang75: parseFloat(item.sell_nutrang_75 || "0"),
      updatedAt: updatedAtStr,
    };
  }

  /**
   * Định dạng dữ liệu giá vàng SJC thành HTML chuẩn Telegram
   */
  formatSjcToHtml(data: SjcGoldPriceData): string {
    const formatMil = (val: number): string => {
      if (!val || val <= 0) return "0.00";
      return (val / 1000000).toLocaleString("vi-VN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    };

    const formatPerChi = (valPerLuong: number): string => {
      if (!valPerLuong || valPerLuong <= 0) return "0";
      return Math.round(valPerLuong / 10).toLocaleString("vi-VN");
    };

    const updatedDate = new Date(data.updatedAt);
    const timeStr = updatedDate.toLocaleTimeString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const dateStr = updatedDate.toLocaleDateString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const spread1L = data.sell1L - data.buy1L;
    const spreadNhan = data.sellNhan1C - data.buyNhan1C;

    const parts: string[] = [];
    parts.push("🇻🇳 <b>BẢNG GIÁ VÀNG SJC VIỆT NAM (REALTIME)</b>");
    parts.push("━━━━━━━━━━━━━━━━━━━━\n");

    // 1. Vàng miếng SJC 1 Lượng
    parts.push("🏆 <b>VÀNG MIẾNG SJC (1 LƯỢNG):</b>");
    parts.push("• Mua vào: <b>" + formatMil(data.buy1L) + "</b> triệu đ/lượng");
    parts.push("• Bán ra: <b>" + formatMil(data.sell1L) + "</b> triệu đ/lượng");
    if (spread1L > 0) {
      parts.push("• Chênh lệch: <code>" + (spread1L / 1000000).toFixed(2) + " triệu đ/lượng</code>\n");
    } else {
      parts.push("");
    }

    // 2. Vàng nhẫn SJC
    parts.push("💍 <b>VÀNG NHẪN SJC (1 CHỈ / 99.99%):</b>");
    parts.push("• Mua vào: <b>" + formatMil(data.buyNhan1C) + "</b> tr/lượng (~<b>" + formatPerChi(data.buyNhan1C) + "</b> đ/chỉ)");
    parts.push("• Bán ra: <b>" + formatMil(data.sellNhan1C) + "</b> tr/lượng (~<b>" + formatPerChi(data.sellNhan1C) + "</b> đ/chỉ)");
    if (spreadNhan > 0) {
      parts.push("• Chênh lệch: <code>" + (spreadNhan / 1000000).toFixed(2) + " triệu đ/lượng</code>\n");
    } else {
      parts.push("");
    }

    // 3. Nữ trang 99.99%
    parts.push("✨ <b>VÀNG NỮ TRANG 99.99%:</b>");
    parts.push("• Mua vào: <b>" + formatMil(data.buyNuTrang9999) + "</b> triệu đ/lượng");
    parts.push("• Bán ra: <b>" + formatMil(data.sellNuTrang9999) + "</b> triệu đ/lượng\n");

    // 4. Nữ trang 75% (18K)
    if (data.buyNuTrang75 > 0 && data.sellNuTrang75 > 0) {
      parts.push("🔸 <b>VÀNG NỮ TRANG 75% (18K):</b>");
      parts.push("• Mua vào: <b>" + formatMil(data.buyNuTrang75) + "</b> triệu đ/lượng");
      parts.push("• Bán ra: <b>" + formatMil(data.sellNuTrang75) + "</b> triệu đ/lượng\n");
    }

    parts.push("━━━━━━━━━━━━━━━━━━━━");
    parts.push("⏰ <b>Cập nhật:</b> <i>" + timeStr + " (" + dateStr + ")</i>");
    parts.push("📡 <i>Nguồn: VNAppMob (SJC Realtime)</i>");
    parts.push("💡 <i>Gõ lệnh <code>/price_gold</code> để cập nhật giá mới nhất.</i>");

    return parts.join("\n");
  }
}

export const vnAppMobClient = new VnAppMobClient();
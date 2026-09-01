import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../../core/logger.js';

export interface TrendingRepo {
  name: string;
  url: string;
  description: string;
  language: string;
  stars: string;
  forks: string;
  starsToday: string;
}

export interface FetchTrendingOptions {
  language?: string;
  since?: 'daily' | 'weekly' | 'monthly';
  limit?: number;
}

/**
 * Thu thập danh sách GitHub Trending repositories
 */
export async function fetchGitHubTrending(options: FetchTrendingOptions = {}): Promise<TrendingRepo[]> {
  const { language = '', since = 'daily', limit = 10 } = options;
  
  let targetUrl = 'https://github.com/trending';
  if (language) {
    targetUrl += `/${encodeURIComponent(language)}`;
  }
  targetUrl += `?since=${since}`;

  logger.info({ url: targetUrl }, 'Đang thu thập dữ liệu GitHub Trending...');

  try {
    const response = await axios.get(targetUrl, {
      timeout: 15000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const $ = cheerio.load(response.data);
    const repos: TrendingRepo[] = [];

    $('article.Box-row').each((_, element) => {
      if (repos.length >= limit) return;

      const titleAnchor = $(element).find('h2 a');
      const href = titleAnchor.attr('href')?.trim() || '';
      const rawName = href.replace(/^\//, '');
      const cleanName = rawName.replace(/\s+/g, '');

      if (!cleanName) return;

      const description = $(element).find('p').text().trim();
      const progLanguage = $(element).find('[itemprop="programmingLanguage"]').text().trim();
      
      const starText = $(element).find('a[href*="/stargazers"]').text().trim().replace(/,/g, '');
      const forkText = $(element).find('a[href*="/forks"]').text().trim().replace(/,/g, '');
      
      const starsTodayText = $(element).find('span.d-inline-block.float-sm-right').text().trim();

      repos.push({
        name: cleanName,
        url: `https://github.com/${cleanName}`,
        description,
        language: progLanguage || 'N/A',
        stars: starText || '0',
        forks: forkText || '0',
        starsToday: starsTodayText || '',
      });
    });

    logger.info(`Đã thu thập thành công ${repos.length} GitHub Trending repositories.`);
    return repos;
  } catch (error: any) {
    logger.error({ error: error.message, url: targetUrl }, 'Lỗi khi cào dữ liệu GitHub Trending');
    throw error;
  }
}

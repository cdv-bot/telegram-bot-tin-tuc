import { describe, it, expect } from 'vitest';
import { fetchGitHubTrending } from '../src/jobs/githubTrending/fetcher.js';
import { formatGitHubTrendingToHtml } from '../src/jobs/githubTrending/formatter.js';
import { jobRegistry } from '../src/core/jobRegistry.js';
import '../src/jobs/index.js';

describe('GitHub Trending Job', () => {
  it('should format trending repos to HTML correctly with escaping', () => {
    const mockRepos = [
      {
        name: 'owner/<script>alert("xss")</script>',
        url: 'https://github.com/owner/xss',
        description: 'Testing <b>bold</b> & description',
        language: 'TypeScript',
        stars: '15200',
        forks: '1200',
        starsToday: '450 stars today',
      },
    ];

    const messages = formatGitHubTrendingToHtml(mockRepos, { since: 'daily' });
    expect(messages.length).toBeGreaterThan(0);
    const msg = messages[0];

    // Check header
    expect(msg).toContain('TOP GITHUB TRENDING');
    // Check escaping
    expect(msg).toContain('&lt;script&gt;alert("xss")&lt;/script&gt;');
    expect(msg).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; description');
    // Check stats
    expect(msg).toContain('15,200');
    expect(msg).toContain('TypeScript');
    expect(msg).toContain('450 stars today');
  });

  it('should return empty message when repos list is empty', () => {
    const messages = formatGitHubTrendingToHtml([]);
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain('Hiện không tìm thấy repository thịnh hành nào');
  });

  it('should be properly registered in jobRegistry', () => {
    const job = jobRegistry.get('github-trending');
    expect(job).toBeDefined();
    expect(job?.name).toBe('GitHub Trending Repositories');
    expect(job?.command).toBe('github_trending');
  });

  it('should match trending command regex variants', () => {
    const regex = /^\/(?:github[-_]?trending|trending|github)(?:@\w+)?(?:\s+(.*))?$/i;
    expect(regex.test('/github-trending')).toBe(true);
    expect(regex.test('/github_trending')).toBe(true);
    expect(regex.test('/github')).toBe(true);
    expect(regex.test('/trending')).toBe(true);
    expect(regex.test('/github_trending@mybot')).toBe(true);
    expect(regex.test('/gitjub_trending')).toBe(false);
  });

  it('should route to TELEGRAM_GITHUB_CHAT_ID when configured', () => {
    const job = jobRegistry.get('github-trending');
    expect(typeof job?.targetChatId).toBe('function');
    if (typeof job?.targetChatId === 'function') {
      const target = job.targetChatId({
        TELEGRAM_GITHUB_CHAT_ID: '-100987654321',
        TELEGRAM_CHAT_ID: '6293556896',
      } as any);
      expect(target).toBe('-100987654321');

      const fallbackTarget = job.targetChatId({
        TELEGRAM_GITHUB_CHAT_ID: '',
        TELEGRAM_CHAT_ID: '6293556896',
      } as any);
      expect(fallbackTarget).toBe('6293556896');
    }
  });

  it('should fetch live trending repos from GitHub', async () => {
    const repos = await fetchGitHubTrending({ limit: 5 });
    expect(Array.isArray(repos)).toBe(true);
    expect(repos.length).toBeGreaterThan(0);
    expect(repos[0]).toHaveProperty('name');
    expect(repos[0]).toHaveProperty('url');
    expect(repos[0].url).toMatch(/^https:\/\/github\.com\//);
  }, 20000);
});

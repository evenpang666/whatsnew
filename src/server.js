import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createProjectZip } from './zip.js';
import { lanAddresses } from './network.js';

const publicRoot = new URL('../public/', import.meta.url);
export async function startServer(service, { port = 3210, host = '0.0.0.0' } = {}) {
  const token = randomBytes(32).toString('hex');
  const addresses = lanAddresses();
  const json = (res, status, data) => { if (!res.headersSent) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); } };
  const server = createServer(async (req, res) => {
    try {
      const addresses = lanAddresses();
      const expectedHosts = new Set(['127.0.0.1', 'localhost', ...addresses, ...(host === '0.0.0.0' ? [] : [host])].map(h => `${h}:${server.address().port}`));
      if (!expectedHosts.has(req.headers.host)) return json(res, 403, { error: '访问地址无效，请使用页面提供的局域网 URL。' });
      const origin = req.headers.origin;
      if (origin && !expectedHosts.has(new URL(origin).host)) return json(res, 403, { error: '不允许跨站请求。' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: '不允许跨站请求。' });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://github.com https://avatars.githubusercontent.com; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
      const url = new URL(req.url, `http://${req.headers.host}`);
      const supplied = Buffer.from(String(req.headers['x-whatsnew-token'] || ''));
      const correct = Buffer.from(token);
      const authorized = supplied.length === correct.length && timingSafeEqual(supplied, correct);
      if (req.method === 'POST' && !authorized) return json(res, 403, { error: '请刷新页面后重试。' });
      if (req.method === 'GET' && url.pathname === '/api/state') {
        await service.scanDownloads();
        return json(res, 200, { ...service.snapshot(), token,
          githubAuth: await service.github.credentials?.status(),
          network: { localUrl: `http://127.0.0.1:${server.address().port}`, urls: host === '127.0.0.1' ? [] : addresses.map(ip => `http://${ip}:${server.address().port}`) } });
      }
      if (req.method === 'GET' && url.pathname === '/api/project') return json(res, 200, await service.detail(url.searchParams.get('id')));
      if (req.method === 'GET' && url.pathname === '/api/history') return json(res, 200, await service.history(url.searchParams.get('id'), url.searchParams.get('days') === 'all' ? 'all' : Number(url.searchParams.get('days') || 90), url.searchParams.get('refresh') === '1', undefined, url.searchParams.get('metric') || 'growth'));
      if (req.method === 'POST' && url.pathname === '/api/github-token') {
        if (!service.github.credentials) throw new Error('此运行模式不支持配置 GitHub Token。');
        let body = ''; for await (const chunk of req) { body += chunk.toString(); if (body.length > 4096) throw new Error('Token 请求过长。'); }
        let input; try { input = JSON.parse(body); } catch { throw new Error('Token 请求格式无效。'); }
        if (!input || typeof input !== 'object') throw new Error('Token 请求格式无效。');
        return json(res,200,input.remove === true ? await service.github.credentials.remove() : await service.github.credentials.save(input.token));
      }
      if (req.method === 'GET' && url.pathname === '/api/file') { await service.file(url.searchParams.get('id'), res); return; }
      if (req.method === 'POST' && url.pathname === '/api/analyze') return json(res, 202, service.startAnalysis(url.searchParams.get('resume') === '1'));
      if (req.method === 'POST' && url.pathname === '/api/inspire') return json(res, 202, service.startInspiration(url.searchParams.get('refresh') === '1'));
      if (req.method === 'POST' && url.pathname === '/api/implement') return json(res, 202, service.startImplementation());
      if (req.method === 'GET' && url.pathname === '/api/implementation/archive') {
        const archive = createProjectZip(await service.generatedFiles());
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="whatsnew-mvp.zip"' }); res.end(archive); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/cancel') { service.cancel(); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/api/ranking/cancel') { service.rankingController?.abort(); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/api/updates') return json(res, 200, await service.checkUpdates(url.searchParams.get('id') || undefined));
      if (req.method === 'POST' && url.pathname === '/api/download') return json(res, 200, await service.download(url.searchParams.get('id')));
      if (req.method === 'POST' && url.pathname === '/api/ranking') return json(res, 202, service.startRanking(url.searchParams.get('mode') || 'stars', url.searchParams.get('period') || 'week', url.searchParams.get('refresh') === '1'));
      if (req.method === 'POST' && ['/api/clone', '/api/pull'].includes(url.pathname)) return json(res, 200, await service.gitOperation(url.searchParams.get('id'), url.pathname.slice(5)));
      const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/theme.js': ['theme.js', 'text/javascript; charset=utf-8'], '/chart-window.js': ['chart-window.js', 'text/javascript; charset=utf-8'] };
      if (req.method === 'GET' && assets[url.pathname]) {
        const [name, type] = assets[url.pathname];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        res.end(await readFile(fileURLToPath(new URL(name, publicRoot)))); return;
      }
      return json(res, 404, { error: '页面不存在。' });
    } catch (error) { json(res, 400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, lanUrls: host === '127.0.0.1' ? [] : addresses.map(ip => `http://${ip}:${server.address().port}`), url: `http://127.0.0.1:${server.address().port}`, async close() {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeIdleConnections(); await service.close(); await closed;
  } };
}

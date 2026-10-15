import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class LocalToken {
  constructor(root, { provider, file, environment, fallback }) {
    this.provider = provider; this.relativePath = `config/${file}`;
    this.path = join(root, 'config', file); this.environment = environment; this.fallback = fallback;
  }
  valid(value) { return Boolean(value) && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value); }
  async get() {
    let value;
    try { value = (await readFile(this.path, 'utf8')).trim(); }
    catch (error) { if (error.code === 'ENOENT') return this.fallback || null; throw new Error(`无法读取 ${this.relativePath}，请检查文件权限。`); }
    if (!this.valid(value)) throw new Error(`${this.relativePath} 内容无效，请填写单行 ${this.provider} Token。`);
    return value;
  }
  async status() {
    try {
      const token = await this.get(); let file = false;
      try { await readFile(this.path); file = true; } catch {}
      return { enabled: Boolean(token), source: file ? this.relativePath : token ? this.environment : null, path: this.relativePath };
    } catch (error) { return { enabled: false, error: error.message, path: this.relativePath }; }
  }
  async save(value) {
    if (typeof value !== 'string') throw new Error(`请填写 ${this.provider} Token。`);
    value = value.trim();
    if (!this.valid(value)) throw new Error(`Token 格式无效，请填写单行 ${this.provider} Token。`);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, value + '\n', { mode: 0o600 }); await rename(temporary, this.path); }
    finally { await unlink(temporary).catch(() => {}); }
    return this.status();
  }
  async remove() { await unlink(this.path).catch(error => { if (error.code !== 'ENOENT') throw error; }); return this.status(); }
}

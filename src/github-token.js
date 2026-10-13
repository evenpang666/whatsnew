import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export class GitHubToken {
  constructor(root, fallback = process.env.GITHUB_TOKEN) { this.path = join(root, 'config', 'github.token'); this.fallback = fallback; }
  async get() {
    let value;
    try { value = (await readFile(this.path, 'utf8')).trim(); }
    catch (e) { if (e.code === 'ENOENT') return this.fallback || null; throw new Error('无法读取 config/github.token，请检查文件权限。'); }
    if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('config/github.token 内容无效，请填写单行 GitHub Token。');
    return value;
  }
  async status() {
    try { const token = await this.get(); let file = false; try { await readFile(this.path); file = true; } catch {}
      return { enabled: Boolean(token), source: file ? 'config/github.token' : token ? 'GITHUB_TOKEN' : null, path: 'config/github.token' };
    } catch(e) { return { enabled:false, error:e.message, path:'config/github.token' }; }
  }
  async save(value) {
    if (typeof value !== 'string') throw new Error('请填写 GitHub Token。');
    value = value.trim();
    if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Token 格式无效，请填写单行 GitHub Token。');
    const directory = dirname(this.path); await mkdir(directory,{recursive:true});
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, value+'\n',{mode:0o600}); await rename(temporary,this.path); }
    finally { await unlink(temporary).catch(()=>{}); }
    return this.status();
  }
  async remove() { await unlink(this.path).catch(e=>{if(e.code!=='ENOENT')throw e;}); return this.status(); }
}

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { runStructuredAgent } from './structured-agent.js';

export const PROJECT_FILES = ['package.json', 'README.md', 'server.mjs', 'public/index.html', 'public/app.js', 'public/style.css'];
export function validateProjectFile(path, content) {
  if (!PROJECT_FILES.includes(path)) throw new Error('路径不在允许的项目文件列表中');
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > 128000) throw new Error('文件内容必须完整、非空且不超过 128 KB');
  if (path === 'package.json') {
    let pkg; try { pkg = JSON.parse(content); } catch { throw new Error('package.json 不是完整 JSON'); }
    if (pkg.type !== 'module' || pkg.scripts?.start !== 'node server.mjs' || Object.keys(pkg.scripts || {}).some(key => key !== 'start') || Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.devDependencies || {}).length) throw new Error('package.json 必须使用 module、仅允许 start: node server.mjs 且无第三方依赖');
  }
}
async function checkSyntax(path, signal) {
  signal.throwIfAborted();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', path], { signal, stdio: ['ignore','ignore','pipe'] }); let error = '';
    child.stderr.on('data', b => { error = (error + b.toString()).slice(-2000); });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`文件语法不完整：${path.split('/').slice(-2).join('/')}\n${error}`)));
  });
}
export function makeProjectBuilder(ctx) {
  return async (idea, directory, signal, onProgress = () => {}) => {
    const written = new Set(); let finished = false;
    const root = resolve(directory); await mkdir(join(root, 'public'), { recursive: true });
    await runStructuredAgent(ctx, { skill: 'whatsnew-build', signal, maxTokens: 18000, timeoutMs: 600000,
      prompt: `用户已点击“要我帮你实现吗？”为以下构想撰写一个可运行的本地网页 MVP。所有输出仅写入宿主隔离目录；不要执行代码。需要文件：${PROJECT_FILES.join('、')}。逐文件调用 write_project_file，全部写好后调用 finish_project。\n${JSON.stringify(idea)}`,
      complete: () => finished, missing: () => `${PROJECT_FILES.filter(f => !written.has(f)).join('、') || 'finish_project 校验'}，按工具错误修复未通过的文件`,
      tools: [{ name: 'write_project_file', description: 'Write exactly one complete allowed file into the isolated project workspace. Can rewrite that file to correct validation errors.', parameters: { type: 'object', properties: { path: { type: 'string', enum: PROJECT_FILES }, content: { type: 'string' } }, required: ['path','content'], additionalProperties: false },
        async execute(args, exec) { signal.throwIfAborted(); exec.signal.throwIfAborted(); validateProjectFile(args.path, args.content); await writeFile(join(root, args.path), args.content, { mode: 0o600 }); finished = false; written.add(args.path); onProgress(written.size, PROJECT_FILES.length); return { accepted: true, path: args.path, remaining: PROJECT_FILES.filter(p => !written.has(p)) }; } },
        { name: 'finish_project', description: 'Validate required files, package.json and JavaScript syntax. Correct named files on failure. Does not run generated code.', parameters: { type: 'object', properties: {}, additionalProperties: false },
          async execute(_args, exec) { signal.throwIfAborted(); exec.signal.throwIfAborted(); const missing = PROJECT_FILES.filter(f => !written.has(f)); if (missing.length) throw new Error(`缺少文件：${missing.join('、')}`); validateProjectFile('package.json', await readFile(join(root,'package.json'),'utf8')); for (const file of ['server.mjs','public/app.js']) await checkSyntax(join(root,file), signal); finished = true; return { accepted: true, complete: true }; } }]
    });
    return { path: root, files: PROJECT_FILES, command: 'npm start', checked: '所需文件与 JavaScript 语法已通过；尚未自动运行生成代码。' };
  };
}

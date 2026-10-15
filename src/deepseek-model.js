import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadAdapter() {
  const require = createRequire(await realpath(resolve(process.argv[1])));
  return import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-deepseek')).href);
}

export function independentModel(ctx, credentials, { load = loadAdapter } = {}) {
  let registration;
  // Only register a private route when an independent credential is in use.
  // Shared DSH settings, credentials, and default selection stay untouched.
  return async () => {
    if (!await credentials.get()) return ctx.agentDefaultModel.currentSelection();
    registration ||= (async () => {
      const { DeepSeekAdapter, resolveAdapterOptions, PUBLIC_BASE_URL } = await load();
      const options = resolveAdapterOptions({ baseURL: PUBLIC_BASE_URL });
      const adapter = new DeepSeekAdapter({ options: () => options, resolveUserId: () => 'whatsnew',
        resolveApiKey: async () => {
          const token = await credentials.get();
          if (!token) throw new Error('独立 DeepSeek Token 已移除，请重新开始任务以使用 dsh 模型。');
          return token;
        } });
      const dispose = ctx.llm.registerAdapter(['whatsnew-deepseek'], adapter);
      ctx.on('dispose', dispose);
      return { provider: 'whatsnew-deepseek', model: options.models[0].id };
    })().catch(error => { registration = null; throw error; });
    return registration;
  };
}

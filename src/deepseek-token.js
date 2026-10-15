import { LocalToken } from './local-token.js';

export class DeepSeekToken extends LocalToken {
  constructor(root, fallback = process.env.DEEPSEEK_API_KEY) {
    super(root, { provider: 'DeepSeek', file: 'deepseek.token', environment: 'DEEPSEEK_API_KEY', fallback });
  }
}

import { LocalToken } from './local-token.js';

export class GitHubToken extends LocalToken {
  constructor(root, fallback = process.env.GITHUB_TOKEN) {
    super(root, { provider: 'GitHub', file: 'github.token', environment: 'GITHUB_TOKEN', fallback });
  }
}

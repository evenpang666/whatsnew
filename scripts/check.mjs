import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
for (const folder of ['src', 'scripts', 'public', 'tests']) {
  for (const file of await readdir(new URL(`../${folder}/`, import.meta.url))) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', `${folder}/${file}`], { stdio: 'inherit' });
    if (result.status) process.exit(result.status);
  }
}
console.log('所有 JavaScript 文件语法检查通过。');

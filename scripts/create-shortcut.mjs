import { writeFile, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quoted = (root + '/start.sh').replace(/[\\"`$]/g, c => '\\\\' + c);
const desktop = `[Desktop Entry]\nType=Application\nName=WhatsNew 开源雷达\nComment=发现 GitHub 最热门的 100 个项目\nExec=bash "${quoted}"\nTerminal=true\nIcon=applications-internet\nCategories=Network;Development;\n`;
await writeFile(resolve(root,'WhatsNew.desktop'),desktop);await chmod(resolve(root,'WhatsNew.desktop'),0o755);
console.log('已为当前目录生成 WhatsNew.desktop。');

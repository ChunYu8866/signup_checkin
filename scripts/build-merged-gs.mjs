// 產生貼進線上 Apps Script「程式碼.gs」的單一合併檔（線上專案只有 程式碼.gs + Bridge.html 兩檔）。
// 用法：node scripts/build-merged-gs.mjs　→ 輸出 deploy/apps-script-Code-merged.gs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// GAS 全域共用一個命名空間，串接順序不影響執行；Config 放最前僅為閱讀方便。
const FILES = ['Config.gs', 'Domain.gs', 'Index.gs', 'Repository.gs', 'Api.gs', 'Code.gs'];

const sections = FILES.map(name => {
  const source = readFileSync(new URL(`../apps-script/${name}`, import.meta.url), 'utf8');
  return `// ====== ${name} ======\n${source.trimEnd()}\n`;
});

const banner = '// 本檔由 scripts/build-merged-gs.mjs 自動合併產生，請勿手改；來源為 apps-script/*.gs。\n\n';
mkdirSync(new URL('../deploy/', import.meta.url), { recursive: true });
writeFileSync(new URL('../deploy/apps-script-Code-merged.gs', import.meta.url), banner + sections.join('\n'));
console.log('written deploy/apps-script-Code-merged.gs');

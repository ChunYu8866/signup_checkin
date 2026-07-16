import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export function loadGas(files, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  for (const file of files) {
    const source = fs.readFileSync(path.resolve('apps-script', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}

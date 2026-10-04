// Прави release/BalkanskiLegendi-win32-x64/BalkanskiLegendi.exe: npm run exe (сглобява се в GitHub Actions)
// Самият Electron .exe НЕ се променя (само се преименува) — без подписване и без промени по файла,
// за да не го блокира Windows Smart App Control.
import fs from 'fs';
import path from 'path';
import { createPackage } from '@electron/asar';

const NAME = 'BalkanskiLegendi';
const OUT = `release/${NAME}-win32-x64`;
const SRC = 'node_modules/electron/dist';
const STAGE = 'release/_app';

if (!fs.existsSync('dist/index.html')) { console.error('Няма dist/ — първо пусни „npm run build“.'); process.exit(1); }
if (!fs.existsSync(path.join(SRC, 'electron.exe'))) { console.error(`Няма ${SRC}/electron.exe — Electron за Windows не е свален (node node_modules/electron/install.js).`); process.exit(1); }

fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(STAGE, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });
fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, `${NAME}.exe`));
fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });

fs.mkdirSync(path.join(STAGE, 'desktop'), { recursive: true });
fs.cpSync('dist', path.join(STAGE, 'dist'), { recursive: true });
fs.copyFileSync('desktop/main.cjs', path.join(STAGE, 'desktop/main.cjs'));
fs.copyFileSync('desktop/icon.png', path.join(STAGE, 'desktop/icon.png'));
fs.copyFileSync('desktop/icon.ico', path.join(STAGE, 'desktop/icon.ico'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: 'desktop/main.cjs' }, null, 2));
await createPackage(STAGE, path.join(OUT, 'resources', 'app.asar'));
fs.rmSync(STAGE, { recursive: true, force: true });
fs.copyFileSync('desktop/icon.ico', path.join(OUT, `${NAME}.ico`));
console.log('OK ' + OUT + '/' + NAME + '.exe');

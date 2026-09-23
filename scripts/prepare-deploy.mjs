import { cp, mkdir, rm } from 'node:fs/promises';

const distPath = 'dist';
await rm(distPath, { recursive: true, force: true });
await mkdir(`${distPath}/data`, { recursive: true });
await Promise.all([
  cp('index.html', `${distPath}/index.html`),
  cp('app.js', `${distPath}/app.js`),
  cp('styles.css', `${distPath}/styles.css`),
  cp('data/published-content.json', `${distPath}/data/published-content.json`)
]);
console.log('Netlify deployment bundle prepared in dist/.');

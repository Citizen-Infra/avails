import { mkdir,copyFile,readFile,writeFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const foundation=new URL('./',import.meta.resolve('@citizen-infra/design-system/tokens.css'));
await mkdir(new URL('public/licenses/',root),{recursive:true});
await copyFile(new URL('LICENSE',foundation),new URL('public/licenses/cibc-design-system-MIT.txt',root));
await copyFile(new URL('fonts/OFL-Public-Sans.txt',foundation),new URL('public/licenses/OFL-Public-Sans.txt',root));
// Reuse Logo.jsx's existing sixteen-cell geometry, not a new mark. Standalone
// SVG cannot inherit page variables, so resolve its two roles from the pin.
const css=await readFile(new URL('tokens.css',foundation),'utf8');
const role=name=>css.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6});`))[1];
const pattern=[0,.25,0,.25,.25,.5,.75,.25,0,.75,1,.5,0,.25,.5,0];
const cells=pattern.map((opacity,i)=>`<rect x="${3.84+(i%4)*7.2}" y="${3.84+Math.floor(i/4)*7.2}" width="5.6" height="5.6" rx="1.28" fill="${role('--cibc-color-on-surface-strong')}" opacity="${opacity||.06}"/>`).join('');
await writeFile(new URL('public/favicon.svg',root),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6.4" fill="${role('--cibc-color-surface-strong')}"/>${cells}</svg>\n`);
console.log('Copied unchanged MIT/OFL notices and rebound the existing grid favicon to pinned roles.');

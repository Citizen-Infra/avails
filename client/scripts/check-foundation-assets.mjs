// npm postbuild: production asset checks belong after Vite, not in pre-build
// unit tests. The existing CI and Railway build commands invoke this gate.
import assert from 'node:assert/strict'
import { readFileSync,readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
const root=new URL('../',import.meta.url)
const foundation=new URL('./',import.meta.resolve('@citizen-infra/design-system/tokens.css'))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
for(const[target,source]of [['cibc-design-system-MIT.txt','LICENSE'],['OFL-Public-Sans.txt','fonts/OFL-Public-Sans.txt']]){
  assert.equal(hash(readFileSync(new URL(`dist/licenses/${target}`,root))),hash(readFileSync(new URL(source,foundation))),target)
}
const assets=readdirSync(new URL('dist/assets/',root)).filter(name=>name.endsWith('.woff2'))
for(const name of ['public-sans-latin-normal.woff2','public-sans-latin-italic.woff2']){
  const expected=hash(readFileSync(new URL(`fonts/${name}`,foundation)))
  assert.ok(assets.some(asset=>hash(readFileSync(new URL(`dist/assets/${asset}`,root)))===expected),`${name} must be emitted unchanged`)
}
console.log('Foundation asset gate passed: both font binaries and MIT/OFL notices match the pin.')

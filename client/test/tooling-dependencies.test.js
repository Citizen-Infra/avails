import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json')).packages

test('generator and PostCSS adapter are dev dependencies, not browser libraries', () => {
  for (const name of ['shadcn', '@tailwindcss/postcss']) {
    assert.equal(pkg.dependencies[name], undefined)
    assert.ok(pkg.devDependencies[name])
    assert.equal(lock[''].devDependencies[name], pkg.devDependencies[name])
    assert.equal(lock[''].dependencies[name], undefined)
    assert.equal(lock['node_modules/' + name].dev, true)
  }
  for (const name of ['@modelcontextprotocol/sdk', 'express', 'proxy-addr']) {
    assert.equal(lock['node_modules/' + name].dev, true)
  }
})

test('application JavaScript does not import the Node-only dev tooling', () => {
  const devNames = new Set(Object.keys(pkg.devDependencies))
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
      if (entry.isDirectory()) inspect(path)
      else if (/\.(js|jsx)$/.test(entry.name)) {
        const source = readFileSync(path, 'utf8')
        for (const [, name] of source.matchAll(/(?:from\s+|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)) {
          const root = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
          assert.equal(devNames.has(root), false, `${path.pathname} imports Node-only ${name}`)
        }
      }
    }
  }
  inspect(new URL('../src/', import.meta.url))
  assert.match(read('src/components/ui/button.jsx'), /from ['"]radix-ui['"]/, 'Retain existing Radix controls')
})

test('CI and Railway still install build dependencies before building the client', () => {
  const ci = read('../.github/workflows/ci.yml')
  const railway = JSON.parse(read('../railway.json'))
  const install = ci.indexOf('cd client && npm ci'), build = ci.indexOf('cd client && npm run build')
  assert.ok(install >= 0 && build > install)
  assert.match(railway.build.buildCommand, /cd client && npm install --include=dev && npm run build/)
  assert.equal(railway.deploy.startCommand, 'cd server && node src/index.js')
  assert.match(read('postcss.config.js'), /'@tailwindcss\/postcss'/)
})

test('runtime framework and Tailwind compiler lines are preserved without forced overrides', () => {
  assert.equal(pkg.dependencies.react, '^19.2.0')
  assert.equal(pkg.dependencies['react-dom'], '^19.2.0')
  assert.equal(pkg.dependencies['react-router'], '^7.18.4')
  assert.equal(pkg.dependencies['radix-ui'], '^1.4.3')
  assert.equal(lock['node_modules/tailwindcss'].version, '4.2.2')
  assert.equal(lock['node_modules/@tailwindcss/postcss'].version, '4.2.2')
  assert.equal(pkg.overrides, undefined)
})

for (const [name, minimum] of [
  ['shadcn', '4.22.1'],
  ['vite', '7.3.7'],
  ['postcss', '8.5.31'],
  ['esbuild', '0.28.2'],
  ['@babel/core', '7.29.7'],
  ['@modelcontextprotocol/sdk', '1.32.2'],
  ['proxy-addr', '2.0.8'],
  ['zod', '4.6.7'],
]) {
  test(`installed tooling ${name} meets the reviewed security floor ${minimum}`, () => {
    const installed = JSON.parse(read('node_modules/' + name + '/package.json')).version
    assert.equal(installed, lock['node_modules/' + name].version)
    assert.match(installed, /^\d+\.\d+\.\d+$/)
    const actual = installed.split('.').map(Number), floor = minimum.split('.').map(Number)
    assert.equal(actual[0], floor[0], 'Keep the reviewed major')
    if (actual[0] === 0) assert.equal(actual[1], floor[1], 'Review 0.x minor migrations separately')
    assert.ok(actual[1] > floor[1] || (actual[1] === floor[1] && actual[2] >= floor[2]))
  })
}

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const SAVE_INTERVAL = 30 * 1000; // 30 seconds

const stores = new Map(); // name → { map, dirty }

export function registerStore(name, map) {
  stores.set(name, { map, dirty: false });
}

export function markDirty(name) {
  const store = stores.get(name);
  if (store) store.dirty = true;
}

// Serialize one store to its JSON file. Shared by the periodic flush and by
// saveStoreNow, so both write the same shape.
async function writeStore(name, store) {
  // Custom serializer: strip non-serializable fields (like live oauthSession objects)
  const data = {};
  for (const [key, value] of store.map) {
    if (typeof value === 'object' && value !== null && value.oauthSession) {
      // App session: save only serializable fields
      const { oauthSession, ...rest } = value;
      data[key] = rest;
    } else {
      data[key] = value;
    }
  }
  const filePath = path.join(DATA_DIR, `${name}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2));
  store.dirty = false;
}

async function saveAll() {
  for (const [name, store] of stores) {
    if (!store.dirty) continue;
    try {
      await writeStore(name, store);
    } catch (err) {
      console.error(`Failed to save ${name}:`, err.message);
    }
  }
}

// Write ONE store immediately, and let its failure reach the caller.
//
// saveNow() flushes everything and swallows errors, which is right at shutdown
// and wrong for a caller that must not proceed until its write is durable.
// schedule_call's booking ledger is that caller (#166): if the booking cannot
// be recorded, the promise of idempotency is not real, and the honest answer
// is to fail before anyone is emailed rather than to book unrecorded.
export async function saveStoreNow(name) {
  const store = stores.get(name);
  if (!store) throw new Error(`Unknown store: ${name}`);
  // startPersistence() normally creates DATA_DIR, but this can be the first
  // write on a fresh volume or in a test that never started persistence.
  await mkdir(DATA_DIR, { recursive: true });
  await writeStore(name, store);
}

async function loadAll() {
  await mkdir(DATA_DIR, { recursive: true });
  for (const [name, store] of stores) {
    try {
      const filePath = path.join(DATA_DIR, `${name}.json`);
      const raw = await readFile(filePath, 'utf8');
      const data = JSON.parse(raw);
      for (const [key, value] of Object.entries(data)) {
        store.map.set(key, value);
      }
      console.log(`Restored ${store.map.size} entries from ${name}.json`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`Failed to load ${name}:`, err.message);
      }
    }
  }
}

export async function saveNow() {
  // Force all stores dirty so they get written immediately
  for (const store of stores.values()) {
    store.dirty = true;
  }
  await saveAll();
}

export async function startPersistence() {
  await loadAll();
  setInterval(saveAll, SAVE_INTERVAL);
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, saving stores...');
    await saveAll();
    process.exit(0);
  });
}

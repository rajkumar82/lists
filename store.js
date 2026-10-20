// Key/value storage for per-user JSON documents: a GCS bucket in production, ./data locally, memory in tests.
const fs = require('fs');
const path = require('path');

function memoryStore() {
  const m = new Map();
  return { read: async (key) => m.get(key) ?? null, write: async (key, value) => { m.set(key, value); } };
}

function localStore(dir) {
  const file = (key) => path.join(dir, key);
  return {
    read: async (key) => {
      try { return await fs.promises.readFile(file(key), 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    },
    write: async (key, value) => {
      await fs.promises.mkdir(path.dirname(file(key)), { recursive: true });
      await fs.promises.writeFile(file(key), value);
    },
  };
}

function gcsStore(bucketName) {
  const { Storage } = require('@google-cloud/storage');
  const bucket = new Storage().bucket(bucketName);
  return {
    read: async (key) => {
      try { const [buf] = await bucket.file(key).download(); return buf.toString('utf8'); } catch (err) { if (err.code === 404) return null; throw err; }
    },
    write: (key, value) => bucket.file(key).save(value, { contentType: 'application/json' }),
  };
}

module.exports = { memoryStore, localStore, gcsStore };

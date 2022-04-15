const { test, configure } = require('brittle')
const crypto = require('hypercore-crypto')
const ram = require('random-access-memory')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const sodium = require('sodium-universal')

const Corestore = require('..')

configure({ serial: true })

test('basic get with caching', async function (t) {
  const store = new Corestore(ram)
  const core1a = store.get({ name: 'core-1' })
  const core1b = store.get({ name: 'core-1' })
  const core2 = store.get({ name: 'core-2' })

  await Promise.all([core1a.ready(), core1b.ready(), core2.ready()])

  t.alike(core1a.key, core1b.key)
  t.unlike(core1a.key, core2.key)

  t.ok(core1a.writable)
  t.ok(core1b.writable)

  t.is(store.cores.size, 2)
})

test('basic get with custom keypair', async function (t) {
  const store = new Corestore(ram)
  const kp1 = crypto.keyPair()
  const kp2 = crypto.keyPair()

  const core1 = store.get(kp1)
  const core2 = store.get(kp2)
  await Promise.all([core1.ready(), core2.ready()])

  t.alike(core1.key, kp1.publicKey)
  t.alike(core2.key, kp2.publicKey)
  t.ok(core1.writable)
  t.ok(core2.writable)
})

test('basic namespaces', async function (t) {
  const store = new Corestore(ram)
  const ns1 = store.namespace('ns1')
  const ns2 = store.namespace('ns2')
  const ns3 = store.namespace('ns1') // Duplicate namespace

  const core1 = ns1.get({ name: 'main' })
  const core2 = ns2.get({ name: 'main' })
  const core3 = ns3.get({ name: 'main' })
  await Promise.all([core1.ready(), core2.ready(), core3.ready()])

  t.absent(core1.key.equals(core2.key))
  t.ok(core1.key.equals(core3.key))
  t.ok(core1.writable)
  t.ok(core2.writable)
  t.ok(core3.writable)
  t.is(store.cores.size, 2)

  t.end()
})

test('basic replication', async function (t) {
  const store1 = new Corestore(ram)
  const store2 = new Corestore(ram)

  const core1 = store1.get({ name: 'core-1' })
  const core2 = store1.get({ name: 'core-2' })
  await core1.append('hello')
  await core2.append('world')

  const core3 = store2.get({ key: core1.key })
  const core4 = store2.get({ key: core2.key })

  const s = store1.replicate(true)
  s.pipe(store2.replicate(false)).pipe(s)

  t.alike(await core3.get(0), Buffer.from('hello'))
  t.alike(await core4.get(0), Buffer.from('world'))
})

test('replicating cores created after replication begins', async function (t) {
  const store1 = new Corestore(ram)
  const store2 = new Corestore(ram)

  const s = store1.replicate(true, { live: true })
  s.pipe(store2.replicate(false, { live: true })).pipe(s)

  const core1 = store1.get({ name: 'core-1' })
  const core2 = store1.get({ name: 'core-2' })
  await core1.append('hello')
  await core2.append('world')

  const core3 = store2.get({ key: core1.key })
  const core4 = store2.get({ key: core2.key })

  t.alike(await core3.get(0), Buffer.from('hello'))
  t.alike(await core4.get(0), Buffer.from('world'))
})

test('replicating cores using discovery key hook', async function (t) {
  const dir = tmpdir()
  let store1 = new Corestore(dir)
  const store2 = new Corestore(ram)

  const core = store1.get({ name: 'main' })
  await core.append('hello')
  const key = core.key

  await store1.close()
  store1 = new Corestore(dir)

  const s = store1.replicate(true, { live: true })
  s.pipe(store2.replicate(false, { live: true })).pipe(s)

  const core2 = store2.get(key)
  t.alike(await core2.get(0), Buffer.from('hello'))
})

test('nested namespaces', async function (t) {
  const store = new Corestore(ram)
  const ns1a = store.namespace('ns1').namespace('a')
  const ns1b = store.namespace('ns1').namespace('b')

  const core1 = ns1a.get({ name: 'main' })
  const core2 = ns1b.get({ name: 'main' })
  await Promise.all([core1.ready(), core2.ready()])

  t.not(core1.key.equals(core2.key))
  t.ok(core1.writable)
  t.ok(core2.writable)
  t.is(store.cores.size, 2)
})

test('core uncached when all sessions close', async function (t) {
  const store = new Corestore(ram)
  const core1 = store.get({ name: 'main' })
  await core1.ready()
  t.is(store.cores.size, 1)
  await core1.close()
  t.is(store.cores.size, 0)
})

test('writable core loaded from name, application, and namespace userData', async function (t) {
  const dir = tmpdir()
  const customNS = Buffer.from('90c5890b30ceb133722291e78db998d0e147cb50de92740411f669c8c9abf6f1', 'hex')
  const customApp = 'custom-app'

  let store = new Corestore(dir, { application: customApp, namespace: customNS })
  let core = store.get({ name: 'main' })
  await core.ready()
  const key = core.key

  t.ok(core.writable)
  await core.append('hello')
  t.is(core.length, 1)

  await store.close()
  store = new Corestore(dir)
  core = store.get(key)
  await core.ready()

  t.ok(core.writable)
  await core.append('world')
  t.is(core.length, 2)
  t.alike(await core.get(0), Buffer.from('hello'))
  t.alike(await core.get(1), Buffer.from('world'))
})

test('storage locking', async function (t) {
  const dir = tmpdir()

  const store1 = new Corestore(dir)
  await store1.ready()

  const store2 = new Corestore(dir)
  try {
    await store2.ready()
    t.fail('dir should have been locked')
  } catch {
    t.pass('dir was locked')
  }
})

test('closing a namespace does not close cores', async function (t) {
  const store = new Corestore(ram)
  const ns1 = store.namespace('ns1')
  const core1 = ns1.get({ name: 'core-1' })
  const core2 = ns1.get({ name: 'core-2' })
  await Promise.all([core1.ready(), core2.ready()])

  await ns1.close()

  t.is(store.cores.size, 2)
  t.not(core1.closed)
  t.not(core1.closed)

  await store.close()

  t.is(store.cores.size, 0)
  t.ok(core1.closed)
  t.ok(core2.closed)
})

test('findingPeers', async function (t) {
  t.plan(6)

  const store = new Corestore(ram)

  const ns1 = store.namespace('ns1')
  const ns2 = store.namespace('ns2')

  const a = ns1.get(Buffer.alloc(32).fill('a'))
  const b = ns2.get(Buffer.alloc(32).fill('b'))

  const done = ns1.findingPeers()

  let aUpdated = false
  let bUpdated = false
  let cUpdated = false

  const c = ns1.get(Buffer.alloc(32).fill('c'))

  a.update().then(function (bool) {
    aUpdated = true
  })

  b.update().then(function (bool) {
    bUpdated = true
  })

  c.update().then(function (bool) {
    cUpdated = true
  })

  await new Promise(resolve => setImmediate(resolve))

  t.is(aUpdated, false)
  t.is(bUpdated, true)
  t.is(cUpdated, false)

  done()

  await new Promise(resolve => setImmediate(resolve))

  t.is(aUpdated, true)
  t.is(bUpdated, true)
  t.is(cUpdated, true)
})

test('different primary keys yield different keypairs', async function (t) {
  const pk1 = randomBytes(32)
  const pk2 = randomBytes(32)
  t.unlike(pk1, pk2)

  const store1 = new Corestore(ram, { primaryKey: pk1 })
  const store2 = new Corestore(ram, { primaryKey: pk2 })

  const kp1 = await store1.createKeyPair('hello')
  const kp2 = await store2.createKeyPair('hello')

  t.unlike(kp1.publicKey, kp2.publicKey)
})

test('different applications yield different keypairs', async function (t) {
  const pk = randomBytes(32)

  const storeDefault = new Corestore(ram, { primaryKey: pk })
  const store1 = new Corestore(ram, { application: 'corestore', primaryKey: pk })
  const store2 = new Corestore(ram, { application: 'foo', primaryKey: pk })

  const kpDefault = await storeDefault.createKeyPair('hello')
  const kp1 = await store1.createKeyPair('hello')
  const kp2 = await store2.createKeyPair('hello')

  t.alike(kp1.publicKey, kpDefault.publicKey)
  t.unlike(kp1.publicKey, kp2.publicKey)

  const ns = store2.namespace('bar')
  t.alike(ns._application, store2._application)
})

test("Key derivation should have no dependency on corestore's constants", async function (t) {
  const primaryKey = randomBytes(32)

  const APP_PREFIX = Buffer.from('test-application')
  const customNS = b4a.alloc(0)

  const ns1 = new Corestore(ram, { application: APP_PREFIX, namespace: customNS, primaryKey })
  const pk1 = (await ns1.createKeyPair('hello')).publicKey

  t.alike(pk1, createKeyPair(APP_PREFIX, customNS, 'hello', primaryKey).publicKey)

  const ns2 = ns1.namespace(pk1)
  const pk2 = (await ns2.createKeyPair('hello')).publicKey

  t.alike(pk2, createKeyPair(APP_PREFIX, ns2._namespace, 'hello', primaryKey).publicKey)

  // Standalone key derivation that the corestore should be able to replicate
  function createKeyPair (prefix, namespace, name, pk) {
    name = b4a.from(name)
    const seed = b4a.alloc(32)
    sodium.crypto_generichash_batch(seed, [prefix, namespace, name], pk)
    const keyPair = {
      publicKey: b4a.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES),
      secretKey: b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
    }
    sodium.crypto_sign_seed_keypair(keyPair.publicKey, keyPair.secretKey, seed)
    return keyPair
  }
})

function tmpdir () {
  return path.join(os.tmpdir(), 'corestore-' + Math.random().toString(16).slice(2))
}

function randomBytes (n) {
  const buf = b4a.allocUnsafe(n)
  sodium.randombytes_buf(buf)
  return buf
}

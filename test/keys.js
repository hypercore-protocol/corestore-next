const p = require('path')
const fs = require('fs')

const test = require('tape')
const ram = require('random-access-memory')
const raf = require('random-access-file')

const KeyManager = require('../lib/keys')

test('can create hypercore keypairs', async t => {
  const keys = await KeyManager.fromStorage(ram)

  const kp1 = await keys.createHypercoreKeyPair('core1')
  const kp2 = await keys.createHypercoreKeyPair('core2')

  t.same(kp1.publicKey.length, 32)
  t.same(kp2.publicKey.length, 32)
  t.notSame(kp1.publicKey, kp2.publicKey)

  t.end()
})

test('distinct tokens create distinct hypercore keypairs', async t => {
  const keys = await KeyManager.fromStorage(ram)
  const token1 = KeyManager.createToken()
  const token2 = KeyManager.createToken()

  const kp1 = await keys.createHypercoreKeyPair('core1', token1)
  const kp2 = await keys.createHypercoreKeyPair('core1', token2)

  t.notSame(kp1.publicKey, kp2.publicKey)

  t.end()
})

test('short user-provided token will throw', async t => {
  const keys = await KeyManager.fromStorage(ram)

  try {
    await keys.createHypercoreKeyPair('core1', Buffer.from('hello'))
    t.fail('did not throw')
  } catch {
    t.pass('threw correctly')
  }

  t.end()
})

test('persistent storage regenerates keys correctly', async t => {
  const testPath = p.resolve(__dirname, 'test-data')

  const keys1 = await KeyManager.fromStorage((name) => raf(testPath, { directory: testPath }))
  const kp1 = await keys1.createHypercoreKeyPair('core1')

  const keys2 = await KeyManager.fromStorage((name) => raf(testPath, { directory: testPath }))
  const kp2 = await keys2.createHypercoreKeyPair('core1')

  t.same(kp1.publicKey, kp2.publicKey)

  await fs.promises.rm(testPath, { recursive: true })
  t.end()
})

test('different master keys -> different keys', async t => {
  const keys1 = await KeyManager.fromStorage(ram)
  const keys2 = await KeyManager.fromStorage(ram)

  const kp1 = await keys1.createHypercoreKeyPair('core1')
  const kp2 = await keys2.createHypercoreKeyPair('core1')

  t.notSame(kp1.publicKey, kp2.publicKey)

  t.end()
})

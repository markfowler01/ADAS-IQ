import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCitationSources } from '../services/oemAttach.js'

const gm = { ROWID: '1', doc_oem: 'General Motors', doc_title: 'Collision Position Statement: ADAS Calibration Requirements', doc_published_date: '2024-06-01' }
const honda = { ROWID: '2', doc_oem: 'Honda', doc_title: 'Aiming Driving Support Systems', doc_published_date: '2022-11-01' }

test('a GM citation that does not name the document gets the document added', () => {
  const cals = [{ calibration_name: 'Front Radar', enabled: true, justification: 'Front radar calibration required per the GM position statement after this collision repair.' }]
  const docs = applyCitationSources(cals, [gm], 'Chevrolet')
  assert.equal(docs.length, 1)
  assert.match(cals[0].justification, /Cited from General Motors: Collision Position Statement: ADAS Calibration Requirements \(2024-06-01\)/)
  assert.deepEqual(cals[0]._attach, [1])
})

test('a GM job reference is tied to the GM job document', () => {
  const job = { ROWID: '3', doc_oem: 'General Motors', doc_title: 'ADAS Job Reference', doc_published_date: '2023-01-01' }
  const cals = [{ calibration_name: 'Front Windshield Camera', enabled: true, justification: 'Required per the GM job reference following the collision repair.' }]
  applyCitationSources(cals, [gm, job], 'GMC')
  assert.match(cals[0].justification, /Cited from General Motors: ADAS Job Reference/)
  assert.doesNotMatch(cals[0].justification, /Collision Position Statement/)
})

test('a description that already names the document is left as it is', () => {
  const just = 'Required per Honda\'s "Aiming Driving Support Systems" job aid (November 2022).'
  const cals = [{ calibration_name: 'Front Radar', enabled: true, justification: just }]
  applyCitationSources(cals, [honda], 'Honda')
  assert.equal(cals[0].justification, just)
  assert.deepEqual(cals[0]._attach, [1])
})

test('a citation is not filled from another make\'s document', () => {
  const cals = [{ calibration_name: 'Front Radar', enabled: true, justification: 'Required per the Toyota position statement.' }]
  const docs = applyCitationSources(cals, [gm], 'Toyota')
  assert.equal(docs.length, 0)
  assert.doesNotMatch(cals[0].justification, /Cited from/)
})

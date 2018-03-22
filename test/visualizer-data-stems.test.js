'use strict'

const test = require('tap').test
const loadData = require('../visualizer/data/index.js')
const { isNumber } = require('../visualizer/data/validation.js')
const slowioJson = require('./visualizer-util/sampledata-slowio.json')

test('Visualizer data - stems - calculates between and diameter based on stats', function (t) {
  loadData((err, data) => {
    t.ifError(err)

    const node = data.clusterNodes.get(16)
    const stem = node.stem
    t.equal(stem.ownBetween, node.stats.async.between)
    t.equal(stem.ownDiameter, node.stats.async.within / Math.PI)

    t.end()
  }, slowioJson)
})

test('Visualizer data - stems - calculates length based on ancestor path', function (t) {
  loadData((err, data) => {
    t.ifError(err)

    const stem = data.clusterNodes.get(16).stem
    const totalStemLength = stem.getTotalStemLength()
    t.deepEqual(stem.ancestors.path, [ 1, 5, 7, 8, 10 ])
    t.equal(totalStemLength, 21793.56387518604)

    const toOwnLength = id => {
      const ancestorStem = data.clusterNodes.get(id).stem
      return ancestorStem.ownBetween + ancestorStem.ownDiameter
    }
    const sum = (a, b) => a + b
    const totalAncestorsLength = stem.ancestors.path.map(toOwnLength).reduce(sum, 0)
    t.equal((totalStemLength - totalAncestorsLength).toFixed(8), (stem.ownBetween + stem.ownDiameter).toFixed(8))

    t.end()
  }, slowioJson)
})

test('Visualizer data - stems - caches length by scale', function (t) {
  loadData((err, data) => {
    t.ifError(err)

    const stem = data.clusterNodes.get(16).stem
    t.equal(stem.getTotalStemLength(), stem._totalStemLengthByScale[1])
    t.ok(isNumber(stem.getTotalStemLength()))
    t.equal(stem.getTotalStemLength(5), stem._totalStemLengthByScale[5])
    t.ok(isNumber(stem.getTotalStemLength(5)))

    t.end()
  }, slowioJson)
})

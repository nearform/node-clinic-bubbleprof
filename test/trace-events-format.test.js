'use strict'

const test = require('tap').test
const endpoint = require('endpoint')
const TraceEventDecoder = require('../format/trace-events-decoder.js')

test('trace event decoder', function (t) {
  const init = {
    'pid': process.pid,
    'ts': 1000,
    'ph': 'b',
    'cat': 'node.async_hooks',
    'name': 'TYPENAME',
    'id': '0x2',
    'args': { 'triggerAsyncId': 1 }
  }

  const before = {
    'pid': process.pid,
    'ts': 2000,
    'ph': 'b',
    'cat': 'node.async_hooks',
    'name': 'TYPENAME_CALLBACK',
    'id': '0x2',
    'args': {}
  }

  const after = {
    'pid': process.pid,
    'ts': 3000,
    'ph': 'e',
    'cat': 'node.async_hooks',
    'name': 'TYPENAME_CALLBACK',
    'id': '0x2',
    'args': {}
  }

  const destroy = {
    'pid': process.pid,
    'ts': 4000,
    'ph': 'e',
    'cat': 'node.async_hooks',
    'name': 'TYPENAME',
    'id': '0x2',
    'args': {}
  }

  const decoder = new TraceEventDecoder()
  decoder.end(JSON.stringify({
    traceEvents: [init, before, after, destroy]
  }))

  decoder.pipe(endpoint({ objectMode: true }, function (err, data) {
    if (err) return t.ifError(err)

    // Remove prototype constructor
    const traceEvents = data.map((v) => Object.assign({}, v))

    t.strictDeepEqual(traceEvents, [{
      event: 'init',
      type: 'TYPENAME',
      asyncId: 2,
      triggerAsyncId: 1,
      timestamp: 1
    }, {
      event: 'before',
      type: 'TYPENAME',
      asyncId: 2,
      triggerAsyncId: null,
      timestamp: 2
    }, {
      event: 'after',
      type: 'TYPENAME',
      asyncId: 2,
      triggerAsyncId: null,
      timestamp: 3
    }, {
      event: 'destroy',
      type: 'TYPENAME',
      asyncId: 2,
      triggerAsyncId: null,
      timestamp: 4
    }])

    t.end()
  }))
})

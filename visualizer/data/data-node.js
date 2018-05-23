'use strict'

const Frame = require('./frame.js')
const { CallbackEvent } = require('./callback-event.js')
const { validateNumber } = require('../validation.js')

class DataNode {
  constructor (dataSet) {
    // Reference to settings on data map
    this.settings = dataSet.settings
    this.dataSet = dataSet

    const node = this
    this.stats = {
      // For nodes whose sourceNodes contain no callbackEvents (.before and .after arrays are empty), these
      // stats are not set, so default 0 values are accessed. Such cases are rare but valid, e.g. root
      // TODO: give examples of some of the async_hook types that often have no callbackEvents.

      sync: 0,
      setSync (num) { node.stats.sync = node.validateStat(num, 'stats.sync') },

      async: {
        between: 0,
        setBetween (num) { node.stats.async.between = node.validateStat(num, 'stats.async.between') },

        within: 0,
        setWithin (num) { node.stats.async.within = node.validateStat(num, 'stats.async.within') }
      },

      rawTotals: {
        sync: 0,
        async: {
          between: 0,
          within: 0
        }
      }
    }
  }
  getWithinTime () { return this.stats.sync + this.stats.async.within }
  getBetweenTime () { return this.stats.async.between }

  getParentNode () {
    return this.dataSet.getByNodeType(this.constructor.name, this.parentId)
  }

  getSameType (nodeId) {
    return this.dataSet.getByNodeType(this.constructor.name, nodeId)
  }

  validateStat (num, statType = '', aboveZero = false) {
    const targetDescription = `For ${this.constructor.name} ${this.id}${statType ? ` ${statType}` : ''}`
    return validateNumber(num, targetDescription, aboveZero)
  }

  static markFromArray (markArray) {
    if (markArray instanceof Map) return markArray
    // node.mark is always an array of length 3, based on this schema:
    const markKeys = ['party', 'module', 'name']
    // 'party' (as in 'third-party') will be one of 'user', 'external' or 'nodecore'.
    // 'module' and 'name' will be null unless frames met conditions in /analysis/aggregate
    const mark = new Map(markArray.map((value, i) => [markKeys[i], value]))
    // for example, 'nodecore.net.onconnection', or 'module.somemodule', or 'user'
    mark.string = markArray.reduce((string, value) => string + (value ? '.' + value : ''))
    return mark
  }
}

class ClusterNode extends DataNode {
  constructor (rawNode, dataSet) {
    super(dataSet)

    const defaultProperties = {
      clusterId: 0,
      parentClusterId: null,
      children: [],
      name: 'miscellaneous',
      mark: null,
      isRoot: false,
      nodes: []
    }
    const node = Object.assign(defaultProperties, rawNode)

    this.isRoot = (node.isRoot || node.clusterId === 1)

    this.clusterId = node.clusterId
    this.parentClusterId = node.parentClusterId
    this.name = node.name

    this.children = node.children

    // These contain decimals referring to the portion of a clusterNode's delay attributable to some label
    this.decimals = {
      type: {between: new Map(), within: new Map()}, // Node async_hook types: 'HTTPPARSER', 'TickObject'...
      // TODO: subTypeCategories stats
      typeCategory: {between: new Map(), within: new Map()}, // Defined in .getAsyncTypeCategories() below
      party: {between: new Map(), within: new Map()} // From .mark - 'user', 'module' or 'nodecore'
    }

    this.nodes = new Map()

    const mark = node.mark || (node.nodes.length ? node.nodes[0].mark : null)
    this.mark = mark ? DataNode.markFromArray(mark) : null
  }
  generateAggregateNodes (nodes) {
    for (var i = nodes.length - 1; i >= 0; i--) {
      const aggregateNode = new AggregateNode(nodes[i], this)
      this.nodes.set(aggregateNode.aggregateId, aggregateNode)
    }
  }
  setDecimal (num, classification, position, label) {
    const decimalsMap = this.decimals[classification][position]
    const newValue = decimalsMap.has(label) ? decimalsMap.get(label) + num : num
    decimalsMap.set(label, this.validateStat(newValue))
  }
  getDecimal (classification, position, label) {
    const raw = this.stats.rawTotals
    const rawTotal = position === 'within' ? raw.async.within + raw.sync : raw.async.between

    const statType = `decimals.${classification}.${position}->${label}`
    const num = this.decimals[classification][position].get(label)
    const decimal = (num === 0 && rawTotal === 0) ? 0 : this.validateStat(num / rawTotal, statType)
    return decimal
  }
  getDecimalLabels (classification, position) {
    return this.decimals[classification][position].keys()
  }
  get id () {
    return this.clusterId
  }
  get parentId () {
    return this.parentClusterId
  }
}

class AggregateNode extends DataNode {
  constructor (rawNode, clusterNode) {
    super(clusterNode.dataSet)

    const defaultProperties = {
      aggregateId: 0,
      parentAggregateId: null,
      children: [],
      frames: [],
      type: 'none',
      mark: ['nodecore', null, null],
      isRoot: false,
      sources: []
    }
    const node = Object.assign(defaultProperties, rawNode)

    this.isRoot = (node.isRoot || node.aggregateId === 1)

    this.aggregateId = node.aggregateId
    this.parentAggregateId = node.parentAggregateId
    this.children = node.children
    this.clusterNode = clusterNode

    this.isBetweenClusters = clusterNode.parentClusterId && clusterNode.getParentNode().nodes.has(node.parentAggregateId)

    this.frames = node.frames.map((frame) => {
      const frameItem = new Frame(frame)
      return {
        formatted: frameItem.format(),
        data: frameItem
      }
    })
    this.name = this.frames.length ? this.frames[0].formatted.slice(7) : (this.isRoot ? 'root' : 'empty frames')

    this.mark = DataNode.markFromArray(node.mark)

    // Node's async_hook types - see https://nodejs.org/api/async_hooks.html#async_hooks_type
    // 29 possible values defined in node core, plus other user-defined values can exist
    this.type = node.type
    const [typeCategory, typeSubCategory] = AggregateNode.getAsyncTypeCategories(this.type)
    this.typeCategory = typeCategory
    this.typeSubCategory = typeSubCategory

    const debugMode = this.dataSet.settings.debugMode

    // This loop runs thousands+ times, unbounded and scales with size of profile. Optimize for browsers
    const sourcesLength = node.sources.length
    if (debugMode) this.sources = new Array(sourcesLength)

    for (var i = 0; i < sourcesLength; i++) {
      const sourceNode = new SourceNode(node.sources[i], this)

      if (debugMode) this.sources[i] = sourceNode
    }
    if (debugMode) this.dataSet.sourceNodes = this.dataSet.sourceNodes.concat(this.sources)

    this.dataSet.aggregateNodes.set(this.aggregateId, this)
  }
  applyDecimalsToCluster () {
    const apply = (time, betweenOrWithin) => {
      this.clusterNode.setDecimal(time, 'type', betweenOrWithin, this.type)
      this.clusterNode.setDecimal(time, 'typeCategory', betweenOrWithin, this.typeCategory)
      this.clusterNode.setDecimal(time, 'party', betweenOrWithin, this.mark.get('party'))
    }

    if (this.isBetweenClusters) {
      apply(this.stats.rawTotals.async.between, 'between')
      apply(this.stats.rawTotals.sync, 'within')
    } else {
      apply(this.stats.rawTotals.async.between + this.stats.rawTotals.sync, 'within')
    }
  }
  get id () {
    return this.aggregateId
  }
  get parentId () {
    return this.parentAggregateId
  }
  static getAsyncTypeCategories (typeName) {
  // Combines node's async_hook types into sets of more user-friendly thematic categories
  // Based on https://gist.github.com/mafintosh/e31eb1d61f126de019cc10344bdbb62b
    switch (typeName) {
      case 'FSEVENTWRAP':
      case 'FSREQWRAP':
      case 'STATWATCHER':
        return ['files-streams', 'fs']
      case 'JSSTREAM':
      case 'WRITEWRAP':
      case 'SHUTDOWNWRAP':
        return ['files-streams', 'streams']
      case 'ZLIB':
        return ['files-streams', 'zlib']

      case 'HTTPPARSER':
      case 'PIPECONNECTWRAP':
      case 'PIPEWRAP':
      case 'TCPCONNECTWRAP':
      case 'TCPSERVER':
      case 'TCPWRAP':
      case 'TCPSERVERWRAP':
        return ['networks', 'networking']
      case 'UDPSENDWRAP':
      case 'UDPWRAP':
        return ['networks', 'network']
      case 'GETADDRINFOREQWRAP':
      case 'GETNAMEINFOREQWRAP':
      case 'QUERYWRAP':
        return ['networks', 'dns']

      case 'PBKDF2REQUEST':
      case 'RANDOMBYTESREQUEST':
      case 'TLSWRAP':
      case 'SSLCONNECTION':
        return ['crypto', 'crypto']

      case 'TIMERWRAP':
      case 'Timeout':
      case 'Immediate':
      case 'TickObject':
        return ['timing-promises', 'timers-and-ticks']
      case 'PROMISE':
        return ['timing-promises', 'promises']

      case 'PROCESSWRAP':
      case 'TTYWRAP':
      case 'SIGNALWRAP':
        return ['other', 'process']
      case 'none':
        return ['other', 'root']
      default:
        return ['other', 'user-defined']
    }
  }
}

class SourceNode {
  constructor (rawSource, aggregateNode) {
    this.dataSet = aggregateNode.dataSet

    const defaultProperties = {
      asyncId: 0,
      parentAsyncId: null,
      children: [],
      init: null,
      before: [],
      after: [],
      destroy: null
    }
    const source = Object.assign(defaultProperties, rawSource)

    this.asyncId = source.asyncId
    this.parentAsyncId = source.parentAsyncId
    this.triggerAsyncId = source.parentAsyncId
    this.executionAsyncId = source.parentAsyncId

    this.init = source.init // numeric timestamp
    this.before = source.before // array of numeric timestamps
    this.after = source.after // array of numeric timestamps
    this.destroy = source.destroy // numeric timestamp

    this.aggregateNode = aggregateNode

    // This loop runs thousands+++ of times, unbounded and scales with size of profile. Optimize for browsers
    const callbackEventCount = source.before.length
    for (var i = 0; i < callbackEventCount; i++) {
      this.dataSet.callbackEvents.add(new CallbackEvent(i, this))
    }
  }
  get id () {
    return this.asyncId
  }
}

// ArticificalNodes are created in /layout/ for layout-specific combinations or modified versions of nodes
class ArtificialNode extends ClusterNode {
  constructor (rawNode, nodeToCopy) {
    const nodeProperties = Object.assign({}, nodeToCopy, rawNode, {
      clusterId: rawNode.id || nodeToCopy.id,
      parentClusterId: rawNode.parentId || nodeToCopy.parentId,
      nodes: []
    })
    super(nodeProperties, nodeToCopy.dataSet)

    const defaultProperties = {
      nodeType: 'AggregateNode'
    }
    const node = Object.assign(defaultProperties, rawNode)

    this.nodeType = node.nodeType
  }
  applyAggregateNodes (nodes) {
    if (!nodes.size) return

    for (const [aggregateId, aggregateNode] of nodes) {
      this.nodes.set(aggregateId, aggregateNode)
      if (!this.mark) this.mark = aggregateNode.mark
    }
  }
  applyMark (mark) {
    if (!this.mark) this.mark = mark
  }
  getSameType (nodeId) {
    return this.dataSet.getByNodeType(this.nodeType, nodeId)
  }
  aggregateStats (dataNode) {
    this.stats.setSync(this.stats.sync + dataNode.stats.sync)
    this.stats.async.setWithin(this.stats.async.within + dataNode.stats.async.within)
    this.stats.async.setBetween(this.stats.async.between + dataNode.stats.async.between)

    this.stats.rawTotals.sync += dataNode.stats.rawTotals.sync
    this.stats.rawTotals.async.between += dataNode.stats.rawTotals.async.between
    this.stats.rawTotals.async.within += dataNode.stats.rawTotals.async.within
  }
  aggregateDecimals (dataNode, classification, position) {
    if (dataNode.decimals) {
      // e.g. combining clusterNodes
      const byLabel = dataNode.decimals[classification][position]
      for (const [label, value] of byLabel) {
        this.setDecimal(value, classification, position, label)
      }
    } else {
      // e.g. combining aggregateNodes
      const label = dataNode[classification]
      const rawTotals = dataNode.stats.rawTotals
      const value = rawTotals.async[position] + (position === 'within' ? rawTotals.sync : 0)
      this.setDecimal(value, classification, position, label)
    }
  }
}

class ShortcutNode extends ArtificialNode {
  constructor (rawNode, nodeToCopy) {
    super(rawNode, nodeToCopy)
    this.shortcutTo = nodeToCopy
  }
}

module.exports = {
  ShortcutNode,
  ArtificialNode,
  ClusterNode,
  AggregateNode,
  SourceNode,
  DataNode
}

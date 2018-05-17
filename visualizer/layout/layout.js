'use strict'

const Stem = require('./stems.js')
const Connection = require('./connections.js')
const Scale = require('./scale.js')
const Positioning = require('./positioning.js')
const { ClusterNode } = require('../data/data-node.js')
const { validateNumber } = require('../validation.js')

const _ = {
  difference: require('lodash/difference'),
  intersection: require('lodash/intersection')
}

class Layout {
  constructor ({ dataNodes, connection }, settings) {
    const defaultSettings = {
      collapseNodes: false,
      svgDistanceFromEdge: 30,
      lineWidth: 1.5,
      labelMinimumSpace: 12,
      svgWidth: 750,
      svgHeight: 750,
      allowStretch: true
    }
    this.settings = Object.assign(defaultSettings, settings)
    this.initialInput = {
      dataNodes,
      connection
    }

    this.scale = new Scale(this)
    this.positioning = new Positioning(this)

    this.connections = []
    this.connectionsByTargetId = new Map()

    this.rootLayoutNode = null

    if (connection) {
      this.prepareSublayoutNodes(dataNodes, connection)
    } else {
      this.prepareLayoutNodes(dataNodes)
    }
  }

  // Note: This currently does not support missing midpoints (implicit children)
  prepareLayoutNodes (dataNodes) {
    this.layoutNodes = new Map()

    const dataNodeById = new Map(dataNodes.map(node => [node.id, node]))
    const createLayoutNode = (nodeId, parentLayoutNode) => {
      const dataNode = dataNodeById.get(nodeId)
      if (!dataNode || this.layoutNodes.has(dataNode.id)) return

      const layoutNode = new LayoutNode(dataNode, parentLayoutNode)
      this.layoutNodes.set(dataNode.id, layoutNode)

      if (dataNode.isRoot) this.rootLayoutNode = this.layoutNodes.get(dataNode.id)

      if (parentLayoutNode) parentLayoutNode.children.push(dataNode.id)
      for (let i = 0; i < dataNode.children.length; ++i) {
        const childNodeId = dataNode.children[i]
        createLayoutNode(childNodeId, layoutNode)
      }
    }
    const topDataNodes = dataNodes.filter(dataNode => !dataNode.parent)
    for (let i = 0; i < topDataNodes.length; ++i) {
      const topDataNode = topDataNodes[i]
      createLayoutNode(topDataNode.id)
    }
  }

  // For layouts inside a clusterNode, rather than layouts of all cluterNodes
  prepareSublayoutNodes (dataNodes, connection) {
    // This sublayout is of nodes within targetNode. Some have parents within sourceNode

    const includedIds = new Set(dataNodes.map(dataNode => dataNode.id))

    const shortcutToSource = !connection.sourceNode ? null : new ShortcutNode({
      id: connection.sourceNode.id,
      isRoot: true,
      children: []
    }, connection.sourceNode)

    if (shortcutToSource) {
      dataNodes.unshift(shortcutToSource)
    }

    // let nodeType // TODO: see if this is necessary when clusters-of-clusters are implemented
    for (let i = 0; i < dataNodes.length; ++i) {
      const dataNode = dataNodes[i]
      // if (!nodeType) nodeType = node.constructor.name

      if (shortcutToSource && !includedIds.has(dataNode.parentId)) {
        shortcutToSource.children.push(dataNode.id)
      }
    for (let i = 0; i < dataNode.children.length; ++i) {
      const childId = dataNode.children[i]
        // If this child is in another cluster, add a dummy leaf node -> clickable link/shortcut to that cluster
        if (!dataNodes.some(dataNode => dataNode.id === childId)) {
          const childNode = dataNode.getSameType(childId)

          // If we're inside a cluster of clusters, childNode might be on the top level of clusters
          const shortcutNode = new ShortcutNode({
            id: childId,
            children: [],
            parentId: dataNode.id
          // Use the name, mark etc of the clusterNode the target node is inside
          }, childNode.clusterId ? childNode : childNode.clusterNode)

          dataNodes.push(shortcutNode)
        }
      }
    }
    this.prepareLayoutNodes(dataNodes)
  }

  processBetweenData (generateConnections = true) {
    const layoutNodesIterator = this.layoutNodes.values()
    for (let i = 0; i < this.layoutNodes.size; ++i) {
      const layoutNode = layoutNodesIterator.next().value
      layoutNode.stem = new Stem(this, layoutNode)

      if (generateConnections && layoutNode.parent) {
        const connection = new Connection(layoutNode.parent, layoutNode, this.scale)
        this.connectionsByTargetId.set(layoutNode.id, connection)
        this.connections.push(connection)
        layoutNode.inboundConnection = connection
      }
    }
  }

  processHierarchy (settingsOverride) {
    const settings = settingsOverride || this.settings

    this.processBetweenData(!settings.collapseNodes)
    this.updateScale()
    if (settings.collapseNodes) {
      this.collapseNodes()
      this.processBetweenData(true)
      this.updateScale()
    }
  }

  updateScale () {
    this.scale.calculatePreScaleFactor()
    this.updateStems()
    this.scale.calculateScaleFactor()
    this.updateStems()
  }

  updateStems () {
    const layoutNodesIterator = this.layoutNodes.values()
    for (let i = 0; i < this.layoutNodes.size; ++i) {
      const layoutNode = layoutNodesIterator.next().value
      layoutNode.stem.update()
    }
  }

  // Like DataSet.processData(), call it seperately in main flow so that can be interupted in tests etc
  generate (settingsOverride) {
    this.processHierarchy(settingsOverride)
    this.positioning.formClumpPyramid()
    this.positioning.placeNodes()
  }

  collapseNodes () {
    const { layoutNodes, scale } = this
    // TODO: stop relying on coincidental Map.keys() order (i.e. stuff would break when child occurs before parent)
    const topLayoutNodes = new Set([...this.layoutNodes.values()].filter(layoutNode => !layoutNode.parent))

    const minimumNodes = 3

    let topNodesIterator = topLayoutNodes.values()
    for (let i = 0; i < topLayoutNodes.size; ++i) {
      const topNode = topNodesIterator.next().value
      collapseHorizontally(topNode)
    }
    const newLayoutNodes = new Map()
    // Isolating vertical collapsing from horizontal collapsing
    // Mainly for aesthetic reasons, but also reduces complexity (easier to debug)
    topNodesIterator = topLayoutNodes.values()
    for (let i = 0; i < topLayoutNodes.size; ++i) {
      const topNode = topNodesIterator.next().value
      collapseVertically(topNode)
      indexNode(topNode)
    }
    this.layoutNodes = newLayoutNodes

    function indexNode (layoutNode) {
      newLayoutNodes.set(layoutNode.id, layoutNode)
      for (let i = 0; i < layoutNode.children.length; ++i) {
        const childId = layoutNode.children[i]
        indexNode(layoutNodes.get(childId))
      }
    }

    function collapseHorizontally (layoutNode) {
      let combined
      let prevTiny
      const children = layoutNode.children.map(childId => layoutNodes.get(childId))
      for (let i = 0; i < children.length; ++i) {
        const child = children[i]
        const belowThreshold = isBelowThreshold(child)
        collapseHorizontally(child)
        if (layoutNodes.size === minimumNodes) {
          break
        }
        if (belowThreshold) {
          if ((combined || prevTiny)) {
            combined = combineLayoutNodes(combined || prevTiny, child)
          }
          prevTiny = child
        }
      }
    }

    function collapseVertically (layoutNode) {
      const children = layoutNode.children.map(childId => layoutNodes.get(childId))
      let combined
      for (let i = 0; i < children.length; ++i) {
        const child = children[i]
        const belowThreshold = child.collapsedNodes || isBelowThreshold(child)
        const collapsedChild = collapseVertically(child)
        if (layoutNodes.size === minimumNodes) {
          break
        }
        if (belowThreshold && !topLayoutNodes.has(layoutNode)) {
          const hostNode = combined || layoutNode
          const squashNode = collapsedChild || child
          combined = combineLayoutNodes(hostNode, squashNode)
        }
      }
      return combined
    }

    function combineLayoutNodes (hostNode, squashNode) {
      const nodeTypes = [hostNode.constructor.name, squashNode.constructor.name]
      const forbiddenTypes = ['ArtificialNode', 'ShortcutNode']
      if (_.intersection(nodeTypes, forbiddenTypes).length) {
        return
      }

      if (!hostNode || !squashNode) {
        return
      }
      const isCollapsible = layoutNode => layoutNode.collapsedNodes || isBelowThreshold(layoutNode)
      if (!isCollapsible(hostNode) || !isCollapsible(squashNode)) {
        return
      }
      // TODO: also check minimumNodes here?
      // TODO: check long child?

      const parent = hostNode.parent
      if (hostNode.parent !== squashNode.parent && squashNode.parent !== hostNode) {
        const toContext = layoutNode => ((layoutNode.parent && toContext(layoutNode.parent) + '=>') || '') + layoutNode.id
        const context = toContext(hostNode) + ' + ' + toContext(squashNode)
        throw new Error('Cannot combine nodes - clump/stem mismatch: ' + context)
      }
      const children = _.difference(hostNode.children.concat(squashNode.children), [squashNode.id])

      const hostNodes = hostNode.collapsedNodes ? [...hostNode.collapsedNodes] : [hostNode]
      const squashNodes = squashNode.collapsedNodes ? [...squashNode.collapsedNodes] : [squashNode]
      const collapsed = new CollapsedLayoutNode(hostNodes.concat(squashNodes), parent, children)

      // Update refs
      const inputNodes = [hostNode, squashNode]
      for (let i = 0; i < inputNodes.length; ++i) {
        const layoutNode = inputNodes[i]
        layoutNode.parent = null
        layoutNode.children = []
        // TODO: optimize .children and .collapsedNodes using Set?
        // (faster at lookup and removal, but slower at addition and iteration - https://stackoverflow.com/a/39010462)
        const index = parent.children.indexOf(layoutNode.id)
        if (index !== -1) parent.children.splice(index, 1)
      }
      parent.children.unshift(collapsed.id)
      for (let i = 0; i < children.length; ++i) {
        const child = layoutNodes.get(children[i])
        child.parent = collapsed
      }
      // Update indices
      layoutNodes.set(collapsed.id, collapsed)
      layoutNodes.delete(hostNode.id)
      layoutNodes.delete(squashNode.id)

      return collapsed
    }

    function isBelowThreshold (layoutNode) {
      return layoutNode.getTotalTime() * scale.sizeIndependentScale < 10
    }
  }
}

class LayoutNode {
  constructor (node, parent) {
    this.id = node.id
    this.node = node
    this.stem = null
    this.position = null
    this.inboundConnection = null
    this.parent = parent
    this.children = []
  }
  getBetweenTime () {
    return this.node.getBetweenTime()
  }
  getWithinTime () {
    return this.node.getWithinTime()
  }
  getTotalTime () {
    return this.getBetweenTime() + this.getWithinTime()
  }
  validateStat (...args) {
    return this.node.validateStat(...args)
  }
}

class CollapsedLayoutNode {
  constructor (layoutNodes, parent, children) {
    this.id = 'clump:' + layoutNodes.map(layoutNode => layoutNode.id).join(',')
    this.collapsedNodes = layoutNodes
    this.parent = parent
    this.children = children || []

    for (let i = 0; i < layoutNodes.length; ++i) {
      const layoutNode = layoutNodes[i]
      const node = layoutNode.node
      if (!this.node) {
        this.node = new ArtificialNode({
          nodeType: node.constructor.name
        }, node)
      }
      this.node.aggregateStats(node)
      this.applyDecimals(node)
    }
  }
  getBetweenTime () {
    return this.collapsedNodes.reduce((total, layoutNode) => total + layoutNode.node.getBetweenTime(), 0)
  }
  getWithinTime () {
    return this.collapsedNodes.reduce((total, layoutNode) => total + layoutNode.node.getWithinTime(), 0)
  }
  validateStat (num, statType = '', aboveZero = false) {
    const targetDescription = `For ${this.constructor.name} ${this.id}${statType ? ` ${statType}` : ''}`
    return validateNumber(num, targetDescription, aboveZero)
  }
  applyDecimals (otherNode) {
    this.node.aggregateDecimals(otherNode, 'type', 'between')
    this.node.aggregateDecimals(otherNode, 'type', 'within')
    this.node.aggregateDecimals(otherNode, 'typeCategory', 'between')
    this.node.aggregateDecimals(otherNode, 'typeCategory', 'within')
    // TODO: aggregate party, draw appropriate pie
  }
}

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
      const byLabel = dataNode.decimals[classification][position]
      for (const [label, value] of byLabel) {
        this.setDecimal(value, classification, position, label)
      }
    } else {
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

module.exports = Layout

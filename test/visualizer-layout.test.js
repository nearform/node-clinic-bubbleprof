'use strict'

const test = require('tap').test
const loadData = require('../visualizer/data/index.js')
const Layout = require('../visualizer/layout/layout.js')

const { mockTopology } = require('./visualizer-util/fake-topology.js')

function toLink (layout, layoutNode) {
  const strayChildren = layoutNode.children.map(childId => layout.layoutNodes.get(childId)).filter(child => child.parent !== layoutNode)
  if (strayChildren.length) {
    throw new Error(`layoutNode ${layoutNode.id} has stray children: [${strayChildren.map(toParentLink).join(', ')}]`)
  }
  return layoutNode.id + ' => ' + layoutNode.children.join(';')
}

function toParentLink (layoutNode) {
  const parentId = (layoutNode.parent && layoutNode.parent.id) || ''
  return parentId + ' <= ' + layoutNode.id
}

function createLinkValidator (layout) {
  return (layoutNode) => toLink(layout, layoutNode)
}

function toTypeId (layoutNode) {
  return layoutNode.node.constructor.name + '-' + layoutNode.id
}

const dataSettings = {
  debugMode: true
}

const settings = Object.assign({
  svgWidth: 1000,
  svgHeight: 1000,
  labelMinimumSpace: 0,
  lineWidth: 0,
  svgDistanceFromEdge: 30,
  collapseNodes: true
}, dataSettings)

test('Visualizer layout - builds sublayout from connection', function (t) {
  const topology = [
    ['1.2.3.4.5', 100]
  ]
  const dataSet = loadData(dataSettings, mockTopology(topology))
  const initialDataNodes = [...dataSet.clusterNodes.values()]
  const uncollapsedSettings = Object.assign({ collapseNodes: false }, settings)
  const initialLayout = new Layout({ dataNodes: initialDataNodes }, uncollapsedSettings)
  initialLayout.processBetweenData()
  const traversedLayoutNode = initialLayout.layoutNodes.get(4)
  const traversedLayout = initialLayout.createSubLayout(traversedLayoutNode, uncollapsedSettings)
  t.equal(traversedLayout.parentLayout.rootLayoutNode.id, initialLayout.rootLayoutNode.id)
  const toValidLink = createLinkValidator(traversedLayout)
  t.deepEqual([...traversedLayout.layoutNodes.values()].map(toTypeId), ['ShortcutNode-shortcut:3', 'AggregateNode-4', 'ShortcutNode-5'])
  t.deepEqual([...traversedLayout.layoutNodes.values()].map(toValidLink), ['shortcut:3 => 4', '4 => 5', '5 => '])

  t.end()
})

// R=Root / Top Node, T=Tiny, L=Long, C=Collapsed, P=Tiny Parent Of Long

// R->T->T->P->L gives R->C->P->L
test('Visualizer layout - collapse - collapses vertically (except root and Ps)', function (t) {
  const topology = [
    ['1.2.3.4.5', 100]
  ]
  const dataSet = loadData(dataSettings, mockTopology(topology))
  const dataNodes = [...dataSet.clusterNodes.values()]
  dataSet.clusterNodes.get(1).stats.async.within = 1 // make root short
  const layout = new Layout({ dataNodes }, settings)
  layout.processBetweenData()
  layout.updateScale()
  const toValidLink = createLinkValidator(layout)
  const actualBefore = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualBefore, ['1 => 2', '2 => 3', '3 => 4', '4 => 5', '5 => '])
  layout.collapseNodes()
  layout.processBetweenData()
  layout.updateScale()
  const actualAfter = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualAfter, ['1 => x1', 'x1 => 4', '4 => 5', '5 => '])

  t.end()
})

test('Visualizer layout - collapse - does not collapse shortcut nodes', function (t) {
  const topology = [
    ['1.2.3', 1],
    ['1.2.4', 1],
    ['1.2.5', 1]
  ]
  const dataSet = loadData(dataSettings, mockTopology(topology))
  const initialDataNodes = [...dataSet.clusterNodes.values()]
  const initialLayout = new Layout({ dataNodes: initialDataNodes }, settings)
  initialLayout.processHierarchy()
  const traversedLayoutNode = initialLayout.layoutNodes.get(2)
  const traversedLayout = initialLayout.createSubLayout(traversedLayoutNode, settings)
  traversedLayout.processHierarchy()
  t.deepEqual([...traversedLayout.layoutNodes.values()].map(toTypeId), ['ShortcutNode-shortcut:1', 'AggregateNode-2', 'ShortcutNode-3', 'ShortcutNode-4', 'ShortcutNode-5'])

  t.end()
})

test('Visualizer layout - collapse - merges shortcuts pointing to the same view', function (t) {
  const topology = [
    ['1.2.3.4.5', 1],
    ['1.2.3.6.7', 1],
    ['1.2.3.8.9', 1]
  ]
  const dataSet = loadData(dataSettings, mockTopology(topology))
  const initialDataNodes = [...dataSet.clusterNodes.values()]
  dataSet.clusterNodes.get(2).stats.async.between = 100 // make 2 long
  dataSet.clusterNodes.get(3).stats.async.between = 100 // make 3 long
  dataSet.clusterNodes.get(5).stats.async.between = 100 // make 5 long
  dataSet.clusterNodes.get(7).stats.async.between = 100 // make 7 long
  dataSet.clusterNodes.get(9).stats.async.between = 100 // make 9 long
  const initialLayout = new Layout({ dataNodes: initialDataNodes }, settings)
  initialLayout.processHierarchy()
  let toValidLink = createLinkValidator(initialLayout)
  t.deepEqual([...initialLayout.layoutNodes.values()].map(toTypeId), ['ClusterNode-1', 'ClusterNode-2', 'ClusterNode-3', 'ArtificialNode-x2', 'ClusterNode-5', 'ClusterNode-7', 'ClusterNode-9'])
  t.deepEqual([...initialLayout.layoutNodes.values()].map(toValidLink), ['1 => 2', '2 => 3', '3 => x2', 'x2 => 5;7;9', '5 => ', '7 => ', '9 => '])
  const traversedLayoutNode = initialLayout.layoutNodes.get(3)
  const traversedLayout = initialLayout.createSubLayout(traversedLayoutNode, settings)
  traversedLayout.processHierarchy()
  toValidLink = createLinkValidator(traversedLayout)
  t.deepEqual([...traversedLayout.layoutNodes.values()].map(toTypeId), ['ShortcutNode-shortcut:2', 'AggregateNode-3', 'ShortcutNode-shortcut:x2'])
  t.deepEqual([...traversedLayout.layoutNodes.values()].map(toValidLink), ['shortcut:2 => 3', '3 => shortcut:x2', 'shortcut:x2 => '])

  t.end()
})

// R->T->T->P->L->T->T->P->L gives R->C->P->L->C->P->L
test('Visualizer layout - collapse - collapses vertically with break (except root and Ps)', function (t) {
  const topology = [
    ['1.2.3.4.5.6.7.8.9', 100]
  ]
  const dataSet = loadData(dataSettings, mockTopology(topology))
  const dataNodes = [...dataSet.clusterNodes.values()]
  dataSet.clusterNodes.get(1).stats.async.within = 1 // make root short
  dataSet.clusterNodes.get(5).stats.async.between = 100 // make 5 long
  const layout = new Layout({ dataNodes }, settings)
  layout.processBetweenData()
  layout.updateScale()
  const toValidLink = createLinkValidator(layout)
  const actualBefore = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualBefore, ['1 => 2', '2 => 3', '3 => 4', '4 => 5', '5 => 6', '6 => 7', '7 => 8', '8 => 9', '9 => '])
  layout.collapseNodes()
  layout.processBetweenData()
  layout.updateScale()
  const actualAfter = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualAfter, ['1 => x2', 'x2 => 4', '4 => 5', '5 => x1', 'x1 => 8', '8 => 9', '9 => '])

  t.end()
})

// LR->T->T->T->T gives LR->C->T
test('Visualizer layout - collapse - collapses vertically until minimum count threshold is hit', function (t) {
  const topology = [
    ['1.2.3.4.5', 1],
    ['1.2.3.4.6', 1]
  ]
  const dataSet = loadData(dataSettings, mockTopology(topology))
  const dataNodes = [...dataSet.clusterNodes.values()]
  dataSet.clusterNodes.get(1).stats.async.within = 1000 // make root long
  const layout = new Layout({ dataNodes }, settings)
  layout.processBetweenData()
  layout.updateScale()
  const toValidLink = createLinkValidator(layout)
  const actualBefore = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualBefore, ['1 => 2', '2 => 3', '3 => 4', '4 => 5;6', '5 => ', '6 => '])
  layout.collapseNodes()
  layout.processBetweenData()
  layout.updateScale()
  const actualAfter = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualAfter, ['1 => 2', '2 => x1', 'x1 => '])

  t.end()
})

// R->L->P->L
//     \>L->L
//     \>P->L
// gives
// R->L->C->L
//    |   \>L
//     \>L->L
test('Visualizer layout - collapse - collapses horizontally', function (t) {
  const topology = [
    ['1.2.3.4', 100],
    ['1.2.5.6', 100],
    ['1.2.7.8', 100]
  ]
  const dataSet = loadData(dataSettings, mockTopology(topology))
  const dataNodes = [...dataSet.clusterNodes.values()]
  dataSet.clusterNodes.get(2).stats.async.between = 100 // make 2 long
  dataSet.clusterNodes.get(5).stats.async.between = 100 // make 5 long
  const layout = new Layout({ dataNodes }, settings)
  layout.processBetweenData()
  layout.updateScale()
  const toValidLink = createLinkValidator(layout)
  const actualBefore = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualBefore, ['1 => 2', '2 => 3;5;7', '3 => 4', '4 => ', '5 => 6', '6 => ', '7 => 8', '8 => '])
  layout.collapseNodes()
  layout.processBetweenData()
  layout.updateScale()
  const actualAfter = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualAfter, ['1 => 2', '2 => x1;5', 'x1 => 4;8', '4 => ', '8 => ', '5 => 6', '6 => '])

  t.end()
})

// R->T->T->P->L
//     \>T->P->L
// gives
// R->C->P->L
//     \>P->L
// TODO: support horizontal collapsing between children of collapsed nodes, i.e. merge the Ps in this scenario
test('Visualizer layout - collapse - collapses both horizontally and vertically (except root and Ps)', function (t) {
  const topology = [
    ['1.2.3.4.5', 100],
    ['1.2.6.7.8', 100]
  ]
  const dataSet = loadData(dataSettings, mockTopology(topology))
  const dataNodes = [...dataSet.clusterNodes.values()]
  dataSet.clusterNodes.get(1).stats.async.within = 1 // make root short
  const layout = new Layout({ dataNodes }, settings)
  layout.processBetweenData()
  layout.updateScale()
  const toValidLink = createLinkValidator(layout)
  const actualBefore = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualBefore, ['1 => 2', '2 => 3;6', '3 => 4', '4 => 5', '5 => ', '6 => 7', '7 => 8', '8 => '])
  layout.collapseNodes()
  layout.processBetweenData()
  layout.updateScale()
  const actualAfter = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualAfter, ['1 => x2', 'x2 => 4;7', '4 => 5', '5 => ', '7 => 8', '8 => '])

  t.end()
})

// ?->R->T->T->P->L
// ?\>R->P->L->L
// gives
// ?->R->C->P->L
// ?\>R->P->L->L
test('Visualizer layout - collapse - vertically collapses subset with missing root (except top nodes and Ps)', function (t) {
  const topology = [
    ['1.2.3.4.5.6', 100],
    ['1.7.8.9.10', 100]
  ]
  const dataSet = loadData(dataSettings, mockTopology(topology))
  dataSet.clusterNodes.get(9).stats.async.within = 100 // make 9 long
  const subset = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(nodeId => dataSet.clusterNodes.get(nodeId))
  const layout = new Layout({ dataNodes: subset }, settings)
  layout.processBetweenData()
  layout.updateScale()
  const toValidLink = createLinkValidator(layout)
  const actualBefore = [...layout.layoutNodes.values()].map(toValidLink)
  const sortedBefore = layout.getSortedLayoutNodes().map(toValidLink)
  t.deepEqual(actualBefore, ['2 => 3', '3 => 4', '4 => 5', '5 => 6', '6 => ', '7 => 8', '8 => 9', '9 => 10', '10 => '])
  t.deepEqual(sortedBefore, ['2 => 3', '7 => 8', '3 => 4', '8 => 9', '4 => 5', '9 => 10', '5 => 6', '10 => ', '6 => '])

  layout.collapseNodes()
  layout.processBetweenData()
  layout.updateScale()
  const actualAfter = [...layout.layoutNodes.values()].map(toValidLink)
  const sortedAfter = layout.getSortedLayoutNodes().map(toValidLink)
  t.deepEqual(actualAfter, ['2 => x1', 'x1 => 5', '5 => 6', '6 => ', '7 => 8', '8 => 9', '9 => 10', '10 => '])
  t.deepEqual(sortedAfter, ['2 => x1', '7 => 8', 'x1 => 5', '8 => 9', '5 => 6', '9 => 10', '6 => ', '10 => '])

  t.end()
})

// R->T->T->T->?
//     \>P->L->?
// gives
// R->T->C->L
test('Visualizer layout - collapse - collapses subset both vertically and horizontally with missing leaves (except root and Ps)', function (t) {
  const topology = [
    ['1.2.3.4.5', 100],
    ['1.2.6.7.8', 100]
  ]
  const dataSet = loadData(dataSettings, mockTopology(topology))
  dataSet.clusterNodes.get(1).stats.async.within = 1 // make root short
  dataSet.clusterNodes.get(7).stats.async.between = 100 // make 7 long
  const subset = [1, 2, 3, 4, 6, 7].map(nodeId => dataSet.clusterNodes.get(nodeId))
  const layout = new Layout({ dataNodes: subset }, settings)
  layout.processBetweenData()
  layout.updateScale()
  const toValidLink = createLinkValidator(layout)
  const actualBefore = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualBefore, ['1 => 2', '2 => 3;6', '3 => 4', '4 => ', '6 => 7', '7 => '])
  layout.collapseNodes()
  layout.processBetweenData()
  layout.updateScale()
  const actualAfter = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualAfter, ['1 => 2', '2 => x2', 'x2 => 7', '7 => '])

  t.end()
})

// T->L
//  \>L->T
//     \>T->T
//     \>T->T
//        \>T
//     \>L->T
//        \>T->T
// gives
// T->L
//  \>L->C
//     \>L->C
test('Visualizer layout - collapse - complex example', function (t) {
  const topology = [
    ['1.2', 100],
    ['1.3.4', 1],
    ['1.3.5.6', 1],
    ['1.3.7.8', 1],
    ['1.3.7.9', 1],
    ['1.3.10.11', 1],
    ['1.3.10.12.13', 1]
  ]
  const dataSet = loadData(dataSettings, mockTopology(topology))
  const dataNodes = [...dataSet.clusterNodes.values()]
  dataSet.clusterNodes.get(1).stats.async.within = 1 // make root short
  dataSet.clusterNodes.get(2).stats.async.within = 100 // make 2 long
  dataSet.clusterNodes.get(3).stats.async.within = 100 // make 3 long
  dataSet.clusterNodes.get(10).stats.async.within = 100 // make 10 long
  const layout = new Layout({ dataNodes }, settings)
  layout.processBetweenData()
  layout.updateScale()
  const toValidLink = createLinkValidator(layout)
  const actualBefore = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualBefore, ['1 => 2;3', '2 => ', '3 => 4;5;7;10', '4 => ', '5 => 6', '6 => ', '7 => 8;9', '8 => ', '9 => ', '10 => 11;12', '11 => ', '12 => 13', '13 => '])
  layout.collapseNodes()
  layout.processBetweenData()
  layout.updateScale()
  const actualAfter = [...layout.layoutNodes.values()].map(toValidLink)
  t.deepEqual(actualAfter, ['1 => 2;3', '2 => ', '3 => x3;10', 'x3 => ', '10 => x2', 'x2 => '])

  t.end()
})

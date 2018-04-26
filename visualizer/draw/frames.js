'use strict'

// const d3 = require('./d3-subset.js') // Currently unused but will be used
const HtmlContent = require('./html-content.js')

// Modified version of https://gist.github.com/samgiles/762ee337dff48623e729#gistcomment-2128332
// TODO: this duplicates a function in layout/positioning.js, use shared helper functions
function flatMapDeep (value) {
  return Array.isArray(value) ? [].concat(...value.map(x => flatMapDeep(x))) : value
}

class Frames extends HtmlContent {
  constructor (d3Container, contentProperties = {}) {
    super(d3Container, contentProperties)
    this.framesByNode = []
  }

  initializeElements () {
    super.initializeElements()

    this.d3Element.classed('frames-container', true)

    this.d3Element.append('span')
      .classed('close', true)
      .on('click', () => {
        this.ui.collapseFooter(true)
      })

    this.d3Heading = this.d3ContentWrapper.append('div')
      .classed('heading', true)

    this.ui.on('outputFrames', (aggregateNode) => {
      if (aggregateNode) {
        this.setData(aggregateNode)
      } else {
        this.reset()
      }
    })
  }

  reset () {
    this.node = null
    this.framesByNode = []
    this.ui.collapseFooter(true)
  }

  setData (aggregateNode) {
    this.node = aggregateNode
    this.isRoot = aggregateNode.isRoot

    this.framesByNode = []
    groupFrames(this.node, this.framesByNode)
    this.ui.collapseFooter(false)
  }

  draw () {
    super.draw()
    this.d3ContentWrapper.selectAll('.frame-item').remove()
    this.d3ContentWrapper.selectAll('.frame-group').remove()

    if (this.node) {
      this.drawFrames(this.framesByNode, this.d3ContentWrapper)
      this.d3Heading.text(`Showing async stack trace from async_hook "${this.node.name}"`)
    } else {
      this.d3Heading.text(`
        Click on a bubble or a connection to drill down and find the stack frames of the code it originates from.
      `)
    }
  }

  getDelaysText (aggregateNode) {
    const betweenFigure = this.ui.formatNumber(aggregateNode.getBetweenTime())
    const withinFigure = this.ui.formatNumber(aggregateNode.getWithinTime())
    return `<span class="figure">${betweenFigure} ms</span> in asynchronous delays, <span class="figure">${withinFigure} ms</span> in synchronous delays.`
  }

  drawFrames (frames, d3AppendTo) {
    if (!frames.length) {
      const d3Group = d3AppendTo.append('div')
        .classed('frame-group', true)
        .on('click', () => {
          d3Group.classed('collapsed', !d3Group.classed('collapsed'))
        })

      d3Group.append('div')
        .classed('sub-collapse-control', true)
        .html('<span class="arrow"></span> Empty frames')

      const d3EmptyFrameItem = d3Group.append('div')
        .classed('frame-item', true)

      if (frames.dataNode && frames.dataNode.isRoot) {
        d3EmptyFrameItem.text('This is the root node, representing the starting point of your application. No stack frames are available.')
      } else {
        d3EmptyFrameItem.text('No frames are available for this async_hook. It could be from a native module, or something not integrated with the async_hooks API.')
      }
    }
    for (const frame of frames) {
      if (frame.isGroup) {
        const d3Group = d3AppendTo.append('div')
          .classed('frame-group', true)

        const d3SubCollapseControl = d3Group.append('div')
          .classed('sub-collapse-control', true)

        let header = '<span class="arrow"></span>'
        if (frame.dataNode) {
          const isThisNode = frame.dataNode === this.node

          d3Group
            .classed('node-frame-group', true)
            .classed('collapsed', !isThisNode)
            .classed('this-node', isThisNode)

          header += `${flatMapDeep(frame).length} frames from `
          header += `${isThisNode ? 'this async_hook' : `previous async_hook "${frame.dataNode.name}"`}`
          header += `<div class="delays">${this.getDelaysText(frame.dataNode)}</span>`
        } else if (frame.party) {
          d3Group.classed(frame.party[0], true)
            .classed('collapsed', frame.party[0] !== 'user')
          header += `${frame.length} frame${frame.length === 1 ? '' : 's'} from ${frame.party[1]}`
        }
        d3SubCollapseControl.html(header)
          .on('click', () => {
            d3Group.classed('collapsed', !d3Group.classed('collapsed'))
          })

        this.drawFrames(frame, d3Group)
      } else {
        d3AppendTo.append('pre')
          .html(frame.formatted)
          .classed('frame-item', true)
      }
    }
  }
}

function groupFrames (aggregateNode, framesByNode) {
  let previousFrame
  let previousGroup
  const groupedFrames = []
  groupedFrames.dataNode = aggregateNode
  groupedFrames.isGroup = true

  for (const frame of aggregateNode.frames) {
    const party = frame.data.party
    if (!previousFrame || previousFrame.data.party[1] !== party[1]) {
      const group = [frame]
      group.isGroup = true
      group.party = party
      groupedFrames.push(group)
      previousGroup = group
    } else {
      previousGroup.push(frame)
    }
    previousFrame = frame
  }

  framesByNode.push(groupedFrames)

  // Full async stack trace - recurse through aggregate ancestry to the root aggregate node
  if (aggregateNode.parentId) groupFrames(aggregateNode.getParentNode(), framesByNode)
}

module.exports = Frames

'use strict'

const d3 = require('./d3-subset.js')
const LineCoordinates = require('../layout/line-coordinates.js')
const svgNodeElementTypes = require('./svg-node-element.js')


// Layout assigns each node: diameter, scaled + length, scaled + label * 2 + lineWidth


class SvgNodeDiagram {
  constructor (svgContainer) {
    this.svgContainer = svgContainer
    this.ui = svgContainer.ui

    this.svgNodes = new Map()


    this.ui.on('initializeFromData', () => {
      // Called once, creates group contents using d3's .append()
      this.initializeFromData()
    })

    this.ui.on('setData', () => {
      // Called any time the layout or ui object are changed
      this.setData()
    })

    this.ui.on('svgDraw', () => {
      // Called any time the SVG DOM elements need to be modified or redrawn
      this.draw()
    })
  }

  initializeElements () {
    this.d3Container = this.svgContainer.d3Element

    // Group to which one group for each node is appended
    this.d3Element = this.d3Container.append('g')
      .classed('node-links-wrapper', true)
  }

  setData () {
    this.dataArray = [...this.ui.layout.layoutNodes.values()]
    this.d3Enter = this.d3Element.selectAll('g.node-group')
      .data(this.dataArray)
      .enter()

    this.dataArray.forEach(layoutNode => {
      if (!this.svgNodes.has(layoutNode.id)) this.svgNodes.set(layoutNode.id, new SvgNode(this))
      this.svgNodes.get(layoutNode.id).setData(layoutNode)
    })
  }

  initializeFromData () {
    this.d3NodeGroups = this.d3Enter.append('g')
      .classed('node-group', true)
      .each((layoutNode, i, nodes) => {
        const d3NodeGroup = d3.select(nodes[i])

        const svgNode = this.svgNodes.get(layoutNode.id)
          .initializeElements(d3NodeGroup)
      })
      .on('mouseover', layoutNode => this.ui.highlightNode(layoutNode))
      .on('mouseout', () => this.ui.highlightNode(null))
      .on('click', (layoutNode) => {
        d3.event.stopPropagation()
        this.ui.selectNode(layoutNode)
      })
  }
  draw () {
    this.svgNodes.forEach(svgNode => svgNode.draw())
  }
}

class SvgNode {
  constructor (parentContent) {
    this.parentContent = parentContent
    this.ui = parentContent.ui

    // Set and updated in .setCoordinates():
    this.strokePadding = null
    this.degrees = null
    this.originPoint = null

    this.asyncBetweenLines = new SvgNodeSection(this, {
      dataPosition: 'asyncBetween',
      shapeClass: 'SvgLine'
    })
    this.asyncWithinLines = new SvgNodeSection(this, {
      dataPosition: 'asyncWithin',
      shapeClass: 'SvgSpiral'
    })
    this.syncBubbles = new SvgNodeSection(this, {
      dataPosition: 'asyncWithin',
      shapeClass: 'SvgBubble'
    })
  }

  setData (layoutNode) {
    this.layoutNode = layoutNode
    this.drawType = this.getDrawType(layoutNode)

    this.asyncBetweenLines.setData(layoutNode)
    if (this.drawType !== 'squash') {
      this.asyncWithinLines.setData(layoutNode)
      this.syncBubbles.setData(layoutNode)
    }

    if (this.d3NodeGroup) this.setCoordinates()
    return this
  }

  setCoordinates () {
    this.strokePadding = this.ui.settings.labelMinimumSpace // this.ui.settings.strokePadding
    this.labelMinimumSpace = this.ui.settings.labelMinimumSpace
    this.lineWidth = this.ui.settings.lineWidth

    this.circleCentre = {
      x: this.layoutNode.position.x,
      y: this.layoutNode.position.y
    }

    const inboundConnection = this.layoutNode.inboundConnection
    const previousPosition = inboundConnection ? inboundConnection.sourceLayoutNode.position : {
      // Root node position
      x: this.layoutNode.position.x,
      y: this.ui.settings.svgDistanceFromEdge - this.strokePadding - this.lineWidth
    }
    const connectCentresCoords = new LineCoordinates({
      x1: previousPosition.x,
      y1: previousPosition.y,
      x2: this.layoutNode.position.x,
      y2: this.layoutNode.position.y
    })

    this.degrees = connectCentresCoords.degrees

    // TODO: check that this doesn't look wrong in cases of drawType = squash but has withinTime
    const sourceRadius = inboundConnection ? this.getRadius(inboundConnection.sourceLayoutNode) + this.strokePadding : 0

    const offsetLength = sourceRadius + this.lineWidth / 2 + this.strokePadding
    const offsetBeforeLine = new LineCoordinates({
        radians: connectCentresCoords.radians,
        length: offsetLength,
        x1: previousPosition.x,
        y1: previousPosition.y
      })

    this.originPoint = {
      x: offsetBeforeLine.x2,
      y: offsetBeforeLine.y2
    }
  }

  initializeElements (d3NodeGroup) {
    this.d3NodeGroup = d3NodeGroup

    this.d3OuterPath = this.d3NodeGroup.append('path')
      .classed('outer-path', true)

    this.d3NameLabel = this.d3NodeGroup.append('text')
      .classed('text-label', true)
      .classed('name-label', true)

    this.d3TimeLabel = this.d3NodeGroup.append('text')
      .classed('text-label', true)
      .classed('time-label', true)

    this.setCoordinates()
    return this
  }

  draw () {
    this.drawOuterPath()
    this.drawNameLabel()
    this.drawTimeLabel()
  }

  drawNameLabel () {
    this.d3NameLabel.text(this.layoutNode.node.name)

    if (!this.layoutNode.children.length) {
      // Is a leaf / endpoint - position at end of line, continuing line
      this.d3NameLabel.classed('endpoint-label', true)
      this.d3NameLabel.classed('upper-label', false)
      this.d3NameLabel.classed('smaller-label', this.drawType === 'squash')

      const toEndpoint = new LineCoordinates({
        x1: this.circleCentre.x,
        y1: this.circleCentre.y,
        length: this.getRadius() + this.lineWidth + this.strokePadding,
        degrees: this.degrees
      })

      const {
        x2,
        y2
      } = toEndpoint

      const lengthToSide = getLengthToSide(x2, y2, this.degrees, this.ui.settings)
      const lengthToBottom = getLengthToBottom(x2, y2, this.degrees, this.ui.settings)
      const lengthToEdge = Math.min(lengthToSide, lengthToBottom)

      const textAfterTrim = trimText(this.d3NameLabel, lengthToEdge)

      this.d3NameLabel.classed('hidden', !textAfterTrim)

      const labelDegrees = labelRotation(this.degrees)
      const transformString = `translate(${x2}, ${y2}) rotate(${labelDegrees})`
      if (textAfterTrim) this.d3NameLabel.attr('transform', transformString)

      this.d3NameLabel.classed('flipped-label', labelDegrees !== this.degrees)
    } else {

      if (this.drawType === 'noNameLabel') {
        this.d3NameLabel.classed('hidden', true)
        return
      }

      // Is not a leaf / endpoint - position on line or circle
      this.d3NameLabel.classed('upper-label', true)
      this.d3NameLabel.classed('endpoint-label', false)
      this.d3NameLabel.classed('smaller-label', false)
      this.d3NameLabel.classed('flipped-label', false)

      if (this.drawType === 'labelOnLine') {
        const textAfterTrim = trimText(this.d3NameLabel, this.getLength() - this.strokePadding)
        this.d3NameLabel.classed('hidden', !textAfterTrim)

        const toMidwayPoint = new LineCoordinates({
          x1: this.originPoint.x,
          y1: this.originPoint.y,
          length: this.getLength() / 2,
          degrees: this.degrees
        })
        const transformString = `translate(${toMidwayPoint.x2}, ${toMidwayPoint.y2}) rotate(${labelRotation(this.degrees)})`
        this.d3NameLabel.attr('transform', transformString)

        this.d3NameLabel.classed('on-line-label', true)
      } else {
        this.d3NameLabel.classed('on-line-label', false)
      }

      if (this.drawType === 'labelInCircle') {
        const textAfterTrim = trimText(this.d3NameLabel, this.getRadius() * 1.5 - this.strokePadding)
        this.d3NameLabel.classed('hidden', !textAfterTrim)
        this.d3NameLabel.attr('transform', `translate(${this.circleCentre.x}, ${this.circleCentre.y}) rotate(${labelRotation(this.degrees - 90)})`)

        this.d3NameLabel.classed('in-circle-label', true)
      } else {
        this.d3NameLabel.classed('in-circle-label', false)
      }
    }

  }

  drawTimeLabel () {
    this.d3TimeLabel.text(formatTimeLabel(this.layoutNode.node.stats.overall))

    if (!this.layoutNode.children.length || this.drawType === 'noNameLabel' || this.drawType === 'labelOnLine') {
      // Position on line
      const textAfterTrim = trimText(this.d3TimeLabel, this.getLength() - this.strokePadding)
      this.d3TimeLabel.classed('hidden', !textAfterTrim)

      const toMidwayPoint = new LineCoordinates({
        x1: this.originPoint.x,
        y1: this.originPoint.y,
        length: this.getLength() / 2,
        degrees: this.degrees
      })
      const transformString = `translate(${toMidwayPoint.x2}, ${toMidwayPoint.y2}) rotate(${labelRotation(this.degrees)})`
      this.d3TimeLabel.attr('transform', transformString)

      this.d3TimeLabel.classed('on-line-label', true)
      this.d3TimeLabel.classed('in-circle-label', false)

      // If this isn't an endpoint and there's a visible name label, drop below it; else vertically centre
      this.d3TimeLabel.classed('lower-label', this.layoutNode.children.length && !this.d3NameLabel.classed('hidden'))
      return
    } else {
      // Position in circle
      const textAfterTrim = trimText(this.d3TimeLabel, this.getRadius() * 1.5 - this.strokePadding)
      this.d3TimeLabel.classed('hidden', !textAfterTrim)
      this.d3TimeLabel.attr('transform', `translate(${this.circleCentre.x}, ${this.circleCentre.y}) rotate(${labelRotation(this.degrees - 90)})`)

      this.d3TimeLabel.classed('in-circle-label', true)
      this.d3TimeLabel.classed('on-line-label', false)
      this.d3TimeLabel.classed('lower-label', true)
    }
  }

  drawOuterPath () {
    let outerPath = ''

    const toLineTopLeft = new LineCoordinates({
      x1: this.originPoint.x,
      y1: this.originPoint.y,
      length: this.strokePadding,
      degrees: this.degrees - 90
    })
    outerPath += `M ${toLineTopLeft.x2} ${toLineTopLeft.y2} `

    const toLineTopRight = new LineCoordinates({
      x1: toLineTopLeft.x2,
      y1: toLineTopLeft.y2,
      length: this.strokePadding * 2,
      degrees: this.degrees + 90
    })
    const toQCurveControlPoint = new LineCoordinates({
      x1: this.originPoint.x,
      y1: this.originPoint.y,
      length: this.strokePadding,
      degrees: this.degrees - 180
    })
    outerPath += `Q ${toQCurveControlPoint.x2} ${toQCurveControlPoint.y2} ${toLineTopRight.x2} ${toLineTopRight.y2}`
    const lineLength = this.getLength()

    const toLineBottomRight = new LineCoordinates({
      x1: toLineTopRight.x2,
      y1: toLineTopRight.y2,
      length: lineLength,
      degrees: this.degrees
    })

    outerPath += `L ${toLineBottomRight.x2} ${toLineBottomRight.y2} `

    if (this.drawType === 'squash') {
      // End with pointed arrow tip

      const toPointedTip = new LineCoordinates({
        x1: this.originPoint.x,
        y1: this.originPoint.y,
        length: lineLength + this.strokePadding,
        degrees: this.degrees
      })

      outerPath += `L ${toPointedTip.x2} ${toPointedTip.y2} `

      outerPath += 'L' // Ready for simple line to bottom left x y
    } else {
      // End with long-route circular arc around bubble, to bottom left x y

      const arcRadius = this.getRadius() + this.lineWidth
      // Arc definition: A radiusX radiusY x-axis-rotation large-arc-flag sweep-flag x y
      outerPath += `A ${arcRadius} ${arcRadius} 0 1 0`
    }

    const toLineBottomLeft = new LineCoordinates({
      x1: toLineBottomRight.x2,
      y1: toLineBottomRight.y2,
      length: this.strokePadding * 2,
      degrees: this.degrees - 90
    })

    outerPath += ` ${toLineBottomLeft.x2} ${toLineBottomLeft.y2} Z`

    this.d3OuterPath.attr('d', outerPath)
    this.d3OuterPath.attr('name', this.layoutNode.id)
  }

  getRadius (layoutNode = this.layoutNode) {
    if (layoutNode === this.layoutNode && this.drawType === 'squash') {
      return 0
    } else {
      return this.ui.layout.scale.getCircleRadius(layoutNode.getWithinTime())
    }
  }

  getLength (layoutNode = this.layoutNode) {
    if (this.drawType === 'squash') {
      return this.ui.layout.scale.getLineLength(layoutNode.getBetweenTime() + layoutNode.getWithinTime())
    } else {
      return this.ui.layout.scale.getLineLength(layoutNode.getBetweenTime())
    }
  }

  getDrawType (layoutNode) {
    const circleRadius = this.getRadius()
    const lineLength = this.getLength()

    // Too small to discriminate node elements; show a very short line
    if (circleRadius + lineLength < 2) return 'squash'

    // Prefer putting labels on lines over in circles if both are viable and similar
    if (lineLength > 30 && lineLength > circleRadius) return 'labelOnLine'

    if (circleRadius > 30) return 'labelInCircle'

    return 'noNameLabel'
  }
}

class SvgNodeSection {
  constructor (parentContent, settings) {
    this.parentContent = parentContent

    const {
      dataPosition,
      shape
    } = settings
    this.dataPosition = dataPosition
    this.shape = shape

    this.d3NodeGroups = this.parentContent.d3NodeGroups
  }
  setData (layoutNode) {
    this.layoutNode = layoutNode
  }
  initializeFromData () {
    const SvgNodeElement = svgNodeElementTypes[this.settings.shapeClass]

    this.d3Groups = this.d3Enter.append('g')
      .each((layoutNode, i, nodes) => {
        const d3Group = d3.select(nodes[i])

        for (const layoutNode of this.dataArray) {
          // For ctrl+f: calls new SvgLine(), new SvgSpiral() or new SvgCircle()
          const shapeByParty = new SvgNodeElement(this, d3Group, 'party')
            .setData(layoutNode)
            .initializeFromData()
          this.byParty.set(layoutNode.id, shapeByParty)

          const shapeByType = new SvgNodeElement(this, d3Group, 'typeCategory')
            .setData(layoutNode)
            .initializeFromData()
          this.byCategory.set(layoutNode.id, shapeByType)
        }
      })
  }
  draw () {
  }
}

function getLengthToBottom (x1, y1, degrees, settings) {
  // Outer padding is partly for labels to use, allow encrouchment most of the way
  const distanceFromEdge = settings.svgDistanceFromEdge / 4

  const radians = LineCoordinates.degreesToRadians(90 - degrees)
  const adjacentLength = settings.svgHeight - distanceFromEdge - y1
  const hypotenuseLength = adjacentLength / Math.cos(radians)
  return hypotenuseLength
}

function getLengthToSide (x1, y1, degrees, settings) {
  // Outer padding is partly for labels to use, allow a little encrouchment
  const distanceFromEdge = settings.svgDistanceFromEdge / 2

  // Ensure degrees range is between -180 and 180
  degrees = LineCoordinates.enforceDegreesRange(degrees)
  let radians
  let adjacentLength

  if (degrees > 90 || degrees < -90) {
    // Test against left side edge
    radians = LineCoordinates.degreesToRadians(180 - degrees)
    adjacentLength = x1 - distanceFromEdge
  } else {
    // Test against right side edge
    radians = LineCoordinates.degreesToRadians(degrees)
    adjacentLength = settings.svgWidth - distanceFromEdge - x1
  }
  const hypotenuseLength = adjacentLength / Math.cos(radians)
  return hypotenuseLength
}

function labelRotation (degrees) {
  // Prevent text from being displayed upside down
  if (degrees > 90) return degrees -= 180
  if (degrees < -90) return degrees += 180
  return degrees
}

function trimText (d3Text, maxLength, reps = 0) {
  d3Text.classed('hidden', false)

  const width = d3Text.node().getBBox().width
  const textString = d3Text.text()

  if (width > maxLength) {
    const decimal = maxLength / width
    const trimToLength = Math.floor(textString.length * decimal) - 2

    if (trimToLength > 1 && reps < 5) {
      reps++ // Limit recursion in case unusual characters e.g. diacritics cause infinite loop
      const ellipsisChar = '…'
      const newText = textString.slice(0, trimToLength) + ellipsisChar
      d3Text.text(newText)
      // Check new text fits - won't if early chars are wider than later chars, e.g. 'Mmmmmm!!!!!!'
      return (trimText(d3Text, maxLength, reps))
    }
    d3Text.text('')
    return ''
  }
  return textString
}

function formatTimeLabel (num) {
  // format as 2 significant figures, with ms or s units
  const hairSpace = ' ' // &hairsp; unicode char, SVG doesn't like it as a HTML entity
  if (num > 1000) {
    return `${parseFloat((num / 1000).toPrecision(2))}${hairSpace}s`
  } else {
    return `${parseFloat(num.toPrecision(2))}${hairSpace}ms`
  }

}

module.exports = SvgNodeDiagram

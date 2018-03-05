'use strict'

class Scale {
  constructor (data, settings = {}) {
    const defaultSettings = {
      lineWidth: 2.5,
      labelMinimumSpace: 14
    }
    this.settings = Object.assign(defaultSettings, settings)
  }

  setScale (data) {
    // Called after new Scale() because it reads stem length data based on logic
    // using the spacing/width settings and radiusFromCircumference()

    this.scale = 1 // To be replaced with autoscaling logic based on stem length data.
  }

  getLineLength (dataValue) {
    return dataValue * this.scale
  }

  getCircleRadius (dataValue) {
    const equivalentLineLength = this.getLineLength(dataValue)
    return Scale.radiusFromCircumference(equivalentLineLength)
  }

  static radiusFromCircumference (circumference) {
    // Each pixel of colour must represent the same amount of time, else
    // the dataviz is misleading. So, circles representing delays within a
    // node are stroked, not filled, and data is linked to circumference,
    // not area, so lines and circles are equivalent
    return circumference / (2 * Math.PI)
  }
}

module.exports = Scale

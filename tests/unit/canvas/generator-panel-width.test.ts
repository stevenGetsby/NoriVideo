import { describe, expect, it } from 'vitest'
import {
  CANVAS_GENERATOR_PANEL_WIDTH_DEFAULT,
  clampCanvasGeneratorPanelWidth,
  resizeCanvasGeneratorPanelWidth,
} from '@/features/canvas/generator-panel-width'

describe('canvas generator panel width', () => {
  it('restores a bounded desktop width and remains usable on small screens', () => {
    expect(clampCanvasGeneratorPanelWidth(undefined, 1_440)).toBe(CANVAS_GENERATOR_PANEL_WIDTH_DEFAULT)
    expect(clampCanvasGeneratorPanelWidth(null, 1_440)).toBe(CANVAS_GENERATOR_PANEL_WIDTH_DEFAULT)
    expect(clampCanvasGeneratorPanelWidth(2_000, 1_440)).toBe(1_280)
    expect(clampCanvasGeneratorPanelWidth(100, 1_440)).toBe(360)
    expect(clampCanvasGeneratorPanelWidth(840, 390)).toBe(358)
  })

  it('resizes around the node-anchored panel center', () => {
    expect(resizeCanvasGeneratorPanelWidth({
      startWidth: 920,
      startClientX: 900,
      clientX: 980,
      viewportWidth: 1_440,
    })).toBe(1_080)
    expect(resizeCanvasGeneratorPanelWidth({
      startWidth: 920,
      startClientX: 900,
      clientX: 700,
      viewportWidth: 1_440,
    })).toBe(520)
    expect(resizeCanvasGeneratorPanelWidth({
      startWidth: 560, startClientX: 900, clientX: 960, viewportWidth: 1_000, interfaceScale: 1.2,
    })).toBe(660)
  })
})

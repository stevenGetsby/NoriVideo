import type { HomeCopy } from './home-copy'

function CanvasDiagram({ copy }: { copy: HomeCopy }) {
  return <div className="lm-canvas-diagram" aria-hidden="true"><svg viewBox="0 0 400 250" preserveAspectRatio="none"><path className="lm-wire lm-wire-a" d="M80 180C140 180 120 90 200 90" /><path className="lm-wire lm-wire-b" d="M200 90C270 90 240 45 320 45" /><circle className="lm-wire-dot" cx="200" cy="90" r="4" /></svg><div className="lm-mini-node lm-mini-text"><i />{copy.nodes[0]}</div><div className="lm-mini-node lm-mini-image"><i />{copy.nodes[1]}</div><div className="lm-mini-node lm-mini-video"><i />{copy.nodes[2]}<b>▶</b></div></div>
}
function StoryboardDiagram() {
  return <div className="lm-storyboard-diagram" aria-hidden="true"><div>{[0, 1, 2].map((i) => <i key={i} style={{ '--n': i } as React.CSSProperties} />)}</div><div>{[0, 1, 2].map((i) => <i key={i} style={{ '--n': i } as React.CSSProperties} />)}</div></div>
}
function AvatarsDiagram() {
  return <div className="lm-avatars" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ '--n': i } as React.CSSProperties}><b /></i>)}</div>
}
function PolishDiagram() {
  return <div className="lm-polish" aria-hidden="true"><div className="lm-pixel-scene">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ '--n': i } as React.CSSProperties} />)}</div><i className="lm-polish-scan" /></div>
}
function StageDiagram() {
  return <div className="lm-stage" aria-hidden="true"><div className="lm-cube">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div><svg viewBox="0 0 100 100"><path id="lm-camera-arc" d="M15 75a40 40 0 0 1 70 0" fill="none" /><g className="lm-camera"><path d="M-9-6h12v12H-9zM3-3l7-4v14L3 3z" fill="currentColor" /></g></svg></div>
}
function InteractiveDiagram() {
  return <div className="lm-interactive" aria-hidden="true"><i className="lm-interactive-start" /><svg viewBox="0 0 180 100"><path className="lm-branch lm-branch-a" d="M10 50C60 50 50 22 100 22" /><path className="lm-branch lm-branch-b" d="M10 50C60 50 50 78 100 78" /></svg><span className="lm-choice lm-choice-a">A</span><span className="lm-choice lm-choice-b">B</span></div>
}

export function HomeBento({ copy }: { copy: HomeCopy }) {
  const diagrams = [<CanvasDiagram copy={copy} />, <StoryboardDiagram />, <AvatarsDiagram />, <PolishDiagram />, <StageDiagram />, <InteractiveDiagram />]
  return <section id="canvas" className="lm-bento" data-ch="03" aria-labelledby="lm-canvas-title"><div className="lm-section-inner"><div className="lm-section-heading"><p className="lm-section-eyebrow" data-lm-reveal>{copy.canvasEyebrow}</p><h2 id="lm-canvas-title" data-lm-reveal style={{ '--d': '80ms' } as React.CSSProperties}>{copy.canvasTitle}</h2><p data-lm-reveal style={{ '--d': '160ms' } as React.CSSProperties}>{copy.canvasDescription}</p></div><div className="lm-bento-grid">{copy.bento.map((item, i) => <article key={item.label} className={`lm-bento-card lm-bento-${String.fromCharCode(97 + i)}`} data-lm-reveal style={{ '--d': `${240 + i * 70}ms` } as React.CSSProperties}><div className="lm-bento-art">{diagrams[i]}</div><span className="lm-bento-label">{item.label}</span><h3>{item.title}</h3></article>)}</div></div></section>
}

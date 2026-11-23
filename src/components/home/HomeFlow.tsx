import type { HomeCopy } from './home-copy'
import { HOME_CHANNEL_COLORS, HomeScene } from './HomeScenes'

export function HomeFlow({ copy }: { copy: HomeCopy }) {
  return <section id="flow" className="lm-flow" data-ch="02" aria-labelledby="lm-flow-title">
    <div className="lm-section-inner"><div className="lm-section-heading"><p className="lm-section-eyebrow" data-lm-reveal>{copy.flowEyebrow}</p><h2 id="lm-flow-title" data-lm-reveal style={{ '--d': '80ms' } as React.CSSProperties}>{copy.flowTitle}</h2><p data-lm-reveal style={{ '--d': '160ms' } as React.CSSProperties}>{copy.flowDescription}</p></div>
    <div className="lm-flow-stage" data-lm-reveal><div className="lm-ball-track" aria-hidden="true"><div className="lm-ball-x"><i className="lm-ball" /></div></div><div className="lm-flow-grid">{copy.flowCards.map((card, i) => <article className="lm-flow-card" key={card.title} data-lm-reveal style={{ '--i': i, '--d': `${240 + i * 70}ms`, '--lm-ch-color': HOME_CHANNEL_COLORS[i] } as React.CSSProperties}><i className="lm-flow-accent" aria-hidden="true" /><div className="lm-flow-scene"><HomeScene index={i} playing /></div><span className="lm-flow-number">{copy.channelCodes[i].replace('CH ', '')} {copy.channelNames[i]}</span><h3>{card.title}</h3><p>{card.description}</p></article>)}</div></div>
    </div>
  </section>
}

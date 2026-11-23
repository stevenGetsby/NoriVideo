export const HOME_CHANNEL_COLORS = ['#6E7BFF', '#9B6BFF', '#FF5FA2', '#3DD6F5'] as const

function AssetGlyph({ index }: { index: number }) {
  if (index < 2) return <><circle cx="12" cy="8" r="3.5" /><rect x="6.5" y="14" width="11" height="7" rx="3.5" /></>
  if (index < 4) return <><path d="m2 20 6-10 5 10Z" /><path d="m10 20 5-8 7 8Z" /></>
  if (index === 4) return <path d="m12 2 2.8 6.2 6.7.8-5 4.6 1.4 6.7-5.9-3.4-5.9 3.4 1.4-6.7-5-4.6 6.7-.8Z" />
  return <><path d="m12 2 9 5v10l-9 5-9-5V7Z" /><path d="m3 7 9 5 9-5M12 12v10" fill="none" stroke="currentColor" strokeWidth="1.5" /></>
}

export function HomeScene({ index, playing = true }: { index: number; playing?: boolean }) {
  return <div className={`lm-scene lm-scene-${index}${playing ? ' is-playing' : ''}`} aria-hidden="true">
    {index === 0 ? <><span className="lm-scene-tag">SCENE 1</span><div className="lm-script-lines">{['78%', '64%', '82%', '46%', '58%'].map((width, i) => <i key={width} style={{ '--w': width, '--n': i } as React.CSSProperties} />)}{<b className="lm-cursor" />}</div></> : null}
    {index === 1 ? <div className="lm-assets">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`lm-asset lm-asset-${i}`} style={{ '--n': i } as React.CSSProperties}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><AssetGlyph index={i} /></svg></div>)}</div> : null}
    {index === 2 ? <><div className="lm-rec"><i />REC</div><div className="lm-film">{[0, 1, 2].map((i) => <div className={`lm-film-frame lm-film-frame-${i}`} key={i}><i /></div>)}</div><div className="lm-viewfinder"><i /><i /><i /><i /><b /></div></> : null}
    {index === 3 ? <><i className="lm-sun" /><i className="lm-hill lm-hill-a" /><i className="lm-hill lm-hill-b" /><span className="lm-play"><i /><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6Z" fill="currentColor" /></svg></span><i className="lm-film-progress" /></> : null}
  </div>
}

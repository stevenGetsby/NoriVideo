export function HomeHeadline({ lines, label, english = false }: { lines: readonly [string, string]; label: string; english?: boolean }) {
  let index = 0
  const renderLine = (line: string) => {
    const words = english ? line.split(' ') : Array.from(line)
    return words.map((word, wordIndex) => {
      const element = <span key={`${word}-${wordIndex}`} className={`lm-ch${word === '跃' || word === 'leap' ? ' lm-ch-leap' : ''}`} style={{ '--i': index++ } as React.CSSProperties} aria-hidden="true">{word}{english && wordIndex < words.length - 1 ? ' ' : ''}</span>
      return element
    })
  }
  return <h1 id="lm-hero-title" className="lm-headline" aria-label={label}><span className="lm-headline-line">{renderLine(lines[0])}</span><span className="lm-headline-line">{renderLine(lines[1])}</span></h1>
}

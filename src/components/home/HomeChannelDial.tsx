import type { HomeCopy } from './home-copy'

export function HomeChannelDial({ copy }: { copy: HomeCopy }) {
  return <nav className="lm-channel-dial" aria-label="LanmiaoTV">{['top', 'flow', 'canvas', 'start'].map((id, i) => <a key={id} href={`#${id}`} className={`lm-dial-${i + 1}`}><i /><span>{String(i + 1).padStart(2, '0')}</span><b>{copy.dial[i]}</b></a>)}</nav>
}

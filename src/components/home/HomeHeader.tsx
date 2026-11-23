import { NoriBrandMark } from '@/components/brand/NoriBrandMark'
import { Link } from '@/i18n/navigation'
import type { HomeCopy } from './home-copy'
import type { HomeEnter } from './useHomeMotion'
import { useHeaderScroll } from './useHomeMotion'

export function HomeHeader({ copy, enter }: { copy: HomeCopy; enter: HomeEnter }) {
  const ref = useHeaderScroll()
  return <header ref={ref} className="lm-header">
    <div className="lm-header-inner">
      <a className="lm-brand" href="#top" aria-label="LanmiaoTV"><NoriBrandMark size={34} /><span>LanMiao<b>TV</b></span><sup>STUDIO</sup></a>
      <nav className="lm-nav" aria-label="LanmiaoTV"><a href="#flow">{copy.flow}</a><a href="#canvas">{copy.canvas}</a><a href="#start">{copy.start}</a></nav>
      <Link className="lm-signin" href={{ pathname: '/auth/signin' }} data-lm-enter data-testid="home-signin" {...enter}>{copy.signin}</Link>
    </div>
  </header>
}

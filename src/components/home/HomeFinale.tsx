import { ArrowUpRight } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import type { HomeCopy } from './home-copy'
import { HomeCat } from './HomeCat'
import type { HomeEnter } from './useHomeMotion'

export function HomeFinale({ copy, enter }: { copy: HomeCopy; enter: HomeEnter }) {
  return <section id="start" className="lm-finale" data-ch="04" aria-labelledby="lm-start-title"><div className="lm-ambient" aria-hidden="true"><i /><i /><i /></div><i className="lm-rays" aria-hidden="true" /><div className="lm-finale-inner"><p className="lm-section-eyebrow" data-lm-reveal>{copy.finaleEyebrow}</p><h2 id="lm-start-title" data-lm-reveal>{copy.finaleTitle}</h2><div className="lm-finale-stage" data-lm-reveal><HomeCat copy={copy} finale /><div className="lm-finale-card"><Link className="lm-button lm-button-primary" href={{ pathname: '/auth/signin' }} data-lm-enter data-testid="home-enter-final" {...enter}>{copy.finaleEnter}<ArrowUpRight size={20} /></Link><p>{copy.registration}</p></div></div></div></section>
}

export function HomeFooter({ copy, icp }: { copy: HomeCopy; icp: string | null }) {
  return <footer className="lm-footer"><span>© {new Date().getFullYear()} LanmiaoTV{icp ? <> · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" data-testid="home-icp">{icp}</a></> : null}</span><span>{copy.footer}</span></footer>
}

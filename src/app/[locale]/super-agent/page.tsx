import { redirect } from '@/i18n/navigation'
import { getLocale } from 'next-intl/server'
import { AUTHENTICATED_HOME_PATHNAME } from '@/lib/home/default-route'

export default async function SuperAgentPage() {
  const locale = await getLocale()
  redirect({ href: AUTHENTICATED_HOME_PATHNAME, locale })
}

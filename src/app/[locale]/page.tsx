import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { AUTHENTICATED_HOME_PATHNAME } from '@/lib/home/default-route'

export default async function Home() {
  const locale = await getLocale()

  redirect({ href: AUTHENTICATED_HOME_PATHNAME, locale })
}

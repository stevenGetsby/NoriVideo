import type { Metadata } from "next";
import Script from "next/script";
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import "../globals.css";
import { Providers } from "./providers";

import { locales } from '@/i18n/routing';
import { BRAND_ASSETS } from '@/lib/brand';



type SupportedLocale = (typeof locales)[number]

export const dynamic = 'force-dynamic'

// 动态元数据生成
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const theme = (await cookies()).get('nori-theme')?.value
    const t = await getTranslations({ locale, namespace: 'layout' })

    return {
        title: t('title'),
        description: t('description'),
        themeColor: theme === 'light' || theme === 'system' ? '#f5f6fa' : '#0d0d0d',
        icons: {
            icon: [{ url: BRAND_ASSETS.icon, type: 'image/png', sizes: '128x128' }],
            shortcut: BRAND_ASSETS.icon,
            apple: [{ url: BRAND_ASSETS.apple, type: 'image/png', sizes: '180x180' }],
        },
    };
}

export function generateStaticParams() {
    return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;

    // 验证 locale 是否有效
    if (!locales.includes(locale as SupportedLocale)) {
        notFound();
    }

    // 获取翻译消息
    const messages = await getMessages();
    const preference = (await cookies()).get('nori-theme')?.value
    const themePreference = preference === 'light' || preference === 'system' ? preference : 'dark'

    return (
        <html lang={locale} data-nori-theme={themePreference === 'light' ? 'light' : 'dark'} data-nori-theme-pref={themePreference} suppressHydrationWarning>
            <head>
                <Script id="nori-env-flags" strategy="beforeInteractive">{`
                  (function () {
                    try {
                      var m = /Chrome\\/(\\d+)/.exec(navigator.userAgent);
                      var v = m ? +m[1] : 0;
                      var d = document.documentElement;
                      if (v && v < 128 && !('currentCSSZoom' in Element.prototype)) d.setAttribute('data-zoom-mode', 'legacy');
                      if (v && v < 128) d.setAttribute('data-engine-version', String(v));
                      if (/Trident\\/|MSIE /.test(navigator.userAgent)) d.setAttribute('data-engine-version', '0');
                      if (d.getAttribute('data-nori-theme-pref') === 'system') d.setAttribute('data-nori-theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
                    } catch (e) {}
                  })();
                `}</Script>
                {process.env.NODE_ENV === "development" && (
                    <Script
                        src="//unpkg.com/react-grab/dist/index.global.js"
                        crossOrigin="anonymous"
                        strategy="beforeInteractive"
                    />
                )}
            </head>
            <body
                className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
            >
                <NextIntlClientProvider messages={messages}>
                    <Providers>
                        {children}
                    </Providers>
                </NextIntlClientProvider>

            </body>
        </html>
    );
}

import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { locales, defaultLocale } from '@/i18n';
import {
    isAllowedAdminSurfaceApi,
    isApiPath,
    isPlatformAdminPage,
    authCookieNamespace,
    resolveAppSurface,
    resolveRequestSurface,
    stripSupportedLocale,
} from '@/lib/app-surface';

const handleI18nRouting = createMiddleware({
    // 支持的所有语言
    locales,

    // 默认语言
    defaultLocale,

    // URL 路径策略: 始终显示语言前缀
    localePrefix: 'always',

    // 关闭自动语言检测，避免无前缀跳转触发语言漂移
    localeDetection: false
});

function platformAdminUrl(request: NextRequest, pathname?: string): URL {
    const { locale } = stripSupportedLocale(request.nextUrl.pathname);
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const requestHost = request.headers.get('host')?.trim();
    const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProtocol === 'https' ? 'https' : 'http';
    const externalHost = forwardedHost || requestHost || request.nextUrl.host;
    let target: URL;
    try {
        target = new URL(`${protocol}://${externalHost}`);
    } catch {
        target = new URL(request.url);
    }
    target.port = process.env.ADMIN_PUBLIC_PORT || '8080';
    target.pathname = pathname || `/${locale}/admin/signin`;
    target.search = '';
    target.hash = '';
    return target;
}

export default async function middleware(request: NextRequest) {
    const surface = resolveRequestSurface({
        host: request.headers.get('host'),
        forwardedHost: request.headers.get('x-forwarded-host'),
        forwardedPort: request.headers.get('x-forwarded-port'),
        urlPort: request.nextUrl.port,
    }, process.env.ADMIN_PUBLIC_PORT || '8080');
    const pathname = request.nextUrl.pathname;
    const { locale, pathname: route } = stripSupportedLocale(pathname);
    const secureCookies = (process.env.NEXTAUTH_URL || '').startsWith('https://');
    const token = await getToken({
        req: request,
        cookieName: `${secureCookies ? '__Secure-' : ''}${authCookieNamespace(resolveAppSurface())}.session-token`,
        secureCookie: secureCookies,
    });

    if (surface === 'admin') {
        if (isApiPath(pathname)) {
            if (isAllowedAdminSurfaceApi(pathname)) return NextResponse.next();
            return NextResponse.json({ error: 'Not found on the admin service.' }, { status: 404 });
        }
        if (route === '/auth/change-password' && token?.passwordChangeRequired === true) {
            return handleI18nRouting(request);
        }
        if (route === '/auth/change-password') {
            return NextResponse.redirect(platformAdminUrl(
                request,
                token?.id ? `/${locale}/admin/accounts` : `/${locale}/admin/signin`,
            ));
        }
        return handleI18nRouting(request);
    }

    if (isPlatformAdminPage(pathname)) {
        const { locale, pathname: route } = stripSupportedLocale(pathname);
        const targetPath = route === '/admin'
            ? `/${locale}/admin/signin`
            : `/${locale}${route}`;
        return NextResponse.redirect(platformAdminUrl(request, targetPath));
    }

    if (isApiPath(pathname)) return NextResponse.next();

    if (route === '/auth/change-password' && token?.id && token.passwordChangeRequired !== true) {
        return handleI18nRouting(request);
    }

    if (token?.passwordChangeRequired === true && route !== '/auth/change-password') {
        return NextResponse.redirect(new URL(`/${locale}/auth/change-password`, request.url));
    }
    return handleI18nRouting(request);
}

export const config = {
    // API 也进入中间件，以便独立 Admin 端口拒绝生产接口。
    matcher: [
        // 匹配根路径和所有带语言前缀的路径
        '/',
        '/(zh|en)/:path*',
        // 匹配所有其他路径（用于重定向到带语言前缀的路径）
        '/((?!m|_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.gif|.*\\.ico|.*\\.webp|.*\\.webm|.*\\.mp4|.*\\.mov).*)'
    ]
};

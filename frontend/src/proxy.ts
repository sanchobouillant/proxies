import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export default function proxy(request: NextRequest) {
    // Check for auth_token cookie
    const token = request.cookies.get('auth_token');
    const { pathname } = request.nextUrl;

    // Paths that do not require auth
    // Note: 'proxy' runs before everything, so we must be careful not to loop
    const publicPaths = ['/login', '/api/auth/login', '/_next', '/static', '/favicon.ico'];

    // If static asset or public path, continue
    if (publicPaths.some(path => pathname.startsWith(path))) {
        return NextResponse.next();
    }

    if (!token) {
        // Redirect to login if not authenticated
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes) -> We might want to protect API too, but let's handle them carefully.
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};

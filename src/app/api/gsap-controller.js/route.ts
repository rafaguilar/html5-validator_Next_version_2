
import { getGsapControllerScript } from '@/lib/gsap-controller';
import { NextRequest, NextResponse } from 'next/server';

// This new route serves the controller script directly.
// Caching headers are set to ensure the browser doesn't keep an old version.
export async function GET(request: NextRequest) {
    try {
        const scriptContent = await getGsapControllerScript();
        return new NextResponse(scriptContent, {
            status: 200,
            headers: {
                'Content-Type': 'application/javascript',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            }
        });
    } catch (error) {
        console.error('[API/gsap-controller] Failed to serve controller script:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}

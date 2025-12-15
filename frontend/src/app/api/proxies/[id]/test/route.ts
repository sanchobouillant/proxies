
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import axios from 'axios';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const id = params.id;

    try {
        const proxy = await prisma.proxy.findUnique({
            where: { id }
        });

        if (!proxy) {
            return NextResponse.json({ error: 'Proxy not found' }, { status: 404 });
        }

        const isSocks = proxy.protocol === 'SOCKS5';
        const proxyUrl = isSocks
            ? `socks5://${proxy.authUser ? `${proxy.authUser}:${proxy.authPass}@` : ''}127.0.0.1:${proxy.port}`
            : `http://${proxy.authUser ? `${proxy.authUser}:${proxy.authPass}@` : ''}127.0.0.1:${proxy.port}`;

        const agent = isSocks
            ? new SocksProxyAgent(proxyUrl)
            : new HttpsProxyAgent(proxyUrl);

        console.log(`Testing proxy ${proxy.name} via ${proxyUrl} (masked auth)`);

        const start = Date.now();
        const response = await axios.get('https://ifconfig.me/ip', {
            httpAgent: agent,
            httpsAgent: agent,
            timeout: 10000 // 10s timeout
        });
        const duration = Date.now() - start;

        return NextResponse.json({
            success: true,
            ip: response.data.trim(),
            duration
        });

    } catch (error: any) {
        console.error('Proxy test failed:', error.message);
        return NextResponse.json({
            success: false,
            error: error.message || 'Connection failed'
        }, { status: 500 });
    }
}

import http from 'node:http';
import net from 'node:net';
import { networkInterfaces } from 'node:os';

/**
 * Route real-Chrome egress through a specific local source IP (e.g. the iPhone USB tether
 * 172.20.10.x → Telemach mobile IP) WITHOUT touching the Mac's default route.
 *
 * Chrome can't bind a source address itself, so we run a tiny in-process HTTP CONNECT proxy
 * whose upstream sockets are bound to `sourceAddr`. Point Chrome at it via the `proxy` launch
 * option and all its HTTPS traffic egresses through that interface. Mirrors the `--via-iphone`
 * source-address trick from domovina-api's run_pipeline.sh (which binds yt-dlp's socket).
 */

/** Find an active Apple Personal Hotspot tether IP (always 172.20.10.2–14). */
export function detectIphoneSource(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && ni.address.startsWith('172.20.10.') && !ni.internal) {
        return ni.address;
      }
    }
  }
  return undefined;
}

export interface SourceProxy {
  port: number;
  sourceAddr: string;
  close: () => void;
}

export function startSourceProxy(sourceAddr: string): Promise<SourceProxy> {
  const server = http.createServer((_req, res) => {
    res.writeHead(405).end();
  });

  server.on('connect', (req, clientSocket, head) => {
    const [host, portStr] = (req.url ?? '').split(':');
    const port = Number(portStr) || 443;
    const upstream = net.connect({ host, port, localAddress: sourceAddr }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ port: addr.port, sourceAddr, close: () => server.close() });
    });
  });
}

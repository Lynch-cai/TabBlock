// Static server for the e2e pages. Reached as http://localhost:4517 (the "protected"
// streaming site) and http://127.0.0.1:4517 (the "other" site): same server, two hostnames.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.join(import.meta.dirname, 'pages');

http
  .createServer(async (req, res) => {
    const file = path.join(root, path.normalize(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  })
  .listen(4517);

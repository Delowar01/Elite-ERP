// PO-07 CI only: a header-echo backend on a Unix socket. It answers every request with the request headers it received,
// as JSON {lower-case name: [values in order]}, so the rehearsal sees exactly what nginx passes to an application.
//   node echo-headers.mjs <socket path>
import http from "node:http";
import fs from "node:fs";

const sock = process.argv[2];
try { fs.unlinkSync(sock); } catch { /* absent */ }
http.createServer((req, res) => {
  const h = {};
  for (let i = 0; i < req.rawHeaders.length; i += 2) (h[req.rawHeaders[i].toLowerCase()] ??= []).push(req.rawHeaders[i + 1]);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(h));
}).listen(sock, () => fs.chmodSync(sock, 0o600));

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function safePath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.normalize(path.join(ROOT_DIR, requested));
  if (!filePath.startsWith(ROOT_DIR)) return null;
  return filePath;
}

const server = http.createServer((request, response) => {
  const filePath = safePath(request.url || "/");
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": TYPES[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(content);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Message Choose listening at http://${HOST}:${PORT}/`);
});

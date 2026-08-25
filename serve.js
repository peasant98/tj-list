// tiny static server for TJ's Run — node serve.js → http://localhost:8519
var http = require('http'), fs = require('fs'), path = require('path');
var MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json'
};
http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p === '/') p = '/index.html';
  var f = path.join(__dirname, p);
  if (f.indexOf(__dirname) !== 0) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8519, function () { console.log('TJ\'s Run → http://localhost:8519'); });

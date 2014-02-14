var util = require('util');
var miniHTTP = require('./miniHTTP');
var miniExpress = require('./miniExpress');

function runExpress() {
    var app = miniExpress();
    app.use(miniExpress.static('www'));
    var server = miniHTTP.createServer(app);
    server.listen(8080);
    process.once('SIGINT', function () {
        server.close(function () {
            process.exit(0);
        });
    });
}

function runHTTP() {
    var msg = 'Hello, world!';
    var server = miniHTTP.createServer(function (req, res) {
        //console.log(util.inspect(res));
        res.setHeader('content-length', msg.length);
        res.write(msg, 'utf8');
        res.end();
    });
    server.listen(8080);
    process.once('SIGINT', function () {
        server.close(function () {
            process.exit(0);
        });
    });
}

runExpress();

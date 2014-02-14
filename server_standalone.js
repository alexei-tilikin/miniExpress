/* Standalone script for running miniExpress server in child process.
 * Receives commands from the parent process and sends ACKs when command done.
 * Used in load.js
 */
var miniExpress = require('./miniExpress');
var server;

function run() {
    var app = miniExpress();
    app.use('/', miniExpress.static('www'));
    server = app.listen(8080, function () {
        process.send('started');
    });
}

function close() {
    if (server) {
        server.close(function () {
            process.send('stopped');
        });
    } else {
        process.send('stopped');
    }
}

//listening for process messages
process.on('message', function (msg) {
    if (msg === 'start') {
        run();
    } else if (msg === 'stop') {
        close();
    }
});
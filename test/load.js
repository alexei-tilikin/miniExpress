/* Load test for miniExpress application.
 * See some explanation in readme.txt
 */
var TestTool = require('./testTool');
var fs = require('fs');
//running server app in separate process
var server = require('child_process').fork('server_standalone.js');
var util = require('util');

var NUM_CLIENTS = 3000; //number of clients to connect to the server
var logFile = 'testLoad.log'; //path to generated log file

/**
 * Load test for server application.
 * Tries to send NUM_CLIENTS requests.
 * Waits to get response 200 from each one.
 * At the end of this test, logFile generated with critical data:
 * *Number of concurrently open client sockets (runtime statistics).
 * *Total number of clients that had error (at the bottom line).
 */
function testLoad() {
    var req = ['GET /index.html HTTP/1.1',
        'host: localhost:8080',
        'connection: close',
        '\r\n'].join('\r\n');

    //runtime statistics
    var openSockets = 0; //number of currently open client sockets
    var clientsDone = 0; //number of clients that received 'end' event
    var errors = 0; //number of clients that got error response

    var testCase = new TestTool.TestCase(this, 'testLoad_'.concat(NUM_CLIENTS));
    //this === socket
    testCase.onTCPConnected = function () {
        openSockets++;
        testLog.write(['Open sockets: ', openSockets, '\r\n'].join(''));
        this.buff = '';
        this.write(req);
    };

    //this === socket
    testCase.onTCPData = function (data) {
        this.buff = this.buff.concat(data);
        var statusEnd = this.buff.indexOf('\r\n');
        if (statusEnd < 0) return;
        //request line received
        this.removeAllListeners('data'); //drop incoming data
        this.buff = this.buff.toLowerCase();
        if (this.buff.indexOf('200 ok\r\n') < 0) { //not OK response
            errors++;
            clientsDone++;
            testLog.write(['Error, status line: ',
                this.buff.substr(0, statusEnd), '\r\n'].join(''));
            this.end();
        } else {
            this.responseReceived = true;
        }
    };

    function socketDone() {
        clientsDone++;
        if (clientsDone === NUM_CLIENTS) {
            try {
              if (server.connected) {server.send('stop');}
            } catch(err) {
                testLog.write(['Error on IPC with server process: ',
                    err, '\r\n'].join(''));
                finalize();
            }
        }
    }

    testCase.onResponseEnd = function (socket) {
        if (socket.responseReceived !== true) {
            errors++;
            testLog.write('Error: Response not arrived!\r\n');
        }
        openSockets--;
        socketDone();
    };

    testCase.onError = function (err, socket) {
        errors++;
        testLog.write([err, '\r\n'].join(''));
        if (err.code != 'EMFILE') {openSockets--;} //socket not opened
        socketDone();
    };

    /* The bottom line.
     * Closing the log file.
     */
    function finalize() {
        if (testCase.finalize_flag) return;
        testCase.finalize_flag = true;
        testLog.end('Total errors: '.concat(errors));
        if (errors > 0) {
            testCase.test.emit('test_result', testCase.testName,
                'DONE with errors, see '.concat(logFile));
        } else {
            testCase.test.emit('test_result', testCase.testName, 'PASSED');
        }
    }

    server.on('message', function (msg) {
        if (msg === 'started') { //server launched, starting the clients
            for (var i = 0; i < NUM_CLIENTS; ++i) {
                testCase.requestTCP();
            }
        } else if (msg === 'stopped') {
            server.disconnect(); //allow the server process to exit
            finalize();
        }
    });

    //the logger stream
    var testLog = fs.createWriteStream(logFile);
    //starting here
    testLog.once('open', function () {
        try {
            server.send('start'); //launch the server
        } catch(err) {
            testLog.write(['Error on IPC with server process: ',
                err, '\r\n'].join(''));
            finalize();
        }
    }).once('error', function (err) {
        console.error(util.format('Writing to %s failed: %s', logFile, err));
    });
};

//the suite has single test
var suite = new TestTool.TestSuite();
suite.addTests([testLoad]);
suite.runAll();
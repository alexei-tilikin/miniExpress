/* The TestTool model.
 * Implements testing framework.
 * All test cases from tester.js based on this framework.
 */
var lib = {
    miniHTTP: require('../miniHTTP'),
    miniExpress: require('../miniExpress'),
    util: require('util'),
    http: require('http'),
    net: require('net'),
    EventEmitter: require('events').EventEmitter
};

module.exports = {
    TestCase: TestCase,
    TestSuite: TestSuite
};

/**
 * TestCase implements generic functionality for HTTP or TCP client with ability
 * to receive the response.
 * @param {TestSuite} suite current suite object.
 * @param {string} testName base name for current test.
 * @param {string} reqPath request path (direct setter).
 * @constructor
 */
function TestCase(suite, testName, reqPath) {
    this.test = suite;
    this.testName = testName;
    this.options = {
        hostname: 'localhost',
        port: 8080,
        method: 'GET',
        path: reqPath
    };
}

/**
 * Starts the tested server application with single static use to the specified
 * rootFolder.
 * @param {String} rootFolder the local root folder for server,
 * there all requests will be redirected.
 * @param {function} callback - callback that called once the server starts listening.
 */
TestCase.prototype.runServer = function (rootFolder, callback) {
    if (typeof(rootFolder) !== 'string') {
        throw new TypeError(
            lib.util.format('[%s].runServer() got non-string argument.', this.testName));
    }

    this.app = lib.miniExpress();
    this.app.use('/', lib.miniExpress.static(rootFolder));
    this.server = lib.miniHTTP.createServer(this.app);
    this.server.listen(this.options.port, callback);
};

/**
 * Default action for test success.
 * Should be called at the end of the test.
 * 'this' points to the TestCase instance.
 */
TestCase.prototype.success = function () {
    var testCase = this;
    if (testCase.emitted) {return;}
    testCase.emitted = true; //avoiding concurrent 'test_result' events
    testCase.server.close(function (err) {
        if (err) {
            testCase.test.emit('test_result', testCase.testName,
                'FAILED\r\n'.concat('server.close() raised ').concat(err));
        } else {
            testCase.test.emit('test_result', testCase.testName, 'PASSED');
        }
    });

};

/**
 * Called once 'error' event emitted (from any source).
 * 'this' points to the TestCase instance
 * @param {String} msg message to print in error log.
 * @param {net.Socket} current TCP socket. Passed only if called from requestTCP.
 */
TestCase.prototype.onError = function (msg, socket) {
    var testCase = this;
    if (testCase.emitted) {return;}
    testCase.emitted = true; //avoiding concurrent 'test_result' events
    var name = (testCase.hasOwnProperty('subTestName'))
        ? lib.util.format('%s: %s', testCase.testName, testCase.subTestName)
        : testCase.testName;
    testCase.server.close(function () {
        testCase.test.emit('test_result', name, 'FAILED\r\n'.concat(msg));
    });
};

/**
 * Called once HTTP response arrived.
 * 'this' points to the TestCase instance.
 * @param res the response object.
 * @param req HTTP request object that gave this response.
 */
TestCase.prototype.onResponse = function (res, req) {};

/**
 * Called once HTTP response object emits 'end' event,
 * or then TCP socket emits 'end' (form requestTCP).
 * 'this' points to the TestCase instance.
 * @param socket current socket passed when called from requestTCP.
 */
TestCase.prototype.onResponseEnd = TestCase.prototype.success;

/**
 * Called once HTTP response object emits 'readable' event.
 * 'this' points to response object.
 */
TestCase.prototype.readable = function () {
    this.read(); //default is to read and ignore
};

/**
 * HTTP client request with response awaiting.
 * @param body the body data for HTTP request.
 */
TestCase.prototype.requestHTTP = function (body) {
    var testCase = this;
    var req = lib.http.request(testCase.options, function (res) {
        testCase.onResponse(res, req);
        res.on('readable', function () {
            testCase.readable.call(res);
        }).once('error', function (err) {
                res.removeAllListeners('end');
                testCase.onError(err);
            }).once('end', function () {
                testCase.onResponseEnd();
            });
    }).once('error', function (err) {
            testCase.onError(err);
        });
    req.end(body);
};

/**
 * Called from requestTCP, once TCP socket emits 'data' event.
 * 'this' points to the socket.
 * @param data received data chunk.
 */
TestCase.prototype.onTCPData = function (data) {};

/**
 * Called on socket.connect event from requestTCP.
 * Usually that's the place to send the request data.
 * 'this' points to the socket.
 * @param sendData the data that scheduled to be sent.
 */
TestCase.prototype.onTCPConnected = function (sendData) {
    if (sendData) {
        this.write(sendData);
    }
};

/**
 * Called from requestTCP with current socket as argument.
 * Allows to define custom listeners/properties on socket.
 * 'this' points to the TestCase instance.
 * @param socket current socket.
 */
TestCase.prototype.setSocketProperties = function (socket) {};

/**
 * TCP client request with response awaiting.
 * @param sendData data to send to the server.
 */
TestCase.prototype.requestTCP = function (sendData) {
    var testCase = this;
    var socket = lib.net.connect(testCase.options.port,
        testCase.options.hostname, function () {
            testCase.onTCPConnected.call(socket, sendData);
        });
    socket.once('error', function (err) {
        socket.removeAllListeners('end');
        socket.end();
        testCase.onError(err, socket);
    }).on('data', function (data) {
            testCase.onTCPData.call(socket, data);
        }).once('end', function () {
            testCase.onResponseEnd(socket);
        }).once('close', function () {
            socket.destroy();
        });
    testCase.setSocketProperties(socket);
};

/**
 * Simple proposed callback for subtest success event.
 * Not called by default.
 * Can be defined instead success() when subtestLoop used.
 */
TestCase.prototype.subTestSuccess = function () {
    this.test.emit(this.testName);
};

/**
 * Setup phase on each subtest iteration, right before the subtest callback invoked.
 * Allows to define subtest-specific data.
 * @param {int} idx index of current subtest.
 */
TestCase.prototype.setSubtest = function (idx) {
    if (this.hasOwnProperty('paths')) {
        this.options.path = this.paths[idx];
    }
};

/**
 * Generic loop of subtests. Each subtest uses internal custom event to notify
 * termination. When all loop ended, then 'test_result' emitted.
 * Attention: onResponseEnd callback should be changed when using subtestLoop.
 * Default onResponseEnd will end the test after first subtest.
 * @param {Array} names of subtests. names.length determines number of iterations.
 * @param {boolean} isTCP if set true, then requestTCP will be used for iterations,
 * otherwise requestHTTP used.
 * @param {Array} sendData data to send on each iteration.
 * sendData[i] passed to iteration i.
 */
TestCase.prototype.subtestLoop = function (names, isTCP, sendData) {
    var testCase = this;
    var currTest = 0;
    var subtest = (isTCP) ? testCase.requestTCP : testCase.requestHTTP;

    testCase.test.on(testCase.testName, function () {
        if (currTest === names.length) {
            testCase.success();
            return;
        }
        testCase.subTestName = names[currTest];
        testCase.setSubtest(currTest);
        subtest.call(testCase, (sendData ? sendData[currTest] : undefined));
        currTest++;
    });

    testCase.test.emit(this.testName); //launch
};

/**
 * TestSuite instance gets list of tests, and runs them sequentially.
 * It assumes that each test is function, that emits 'test_result' from the current
 * instance of TestSuite, to indicate the test termination.
 * After each test, progress indication printed.
 * After all tests done, overall log printed.
 * @constructor
 */
function TestSuite() {
    this.tests = [];
}

lib.util.inherits(TestSuite, lib.EventEmitter);

/**
 * Adds list of tests to the schedule.
 * All added test cases will run in the order of addition.
 * @param {Array} tests array of functions, each function is test case that emits
 * 'test_result' upon termination.
 */
TestSuite.prototype.addTests = function (tests) {
    this.tests = this.tests.concat(tests);
}

/**
 * Runs all defined tests sequentially.
 * Displays test result output for each test once it terminates.
 */
TestSuite.prototype.runAll = function () {
    var suite = this;
    var currTest = 0;
    var msg = []; 

    if (suite.tests.length === 0) {
        console.log('No tests scheduled.');
        return;
    }
    try {
        suite.on('test_result', function (name, result) {
            msg.push(lib.util.format('Test [%s] : %s', name, result)); 
            console.log(lib.util.format('Test [%s] : Done.', name));
            if (suite.tests[currTest].hasOwnProperty('tearDown')) {
                var tearDown = suite.tests[currTest].tearDown;
                if (typeof(tearDown) === 'function') {
                    tearDown.call(suite);
                }
            }
            //next test
            currTest++;
            if (currTest < suite.tests.length) {
                suite.tests[currTest].call(suite);
            } else {
                console.log('\t\tAll tests done.');
                console.log(msg.join('\r\n'));
            }
        });

        suite.tests[currTest].call(suite); //first test
    } catch (err) {
        console.error('Unpredicted error: '.concat(err));
    }
};
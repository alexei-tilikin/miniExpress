var miniHTTP = require('../miniHTTP');
var miniExpress = require('../miniExpress');
var TestTool = require('./testTool');
var util = require('util');
var fs = require('fs');
var path = require('path');

///Path to the default rootFolder for server.
var ex2Path = path.resolve('www');

/**
 * Testing input validation on miniExpress.use(). <br/>
 * Validating: response 200 received, not crashed.<br/>
 * This test is simple and it should always pass.
 */
var testInputValidation = function () {
    var app = miniExpress();

    //invalid callbacks: callback is not a function
    app.use('/', [])
    .use('/', {})
    .use('');

    //valid callback: URL prefix defaults to '/', rootPath defaults to current path
    app.use(miniExpress.static());

    var testCase = new TestTool.TestCase(this, 'testInputValidation', '/www/index.html');

    testCase.onResponse = function (res, req) {
      if (res.statusCode != 200) {
          testCase.onError('Response code expected 200, got '.concat(res.statusCode));
      } else {
          testCase.success();
      }
    };

    testCase.onResponseEnd = function () {
        testCase.onError('Response not arrived!');
    };

    var server = miniHTTP.createServer(app);
    testCase.app = app;
    testCase.server = server;

    server.listen(8080, function () {
        testCase.requestHTTP();
    });
};

/**
 * Testing static use-mapping.<br/>
 * Validating that URL parsed as expected and response 200 arrived.
 */
var testUseStatic = function () {
    var cases = [
        ['/subdir1/subdir2/', ex2Path],
        ['/subdir3', '']
    ];
    var app = miniExpress();
    var testNames = [];

    for (var i = 0; i < cases.length; ++i) {
        app.use(cases[i][0], miniExpress.static(cases[i][1]));
        testNames.push(util.format('\'%s\' TO \'%s\'', cases[i][0], cases[i][1]));
    }

    var testCase = new TestTool.TestCase(this, 'testUseStatic');

    var paths = [
        '/subdir1/subdir2/index.html',
        '/subdir3/www/index.html'
    ];

    //this === response
    testCase.readable = function () {
        var data = this.read();
        if (testCase.responseArrived) return;
        if (this.statusCode != 200) {
            this.removeAllListeners('end');
            testCase.onError('Response code expected 200, got '
                .concat(this.statusCode));
        } else {
            testCase.responseArrived = true;
        }
    };

    testCase.onResponseEnd = function() {
        if (!testCase.responseArrived) {
            testCase.onError('Response not arrived');
        } else {
            testCase.subTestSuccess();
        }

    };

    testCase.setSubtest = function(idx) {
        testCase.responseArrived = false;
        this.options.path = paths[idx];
    };

    var server = miniHTTP.createServer(app);
    testCase.app = app;
    testCase.server = server;

    server.listen(8080, function () {
        testCase.subtestLoop(testNames);
    });
};

testUseStatic.tearDown = function () {
    this.removeAllListeners('testUseStatic');
};

/**
 * Testing chained use rules on the same path.<br/>
 * Creating chain of 4 rules, requesting for existing resource.<br/>
 * Validating: order of output from the callbacks, response status code.
 */
var testUseChain = function () {
    var test = this;
    var passState = ['First callback',
        'Second callback',
        'Response status: 200'].join('\r\n');
    var messages = [];

    var testCase = new TestTool.TestCase(this, 'testUseChain', '/files/static/index.html');

    var app = miniExpress();
    app.use('/files', function (req, res, next) {
        messages.push('First callback');
        next();
    }).get('/', function (req, res, next) {
        messages.push('Second callback');
        next();
    }).use('/files/static', miniExpress.static(ex2Path));

    //shall not be called
    app.use('/files/static', function (req, res) {
        messages.push('After send callback!');
    });

    testCase.server = app;

    testCase.onResponse = function (res) {
        messages.push('Response status: '.concat(res.statusCode));
    };

    testCase.onResponseEnd = function () {
        //validating output only after the server finally closed
        this.server.close(function () {
            var result = messages.join('\r\n');
            if (passState === result) {
                testCase.test.emit('test_result', testCase.testName, 'PASSED');
            } else {
                testCase.test.emit('test_result', testCase.testName,
                    util.format('GOT:\r\n%s\r\nEXPECTED:\r\n%s',
                        result, passState));
            }
        });
    };

    var server = miniHTTP.createServer(app);
    testCase.app = app;
    testCase.server = server;
    server.listen(8080, function () {
        testCase.requestHTTP();
    });
};

/**
 * Testing response formats support.<br/>
 * Also testing req.is().<br/>
 * Reading files of different formats from ex2 folder.
 * Requesting the same files from the server.<br/>
 * Validating: response status code, 'content-type' property on req.is(),
 * received response data, content-type on response.
 */
var testFormats = function () {
    var testCase = new TestTool.TestCase(this, 'testFormats');
    var paths = ['script.js', 'text.txt', 'img.jpg',
        'style.css', 'index.html', 'img.gif', 'img.png'];
    var formats = ['application/javascript', 'text/plain', 'image/jpeg',
        'text/css', 'text/html', 'image/gif', 'image/png'];
    var isQueries = ['application/*', 'text/plain', 'image/jpeg',
        'css', 'html', 'image/gif', 'png'];

    testCase.setSubtest = function (idx) {
        testCase.options.path = '/'.concat(paths[idx]);
        testCase.options.headers['content-type'] = formats[idx];
        testCase.filePath = path.resolve(ex2Path, paths[idx]);
        testCase.expectedFormat = formats[idx];
    };
    testCase.options.headers = {};


    testCase.onResponse = function (res, req) {
        if (res.statusCode != 200) {
            this.onError('Response code expected 200, got '.concat(res.statusCode));
            return;
        }
        if (res.headers['content-type'].toLowerCase()
                .indexOf(this.expectedFormat) < 0) {
            this.onError(util.format('Format expected: %s, got %s.',
               this.expectedFormat, res.headers['content-type']));
        }
    };

    var receivedData = [];
    testCase.readable = function () {
        receivedData.push(this.read());
    };

    testCase.onResponseEnd = function () {
        fs.readFile(testCase.filePath,
            function (err, localData) {
                if (err) {
                    testCase.onError(err);
                    return;
                }
                if (localData.toString() === receivedData.join('')) {
                    receivedData = [];
                    testCase.test.emit('testFormats'); //next subtest
                    return;
                }
                testCase.onError('Content not equal.');
            });
    };
    var app = miniExpress();

    var currReq = 0;
    //verifying req.is() on the server side
    app.use(function (req, res, next) {
        if (!req.is(isQueries[currReq])) {
            testCase.onError(
                util.format('req.is() failed. For path \'%s\' Query was \'%s\'.',
                    req.path, isQueries[currReq]));
        } else {
            currReq++;
            next();
        }
    });

    app.use(miniExpress.static(ex2Path));


    var server = miniHTTP.createServer(app);
    testCase.app = app;
    testCase.server = server;
    server.listen(8080, function () {
        testCase.subtestLoop(formats);
    });
};

testFormats.tearDown = function () {
    this.removeAllListeners('testFormats');
};

/**
 * Testing server behavior on request with body.<br/>
 * Validating: response code 200, content-length.
 */
var testRequestBody = function () {
    var body = ['Request body test',
    'This text will be received and dropped.',
    'Sane response 200 expected.'].join('\r\n');
    var expectedLength = 4096;


    var testCase = new TestTool.TestCase(this, 'testRequestBody', '/script.js');
    testCase.options.headers = {'content-length' : body.length};

    testCase.onResponse = function (res, req) {
        if (res.statusCode != '200') {
            testCase.onError('Response code expected 200 got '.concat(res.statusCode));
            return;
        }
        if (res.headers['content-length'] != expectedLength) {
            testCase.onError(util.format('Content-Length expected %d, received %s',
                expectedLength, res.headers['content-length']));
        }
    };

    testCase.runServer(ex2Path, function () {
        testCase.requestHTTP(body);
    });
};

/**
 * Testing connection persistence.<br/>
 * Using TCP client.<br/>
 * Validating: 'connection' property, socket state.<br/>
 * If connection isn't persistent, then socket expected to 'end' right after
 * response arrived.<br/>
 * On persistent connections, socket will 'end' after 2 seconds timeout.<br/>
 * Using 1 second timeout to differentiate between these two cases.<br/>
 * This test takes at least 4 seconds,
 * because persistent connections wait for socket timeout on the server side.
 */
var testPersistent = function () {
    var expLength = 4096 + 4; //expected length of CRLF + CRLF + body

    var reqFormat = 'GET /index.html HTTP/1.%d\r\nhost: localhost:8080\r\n%s';
    var req = [
        util.format(reqFormat, 1, '\r\n'),
        util.format(reqFormat, 1, 'connection: close\r\n\r\n'),
        util.format(reqFormat, 0, '\r\n'),
        util.format(reqFormat, 0, 'connection: keep-alive\r\n\r\n')
    ];
    var testNames = [
        'HTTP/1.1 no connection property',
        'HTTP/1.1 with connection:close',
        'HTTP/1.0 no connection property',
        'HTTP/1.0 with connection:keep-alive'
    ];
    var isPersistent = [true, false, false, true];

    var testCase = new TestTool.TestCase(this, 'testPersistent');

    testCase.setSubtest = function (idx) {
        testCase.isPersistent = isPersistent[idx];
        testCase.receivedFlag = false;
        testCase.timeoutFlag = false;
	testCase.rcvBytes = 0;
        testCase.buff = ''; //only the header
	testCase.headerDone = false;
    };

    //this === socket
    testCase.onTCPData = function (data) {
	data = new Buffer(data);
	testCase.rcvBytes += data.length;
	if (!testCase.headerDone) { //reading the header
	  testCase.buff = testCase.buff.concat(data.toString());
	  var bodyStart = testCase.buff.indexOf('\r\n\r\n');
	  if (bodyStart > 0) {
	      testCase.headerDone = true;
	      testCase.buff = testCase.buff.substr(0, bodyStart).toLowerCase();
	  } else { //header not yet received
	      return;
	  }
	}
        //wait until the whole message received
        if (testCase.rcvBytes < testCase.buff.length + expLength) {
	    return;
	} else if (testCase.rcvBytes > testCase.buff.length + expLength) {
	    this.removeAllListeners('end');
            this.end();
            testCase.onError('Response message too long.');
            return;
	}
        
        var expectedProp = (testCase.isPersistent)
            ? '\r\nconnection: keep-alive\r\n'
            : '\r\nconnection: close\r\n';
        if (testCase.buff.indexOf(expectedProp) < 0) {
            this.removeAllListeners('end');
            this.end();
            testCase.onError('Wrong \'connection\' property:\r\n'
                .concat(testCase.buff));
            return;
        }
        testCase.receivedFlag = true;
    };

    testCase.onResponseEnd = function () {
        if (!testCase.receivedFlag) {
            testCase.onError('Response not received.');
        } else if (testCase.timeoutFlag !== testCase.isPersistent) {
            testCase.onError('Socket closed or response was too long.');
        } else {
            testCase.test.emit('testPersistent');
        }
    };

    testCase.setSocketProperties = function (socket) {
        socket.setTimeout(1000, function () {
            testCase.timeoutFlag = true;
        });
    };

    testCase.runServer(ex2Path, function () {
        testCase.subtestLoop(testNames, true, req);
    });
};

testPersistent.tearDown = function () {
    this.removeAllListeners('testPersistent');
};

/**
 * Testing error responses. <br/>
 * Codes 404, 405, 500 tested here.
 * Code 500 tested for case of URL violation.<br/>
 * Using HTTP client.
 */
var testDenyResponse = function () {
    var testNames = [
        'Response 404',
        'Response 405, TRACE method.',
        'Response 404, URL not mapped.',
        'Response 500, URL beyond rootFolder.',
        'Response 404, URL not starts with /'];
    var expCode = [404, 405, 404, 500, 404];
    var methods = ['GET', 'TRACE', 'GET', 'GET', 'GET'];
    var paths = [
        '/serverRoot/dummy',
        '/serverRoot/index.html',
        '/index.html',
        '/serverRoot/../tester.js',
        'index.html'];

    var testCase = new TestTool.TestCase(this, 'testDenyResponse');

    testCase.setSubtest = function (idx) {
        testCase.expCode = expCode[idx];
        testCase.options.method = methods[idx];
        testCase.options.path = paths[idx];
    };

    testCase.onResponse = function (res, req) {
        if (res.statusCode != testCase.expCode) {
            testCase.onError('Received code '.concat(res.statusCode));
        }
    };

    testCase.onResponseEnd = testCase.subTestSuccess;

    var app = miniExpress();
    var server = miniHTTP.createServer(app);
    testCase.server = server;
    testCase.app = app;
    app.use('/serverRoot', miniExpress.static(ex2Path));
    server.listen(8080, function () {
        testCase.subtestLoop(testNames);
    });
};

testDenyResponse.tearDown = function () {
    this.removeAllListeners('testDenyResponse');
};

/**
 * Testing response code 500 with corrupted HTTP message.<br/>
 * Simulating wrong HTTP request with TCP client.
 */
var testResponse500 = function () {
    var req = [
        'GET /script.js HTTP/1.1\r\n\r\n\r\n',
        'GET /script.js HTTP/1.1\r\nhost: localhost:8080\r\nunexpected\r\n\r\n',
        'GET /script.js HTTP/1.1 host: localhost:8080\r\n\r\n',
        'GET /script.js HTTP/0.9\r\nhost: localhost:8080\r\n\r\n'
    ];

    var testNames = [
        'No HOST property',
        'Unexpected header property',
        'Wrong request-line syntax',
        'Unsupported HTTP version.'
    ];
    var testCase = new TestTool.TestCase(this, 'testResponse500');

    testCase.onResponseEnd = testCase.subTestSuccess;

    testCase.setSubtest = function (idx) {
        testCase.buff = '';
    };

    //this === curr socket
    testCase.onTCPData = function (data) {
        testCase.buff = testCase.buff.concat(data);
        var reqLineEnd = testCase.buff.indexOf('\r\n');
        if (reqLineEnd < 0) return;
        //request line received
        this.removeAllListeners('data'); //drop incoming data
        testCase.buff = testCase.buff.toLowerCase();
        if (testCase.buff.indexOf('500 internal server error\r\n') < 0) {
            this.removeAllListeners('end');
            testCase.onError('Wrong response: '
                .concat(testCase.buff.substr(0, reqLineEnd)));
        }
        this.end();
    };

    testCase.runServer(ex2Path, function () {
        testCase.subtestLoop(testNames, true, req);
    });
};

testResponse500.tearDown = function () {
    this.removeAllListeners('testResponse500');
};

/**
 * Testing ability of the server to receive request header split over multiple
 * TCP segments.<br/>
 * Using 1 second timeout to force new TCP segment.
 * Breaking both request line and header data.<br/>
 * Validating that response 200 received.<br/>
 * This test takes at least 2 seconds to execute.<br/>
 * This test may be false-positive if TCP implementation waits long delay before
 * segment flush.
 */
var testSparseHeader = function () {
    var req = [
        'GET /index.html ',
        'HTTP/1.1\r\n',
        'host: localhost:8080\r\n\r\n'];

    var testCase = new TestTool.TestCase(this, 'testSparseHeader');
    testCase.buff = '';

    testCase.onTCPConnected = function () {
        var socket = this;
        socket.write(req[0]);
        setTimeout(function () {
            socket.write(req[1]);
        }, 1000);
        setTimeout(function () {
            socket.write(req[2]);
        }, 2000);
    };

    testCase.onTCPData = function (data) {
        testCase.buff = testCase.buff.concat(data);
	if (testCase.buff.indexOf('\r\n') < 0) return;
	//request line received
	this.removeAllListeners('data'); //drop incoming data
	testCase.buff = testCase.buff.toLowerCase();
	if (testCase.buff.indexOf('200 ok\r\n') < 0) {
	    this.removeAllListeners('end');
	    testCase.onError('Wrong response.\r\n'.concat(testCase.buff));
	}
        
        this.end();
    };

    testCase.runServer(ex2Path, function () {
        testCase.requestTCP();
    });
};

/**
 * Testing HTTP/1.1 pipelininig.<br/>
 * Using TCP client.<br/>
 * Sending 3 requests at once.<br/>
 * Validating: order of responses.<br/>
 * Using response codes to differentiate between responses.
 */
var testHTTPPipeline = function () {
    //chaining 3 requests
    var reqData = ['GET dummy HTTP/1.1\r\nhost: localhost:8080\r\n',
    'content-length: 18\r\n\r\ndummy body content',
    'GET /../tester.js HTTP/1.1\r\nhost: localhost:8080\r\n\r\n',
    'GET /script.js HTTP/1.1\r\nhost: localhost:8080\r\nconnection: close\r\n\r\n'
    ].join('');

    var resCodes = ['404 not found\r\n',
    '500 internal server error\r\n',
    '200 ok\r\n'];

    var resData = [];
    var testCase = new TestTool.TestCase(this, 'testHTTPPipeline');

    //store all incoming data
    testCase.onTCPData = function (data) {
        resData.push(data);
    };

    //validating that response codes received in expected order
    testCase.onResponseEnd = function () {
        var pos;
        resData = resData.join('').toLowerCase();
        for (var i = 0; i < resCodes.length; ++i) {
            pos = resData.indexOf(resCodes[i]);
            if (pos < 0) {
                testCase.onError('Unexpected response code when looked for: '.concat(resCodes[i]));
                return;
            }
            resData = resData.substr(pos + resCodes[i].length);
        }
        testCase.success();
    };

    testCase.runServer(ex2Path, function () {
        testCase.requestTCP(reqData);
    });
};

/**
 * Testing output of .route() method, after multiple middlewares registered.<br/>
 * Also testing req.params object to match the parsed parameters.<br/>
 * Verifying case-sensitive parameters.
 */
var testRoute = function () {
    var testName = 'testRoute';
    var testCase = new TestTool.TestCase(this, testName,
        '/user/myId/subDir1/index.html');
    var app = miniExpress();

    function dummyMiddleware(req, res, next) {
        next();
    }

    //expected value in req.params field (stringified)
    var expectedParams = JSON.stringify({iD : 'myId', Dir : 'subDir1'});

    function seeParams(req, res, next) {
        try {
            var params = JSON.stringify(req.params);
            if (params !== expectedParams) {
                throw new Error();
            }
        } catch (err) {
            testCase.onError(util.format('req.params EXPECTED: %s\r\nGOT: %s',
                expectedParams, params));
            return;
        }
        next();
    }

    //all route data expected to be in lower case.
    var expected = { get: [
            { path: '/user/:iD/:Dir',
            regexp: /^\/user\/([^\/]+)\/([^\/]+)/,
            keys: [{name: 'iD', optional: false},
                {name: 'Dir', optional: false}],
            callbacks: seeParams,
             method: 'get' },
            { path: '/global/:resourceID/',
                regexp: /^\/global\/([^\/]+)\//,
                keys: [{name: 'resourceID', optional: false}],
                callbacks: dummyMiddleware,
                method: 'get' },
            { path: '/',
                regexp: /^\//,
                keys: [],
                callbacks: dummyMiddleware,
                method: 'get' }],
post: [
    { path: '/REGISTER/:id/:dir',
        regexp: /^\/register\/([^\/]+)\/([^\/]+)/,
        keys: [{name: 'id', optional: false},
            {name: 'dir', optional: false}],
    callbacks: dummyMiddleware,
method: 'post' } ],
delete: [
    { path: '/user/:id/:source',
    regexp: /^\/user\/([^\/]+)\/([^\/]+)/,
    keys: [{name: 'id', optional: false},
        {name: 'source', optional: false}],
    callbacks: dummyMiddleware,
method: 'delete' } ],
put:[
    { path: '/user/:user/:dest',
        regexp: /^\/user\/([^\/]+)\/([^\/]+)/,
        keys: [{name: 'user', optional: false},
            {name: 'dest', optional: false}],
    callbacks: dummyMiddleware,
method: 'put' } ]
    };


    app.get('/user/:iD/:Dir', seeParams)
    .put('/user/:user/:dest', dummyMiddleware)
    .delete('/user/:id/:source', dummyMiddleware)
    .post('/REGISTER/:id/:dir', dummyMiddleware)
    .get('/global/:resourceID/', dummyMiddleware)
    .get(dummyMiddleware)
    .use('/user/myId/subDir1/', miniExpress.static(ex2Path));

    var route = app.route();
    var expectedStr = JSON.stringify(expected);
    var routeStr = JSON.stringify(route);
    if (expectedStr !== routeStr) {
        this.emit('test_result', testName,
            util.format('FAILED: EXPECTED:\r\n%s\r\nGOT:\r\n%s',
                expectedStr, routeStr));
        return;
    }



    testCase.onResponse = function (res, req) {
        if (res.statusCode != 200) {
            testCase.onError('statusCode EXPECTED 200, GOT '.concat(res.statusCode));
        }
    };

    var server = miniHTTP.createServer(app);
    testCase.app = app;
    testCase.server = server;
    server.listen(8080, function () {
        testCase.requestHTTP();
    });
};

/**
 * Testing ExpressResponse.set().<br/>
 * Testing multiple fields set from object.<br/>
 * Testing header with multiple values (as defined in http.setHeader()).<br/>
 * Setting headers from middleware and validating them on arrival.
 */
var testResponseSet = function () {
    var testCase = new TestTool.TestCase(this, 'testResponseSet', '/index.html');

    //additional headers to be set in response on server side
    var setHeaders = {
        'key1': 'value1',
        'key2': 'value2',
        //array defines multi-value header
        'multi-key': ['sub1=val1', 'sub2=val2', 'sub3=val3']
    };

    testCase.onResponse = function (res, req) {
        var headers = res.headers;
        //verifying all set headers
        for (var k in setHeaders) {
            var expected = (setHeaders[k] instanceof Array)
                ? setHeaders[k].join('; ') : setHeaders[k];
            if (headers[k] !== expected) {
                testCase.onError(
                    util.format('header \'%s\' expected \'%s\', got \'%s\'',
                        k, expected, headers[k]));
                return;
            }
        }
        testCase.success();
    };

    var app = miniExpress();
    app.get('/', function (req, res, next) {
        res.set({'key1': setHeaders['key1'], 'key2': setHeaders['key2'],
            'multi-key': setHeaders['multi-key']});
        next();
    });
    app.use(miniExpress.static(ex2Path));


    var server = miniHTTP.createServer(app);
    testCase.app = app;
    testCase.server = server;

    server.listen(8080, function () {
        testCase.requestHTTP();
    });
};

/**
 * Testing middleware miniExpress.json() and ExpressResponse.json().<br/>
 * Sending json object in request.<br/>
 * Validating that the object parsed and attached to req.body.<br/>
 * Server then sends the same object back, and the client validates it on arrival.
 */
var testJson = function () {
    var json = {
        field1: 'hello',
        field2: 'testing',
        subobj: {
            sub1: 'a',
            sub2: -12.5
        },
        subarr: ['first', 'second', 3, null, true, false]
    };
    var body = JSON.stringify(json);

    var testCase = new TestTool.TestCase(this, 'testJson', '/json');

    testCase.options.method = 'PUT';
    testCase.options.headers = {
        'content-type': 'application/json',
        'content-length': body.length
    };


    testCase.onResponse = function (res, req) {
        if (res.statusCode != 200) {
            testCase.onError('Response status code expected 200, got '
                .concat(res.statusCode));
        } else if (res.headers['content-type'] !== 'application/json') {
            testCase.onError(['Client received back illegal type.\r\n',
                'Expected \'application/json\', got \'',
                res.headers['content-type'], '\'.'].join(''));
        }
    };
    testCase.buff = [];
    //this === response
    testCase.readable = function () {
      testCase.buff.push(this.read());
    };

    testCase.onResponseEnd = function () {
        var receivedBody = testCase.buff.join('');
        if (receivedBody === body) {
            testCase.success();
        } else {
            testCase.onError(
                util.format('Received response body EXPECTED:\r\n%s\r\nGOT:\r\n%s',
                body, receivedBody));
        }
    };

    var app = miniExpress();
    app.put('/', miniExpress.json());
    app.use('/', function (req, res, next) {
        try {
            var received = JSON.stringify(req.body);
            if (received !== body) throw new Error();
        } catch (err) {
            testCase.onError(util.format('req.body EXPECTED:\r\n%s\r\nGOT:\r\n%s',
                body, received));
            return;
        }
        //testCase.success();
        //sending the json back: .send() should recognize and call .json()
        res.send(req.body);
    });


    var server = miniHTTP.createServer(app);
    testCase.app = app;
    testCase.server = server;

    server.listen(8080, function () {
        testCase.requestHTTP(body);
    });
};

/**
 * Testing middleware urlencoded.<br/>
 * Sending POST request with form data.
 * Verifying that req.body is the expected parsed object.<br/>
 * This test also verifies middleware bodyParser.
 */
var testUrlencoded = function () {
    var postBody = 'key1=value1&key2=value2&multikey=firstvalue&multikey=secondvalue';
    //expected req.body
    var expectedBody = JSON.stringify({key1:'value1',
    key2:'value2',
    multikey: ['firstvalue', 'secondvalue']});

    var testCase = new TestTool.TestCase(this, 'testUrlencoded', '/');
    testCase.options.method = 'POST';
    testCase.options.headers = {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': postBody.length
    };

    var app = miniExpress();
    app.post(miniExpress.bodyParser())
    .post(function(req, res, next) {
        try {
            var received = JSON.stringify(req.body);
            if (received !== expectedBody) throw new Error();
        } catch (err) {
            testCase.onError(util.format('req.body EXPECTED:\r\n%s\r\nGOT:\r\n%s',
                expectedBody, received));
            return;
        }
        next();
    }).use(miniExpress.static(ex2Path));

    var server = miniHTTP.createServer(app);
    testCase.app = app;
    testCase.server = server;

    server.listen(8080, function () {
        testCase.requestHTTP(postBody);
    });
};

/**
 * Testing usage of miniExpress.listen().<br/>
 * Opening multiple internal servers, verifying that all servers are getting requests,
 * and client receives response 200 with expected content-length.<br/>
 */
var testInternalServers = function () {
    var expectedLen = 4096; //length of img.gif
    var ports = [3000, 3001, 3002, 8080];
    var names = [
        'Internal server port 3000',
        'Internal server port 3001',
        'Internal server port 3002',
        'External server port 8080'];

    var testCase = new TestTool.TestCase(this, 'testInternalServers', '/img.gif');

    testCase.setSubtest = function (idx) {
        testCase.options.port = ports[idx];
    };

    testCase.onResponse = function (res, req) {
        if (res.statusCode != 200) {
            testCase.onError('Response status code expected 200, got '
                .concat(res.statusCode));
        } else if (res.headers['content-length'] != expectedLen) {
            testCase.onError(util.format('Response content-length expected %d, got %s.',
                expectedLen, res.headers['content-length']));
        }
    };

    testCase.onResponseEnd = testCase.subTestSuccess;

    var app = miniExpress();
    app.use(miniExpress.static(ex2Path));
    var server = miniHTTP.createServer(app); //additional external server
    testCase.app = app;
    testCase.server = server;

    //internal servers
    var s1, s2, s3;

    testCase.success = function () {
        s1.close();
        s2.close();
        s3.close();
        TestTool.TestCase.prototype.success.call(testCase);
    };

    s1 = app.listen(ports[0], function () {
        s2 = app.listen(ports[1], function () {
           s3 =  app.listen(ports[2], function () {
                server.listen(ports[3], function () {
                    testCase.subtestLoop(names);
                });
            });

        });
    });

};

testInternalServers.tearDown = function () {
    this.removeAllListeners('testInternalServers');
};

/**
 * Testing res.cookie() and req.cookies in miniExpress.<br/>
 * Sending request with 'cookie' header and validating req.cookies.<br/>
 * In response setting multiple cookies with res.cookie() and verifying them
 * on the client side.<br/>
 * This test relies on specific representation of multiple 'set-cookie' headers
 * in http.IncomingMessage.headers.
 */
var testCookies = function () {
    //value for 'set-cookie' in response
    //json value in cookie
    var cookie1 = {field1: 'val1', field2: ['one', 2, true]};
    var cookie1Opts = {maxAge: 7000, httpOnly: true, secure: true, path : '/login'};
    //string value in cookie
    var cookie2 = 'simple';
    var expectedPattern =
        "cookie1=%s; httpOnly; secure; path=/login; expires=%s,cookie2=simple; path=/";

    //values for 'cookie' in request
    var passedCookies = 'mycookie1=value1; mycookie2=value2';
    var expectedCookies = JSON.stringify({
        'mycookie1':'value1', 'mycookie2': 'value2'
    });

    var testCase = new TestTool.TestCase(this, 'testCookies', '/login');
    testCase.options.headers = {
        'cookie': passedCookies
    };

    testCase.onResponse = function (res, req) {
        if (res.statusCode != 200) {
            testCase.onError('Response status code expected 200, got '
                .concat(res.statusCode));
            return;
        }
        var expected = util.format(expectedPattern,
            JSON.stringify(cookie1), testCase.cookie1Expires);
        var got = res.headers['set-cookie'];
        if (!(got instanceof Array) || expected !== got.join(',')) {
            testCase.onError(util.format(
                '\'set-cookie\' headers EXPECTED:\r\n%s\r\nGOT:\r\n%s\r\n',
               expected, got));
        }
    };

    var app = miniExpress();
    app.get(miniExpress.cookieParser())
    .get(function (req, res, next) {
        //verifying req.cookies
        try {
            var receivedCookies = JSON.stringify(req.cookies);
            if (receivedCookies !== expectedCookies) throw new Error();
        } catch (err) {
            testCase.onError(util.format('req.cookies EXPECTED:\r\n%s\r\nGOT:\r\n%s',
                expectedCookies, receivedCookies));
            res.send(404);
            return;
        }

        //sending response with multiple 'set-cookie'
        res.cookie('cookie1', cookie1, cookie1Opts);
        res.cookie('cookie2', cookie2);
        testCase.cookie1Expires = new Date(Date.now() + cookie1Opts.maxAge).toUTCString();
        res.send(200);
    });
    var server = miniHTTP.createServer(app); //additional external server
    testCase.app = app;
    testCase.server = server;

    server.listen(8080, function () {
        testCase.requestHTTP();
    });
};

/**
 * Testing stability of server in case of middleware attack.<br/>
 * This test demonstrates only one possible attack when Request instance broke
 * before static() gets it.<br/>
 * Validating: server keeps running, next request served with response 200.
 */
var testMiddlewareAttack = function () {
    var names = ['Attacking request', 'Following request'];
    var paths = ['/subdir/dummy', '/script.js'];

    var testCase = new TestTool.TestCase(this, 'testMiddlewareAttack');
    var app = miniExpress();
    //attacking callback
    app.use('/subdir', function (req, res, next) {
        //removing all fields from request
        for (m in req) {
            if (req.hasOwnProperty(m)) {
                delete req[m];
            }
        }
        next();
    });

    app.use('/', miniExpress.static(ex2Path));

    testCase.onError = testCase.subTestSuccess;
    testCase.onResponseEnd = testCase.subTestSuccess;

    //only for the second request, after the attack
    testCase.onResponse = function (res, req) {
        if (res.statusCode != 200) {
            TestTool.TestCase.prototype.onError.call(testCase,
                'Response code expected 200, got '.concat(res.statusCode));
        }
    };

    testCase.setSubtest = function (idx) {
        testCase.options.path = paths[idx];
    }

    var server = miniHTTP.createServer(app);
    testCase.app = app;
    testCase.server = server;

    server.listen(8080, function () {
        testCase.subtestLoop(names);
    });
};

testMiddlewareAttack.tearDown = function () {
    this.removeAllListeners('testMiddlewareAttack');
};

///Array of test cases to run
var tests = [
    testInputValidation,
    testUseStatic,
    testDenyResponse,
    testResponse500,
    testFormats,
    testRequestBody,
    testPersistent,
    testUseChain,
    testSparseHeader,
    testHTTPPipeline,
    testResponseSet,
    testJson,
    testInternalServers,
    testUrlencoded,
    testCookies,
    testRoute,
    testMiddlewareAttack
];

//Now running test suite with all defined tests
var suite = new TestTool.TestSuite();
suite.addTests(tests);
suite.runAll();

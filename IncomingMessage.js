/*
 * Definition and implementation of miniHTTP.Incoming type.
 * Also defines hidden Request type with internal implementation of of server request.
 */

//References to external modules.
var lib = {
    url: require('url'),
    util: require('util')
};
//the shared object with system-scope names
var shared = require('./namespaces').http_namespace;
//define shared objects
shared.IncomingMessage = IncomingMessage;
shared.Request = Request;

/**
 * Constructor for miniHTTP.request.
 * @param {Request} request underlying request object
 * @constructor
 */
function IncomingMessage(request) {
    var that = this;
    that.__request = request;
    that.headers = request.header;
    that.method = request.reqLine.method;
    that.httpVersion = request.reqLine.ver.substring(5);
    that.url = request.reqLine.url;
    that.socket = request.socket;
    //defining Readable stream on this object
    shared.CustomReadStream.call(this,
        (request.body) ? request.body : 0);

    request.socket.once('close', function () {
        that.emit('close');
    });
}
//Inheriting from Readable stream. The stream data is the body data.
lib.util.inherits(IncomingMessage, shared.CustomReadStream);

/**
 * Sets timeout on client connections.
 * Also,sets timeout callback and cancel default activity.
 * By default, after 2 sec timeout, connection is closed.
 * @param {int} msec idle timeout length.
 * @param {function} callback function to call on client connection that idle
 * for the defined time. The callback gets the socket as argument.
 */
IncomingMessage.prototype.setTimeout = function (msec, callback) {
    Request.setTimeout(msec, callback, this.__request.socket);
};

/**
 * Pattern function for setting idle timeout & callback on socket.
 * Static function, 'this' not used.
 */
Request.setTimeout = function (msec, callback, socket) {
    msec = parseInt(msec);
    if (isNaN(msec) || msec < 0) {
        throw new TypeError('msec must be a positive integer.');
    }
    if (typeof(callback) !== 'function') {
        throw new TypeError('callback must be a function.');
    }
    socket.setTimeout(msec, function () {
        callback.call(null, socket);
    });
};


/** Internal type with implementation of http request object.
 * @param {net.Socket} socket current client connection.
 * @constructor
 */
function Request(socket) {
    this.socket = socket;
    this.reqLine = {};
    this.header = {};
}

/**
 * Parses request line.
 * @param {String} line first line before CRLF from the arrived request.
 * @returns {boolean} true iff parsing done without errors.
 * If false returned, then this method already sent error response.
 */
Request.prototype.parseReqLine = function (line) {
    var tokens = line.split(shared.httpTokens.SP);
    if (tokens.length !== 3) {
        this.getResponse().denyResponse(500, 'Request-line corrupted.');
        return false;
    }
    if (shared.httpTokens.methods[tokens[0]] !== true) {
        //unsupported method
        this.getResponse().denyResponse(405,
            'Requested method: '.concat(tokens[0]));
        return false;
    }
    if (shared.httpTokens.versions[tokens[2]] !== true) {
        //unsupported version
        this.getResponse().denyResponse(500,
            'Version not supported: '.concat(tokens[2]));
        return false;
    }
    this.reqLine.method = tokens[0];
    this.reqLine.url = tokens[1];
    this.reqLine.ver = tokens[2];
    return true;
};

/**
 * Parses header properties.
 * @param {String} head  the header part of HTTP request:
 * from second line of request, till before the body separator (CRLF+CRLF).
 * @returns {boolean} true iff header successfully parsed.
 * If false returned, then this method already sent error response.
 */
Request.prototype.parseHead = function (head) {
    var lines = head.toLowerCase().split(shared.httpTokens.CRLF);
    var tokens;
    for (var i = 0; i < lines.length; ++i) {
        if (lines[i].length === 0) continue;
        tokens = lines[i].split(shared.httpTokens.DEF);
        if (tokens.length !== 2) {
            this.getResponse().denyResponse(500,
                'Request header corrupted. Unsupported property syntax:\r\n'
                    .concat(lines[i]));
            return false;
        }
        if (!this.header[tokens[0]]) {
            //additional headers with the same name not supported
            this.header[tokens[0]] = tokens[1];
        }

    }
    //validation of required header properties
    if (!this.header.hasOwnProperty('host')) {
        this.getResponse().denyResponse(500,
            'Request header has no required HOST property.');
        return false;
    }
    this.query = this.reqLine.url.query; //express API compatibility
    return true;

};

/**
 * Test for HTTP pipelining support.
 * @returns {boolean} false then pipelining not allowed, true otherwise.
 */
Request.prototype.pipelineSupported = function () {
    return this.reqLine.ver === 'HTTP/1.1' && this.reqLine.method === 'GET';
};

/**
 * Persistence test for current session.
 * @returns {boolean} true iff current session declared as persistent.
 */
Request.prototype.isPersistent = function () {
    var connField = this.header['connection'];
    switch (this.reqLine.ver) {
        case 'HTTP/1.0':
            return (connField
                && connField.indexOf('keep-alive') > -1);
        case 'HTTP/1.1':
        default:
            return !(connField
                && connField.indexOf('close') > -1);
    }
};

/**
 * Returns Response instance for this request.
 * For each request, there's a singleton response object.
 * (This response object can be sent only once)
 * @returns {Response} response object for current request.
 */
Request.prototype.getResponse = function () {
    if (!this.response) {
        this.isPersistent = this.isPersistent(); //compute once and store the result
        this.response = new shared.Response(this.socket, this.isPersistent,
            this, this.reqLine.ver);
    }
    return this.response;
};

/**
 * HTTP pipelining method.
 * Called when response sending done for current request.
 * Looks for next request in the pipeline queue.
 * If next request found, then 'request_ready' emitted on it.
 */
Request.prototype.nextRequest = function (socket) {
    if (this.next) { //have next request in pipeline queue
        socket.emit('request_ready', this.next);
    } else { //end of pipeline queue
        socket.last = undefined;
        if (!this.isPersistent) {socket.end();}
    }
};
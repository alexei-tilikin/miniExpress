/* Submodule for Server, SharedFile.
* Server is internal hidden object.
*/

//References to external modules.
var lib = {
    fs: require('fs'),
    util: require('util'),
    EventEmitter : require('events').EventEmitter
};
//the shared object with system-scope names
var shared = require('./namespaces').http_namespace;
//define shared objects
shared.Server = Server;

/**
 * Internal type representing HTTP server.
 * Contains internal implementation.
 * Hides all internal functions from miniExpress exports.
 * @param {ServerHTTP} serverHTTP reference to the parent object.
 * @constructor
 */
function Server(serverHTTP) {
    this.serverHTTP = serverHTTP; //backward link to the parent miniHTTP server.
}

/**
 * Callback for error on listening socket.
 * Prints error information.
 * @param err the error
 */
Server.serverSocketErr = function (err) {
    console.error('Error in TCP server: '.concat(err));
};

/* Controls single client connection.
 * Triggered on 'connect' event from the TCP server.
 * Defines callbacks for socket events.
 */
Server.prototype.connection = function (socket) {
    var server = this;
    if (server.serverHTTP.listeners('connection').length > 0) {
        //custom callback for incoming connection replaces default activity
        server.serverHTTP.emit('connection', socket);
        return;
    }
    socket.on('data', Server.receiveData)
        .on('data_tail', Server.receiveData) //custom event for HTTP pipelining
        .on('request_ready', function (request) {
            //custom event when request message totally arrived and parsed.
            server.requestReady(request);
        }).once('close', function () {
            socket.destroy();
        }).once('error', function (err) {
            console.error('Error on client socket: '.concat(err));
            server.serverHTTP.emit('clientError', err, socket);
            socket.destroy();
        });
     socket.setTimeout(server.serverHTTP.timeout, function () {
            server.socketTimeout(socket);
     });

    //buffer for request line and for request header (if sparse)
    socket.headerBuff = '';
    //stage in receiving current request
    socket.reqStage = Server.REQ_STAGE.reqLine;
};

/**
 * Callback for socket timeout
 * 'this' points to the Server instance.
 * @param socket - socket that emitted timeout
 */
Server.prototype.socketTimeout = function (socket) {
    //avoiding errors because of late request_ready events
    socket.removeAllListeners('request_ready');
    if (this.socketTimeoutCallback) {
        //if there's custom callback, the call it
        this.socketTimeoutCallback.call(null, socket);
    } else {
        socket.end(); //default is to close the connection.
    }
};

/**
 * Enumeration of legal states in receiving request.
 * reqLine - receiving and parsing request line.
 * header - request line successfully parsed, receiving and parsing header fields.
 * body - header successfully parsed and body expected, receiving the body.
 * Such staging provides simple state machine for socket.data event.
 * Each client connection has its own state.
 */
Server.REQ_STAGE = {reqLine: 0, header: 1, body: 2};

Server.REQ_STAGE.reset = function (socket) {
    socket.reqStage = Server.REQ_STAGE.reqLine;
    socket.request = undefined;
    this.headerBuff = '';
};

/**
 * Static function.
 * Callback on socket.data event.
 * 'this' is instance of net.Socket.
 * Buffers arrived data. Emits 'request_ready' event once request totally arrives.
 * @param {Buffer|String} data the data chunk that received on the socket.
 */
Server.receiveData = function (data) {
    var socket = this;
    data = data.toString();

    //receiving the request line
    if (socket.reqStage === Server.REQ_STAGE.reqLine) {
        var dataTail = Server.appendHeaderData.call(socket, data,
            shared.httpTokens.CRLF, shared.Request.prototype.parseReqLine);
        if (dataTail !== false) {
            data = dataTail;
            socket.reqStage = Server.REQ_STAGE.header;
        }
    }
    //receiving header
    if (socket.reqStage === Server.REQ_STAGE.header) {
        var headTail = Server.appendHeaderData.call(socket, data,
            shared.httpTokens.BODY_SEP, shared.Request.prototype.parseHead);
        if (headTail === false) return;

        var bodyLen = parseInt(socket.request.header['content-length']);
        if (isNaN(bodyLen) || bodyLen < 1) { //no body
            Server.requestBodyDone.call(socket);
            if (headTail.length > 0) {
                socket.emit('data_tail', headTail);
            }
            return;
        }
        socket.bodyBuff = new shared.BufferFiller(bodyLen);
        socket.bodyBuff.onFull = function (tail) {
            Server.bodyReceived.call(socket, tail);
        };
        socket.reqStage = Server.REQ_STAGE.body;
        socket.bodyBuff.append(headTail); //first chunk of body
    } else if (socket.reqStage === Server.REQ_STAGE.body) { //receiving body
        //write next chunk into body buffer.
        socket.bodyBuff.append(data);
    }
};

/**
 * Subroutine of Server.receiveData
 * Common code for receiving sparse request line or sparse header.
 * Manages socket.headerBuff
 * 'this' points to current socket.
 * @param {string} data current data segment,
 * @param {string} endToken delimiter that should appear at the end of current part.
 * @param {function} parser function to call for parsing current part.
 * @returns {false|string} false returned when current part not (yet) arrived.
 * This may happen on parsing error, when deny response sent and socket state reset
 * for next request.
 * If string returned, then that's the data tail after the current part.
 */
Server.appendHeaderData = function (data, endToken, parser) {
    this.headerBuff = this.headerBuff.concat(data);
    var partEnd = this.headerBuff.indexOf(endToken);
    if (partEnd < 0) { //end of current part not found
        return false;
    }
    if (!this.request) {
        this.request = new shared.Request(this);
    }
    if (!parser.call(this.request, this.headerBuff.substring(0, partEnd))) {
        this.request = undefined;
        Server.REQ_STAGE.reset(this);
        return false;
    }
    var tail = this.headerBuff.substring(partEnd + endToken.length);
    this.headerBuff = '';
    return tail;
};

/**
 * Implementation of adapters.BufferFiller.onFull.
 * Called then current request body totally received.
 * 'this' points to current socket
 * @param tail beginning of the next request data.
 */
Server.bodyReceived = function (tail) {
    if (tail.length === 0) {
        Server.requestBodyDone.call(this);
        return;
    }
    //tail not empty
    if (this.request.pipelineSupported()) {
        Server.requestBodyDone.call(this);
        this.emit('data_tail', tail);
    } else {
        Server.requestBodyOverflow.call(this);
    }

};

/**
 * Static function.
 * Callback for bodyStream.finish event.
 * 'this' points to current socket.
 * Called only when request has body, once the body fully received.
 * May emit request_ready event.
 */
Server.requestBodyDone = function () {
    if (this.reqStage === Server.REQ_STAGE.body) {
        //appending received body as Buffer
        this.request.body = this.bodyBuff.getBuffer();
        delete this.bodyBuff;
    }

    if (this.last) {
        this.last.next = this.request;
        this.last = this.request;
    } else {
        this.last = this.request;
        this.emit('request_ready', this.request);
    }
    Server.REQ_STAGE.reset(this);
};

/**
 * Called when pipelining disabled and extra data found
 * where request body end expected.
 * 'this' points to current socket.
 */
Server.requestBodyOverflow = function () {
    delete this.bodyBuff;
    //TODO no denyResponse here!
    this.request.getResponse().denyResponse(500,
        ['Could not receive request body: more bytes received',
            ' than stated in \'content-length\'.<br/>',
            'Pipelining not supported for this request.'].join(''));
    Server.REQ_STAGE.reset(this);
};

Server.prototype.requestReady = function (request) {
    var requestHTTP = new shared.IncomingMessage(request);
    var responseHTTP = new shared.ServerResponse(request.getResponse());
    this.serverHTTP.emit('request', requestHTTP, responseHTTP);
};
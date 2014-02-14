/* miniHTTP module.
 * Provides API similar to node HTTP module.
 */

//References to external modules.
var lib = {
    net: require('net'),
    path: require('path'),
    util: require('util'),
    url: require('url'),
    EventEmitter : require('events').EventEmitter
};
//the shared object with system-scope names
var shared = require('./namespaces').http_namespace;

//trigger inclusion of submodules
require('./adapters');
require('./IncomingMessage');
require('./ServerResponse');
require('./Server');

//Constant tokens for HTTP message compiling and parsing.
shared.httpTokens = {
    SP: ' ',
    CRLF: '\r\n',
    BODY_SEP: '\r\n\r\n',
    DEF: ': ',
    MULTI_SEP: '; ',
    MULTI_DEF: '=',
    responseCodes: {
        '200' : 'OK',
        '400' : 'Bad Request',
        '401' : 'Unathorised',
        '403' : 'Forbidden',
        '404' : 'Not Found',
        '405' : 'Method Not Allowed',
        '500' : 'Internal Server Error'
    },
    //supported methods
    methods: {'GET':true, 'POST': true, 'DELETE': true, 'PUT': true},
    //supported protocols
    versions: {'HTTP/1.1':true, 'HTTP/1.0':true}
};

//public exports
module.exports = {
    STATUS_CODES: shared.httpTokens.responseCodes,
    createServer: function (requestListener) {
        return new ServerHTTP(requestListener);
    },
    IncomingMessage: shared.IncomingMessage,
    ServerResponse: shared.ServerResponse
};

/**
 * Constructor for miniHTTP application.
 * @param {function} requestListener the callback to be called each time then new
 * request arrives.
 * @constructor
 */
function ServerHTTP(requestListener) {
    //internal field for API methods use.
    this.__server = new shared.Server(this);

    if (typeof(requestListener) === 'function') {
        this.on('request', requestListener);
    }
    //default timeout of client sockets (by default timed-out socket is closed)
    this.timeout = 2000;
}
//default timeout of client sockets (by default timed-out socket is closed)
//ServerHTTP.prototype.timeout = 2000;

lib.util.inherits(ServerHTTP, lib.EventEmitter);

/**
 * Starts the server to listen on specified port.
 * Accepts one of the following sets of arguments:
 * port, [hostname], [backlog], [callback];
 * path, [callback];
 * handle, [callback];
 * On illegal arguments, error will be printed and the server will close.
 * @param {int} port the listened port.
 *        {string} path - path for UNIX socket.
 *        {object} handle - the handle object, server or socket
 *       (see http://nodejs.org/api/http.html#http_server_listen_handle_callback)
 * @param {String} hostname - the host name of target. Default is any host in TCPv4.
 * @param {int} backlog - limit on length of queue of incoming connections.
 * @param {function} callback - callback that called once the server starts listening.
 */
ServerHTTP.prototype.listen = function (port, host, backlog, callback) {
    var server = this.__server;
    server.tcpServer = lib.net.createServer(function (socket) {
        server.connection(socket);
    }).once('error', shared.Server.serverSocketErr)
    .once('listening', function () {
            console.log('Online on port '.concat(server.tcpServer.address().port));
    });
    server.tcpServer.listen.apply(server.tcpServer, arguments);
    return this;
};

/**
 * Stops the application from listening to new connection.
 * @param {function} callback called once the application finally stops.
 * If callback is not function, then it's ignored.
 * If error occurred during close, then the error passed in first argument to the
 * callback.
 * If the server already closed, the callback will be called anyway, specifying
 * the error.
 */
ServerHTTP.prototype.close = function (callback) {
    if (typeof(callback) !== 'function') {
        callback = function() {};
    }
    var tcpServer = this.__server.tcpServer;
    var addr = tcpServer.address();
    tcpServer.removeAllListeners();
    tcpServer.once('error', shared.Server.serverSocketErr);
    try {
        tcpServer.close(function () {
            console.log(lib.util.format('Offline (port %d)', addr.port));
        });
        tcpServer.once('close', callback);
    } catch (err) {
        console.error('Error on server close(): '.concat(err));
        //call the callback
        if (callback) {callback.call(null, err); }
    }
};

ServerHTTP.prototype.setTimeout = function (msec, callback) {
    msec = parseInt(msec);
    if (isNaN(msec) || msec < 0) {
        throw new TypeError('msec must be a positive integer.');
    }
    if (typeof(callback) !== 'function') {
        throw new TypeError('callback must be a function.');
    }
    this.timeout = msec;
    this.__server.socketTimeoutCallback = callback;
};


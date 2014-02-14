/* Submodule of miniExpress.
 * Internal (hidden) implementation of miniExpress application.
 */

//References to external modules.
var lib = {
    net: require('net'),
    path: require('path'),
    util: require('util'),
    url: require('url'),
    fs: require('fs'),
    EventEmitter : require('events').EventEmitter,
    miniHTTP: require('./miniHTTP')
};
//the shared object with system-scope names
var shared = require('./namespaces').express_namespace;
//define shared objects
shared.Application = Application;
shared.SharedFile = SharedFile;

/**
 * Constructor for internal implementation of miniExpress application.
 * @constructor
 */
function Application() {
    this.mwareQueue = []; //the queue of middleware callbacks.

    //binding this.next() to constant 'this' context.
    //Necessary for breaking recursion in next().
    this.nextLoopback = Application.prototype.next.bind(this);
}

/**
 * Pool of shared open file descriptors.
 * Key is the absolute path.
 * Value is instance of SharedFile.
 */
Application.fdPool = {};

function SharedFile(path) {
    var that = this;
    that.path = path; //the key in the fdPool
    that.count = 0; //number of simultaneous streams on current fd.
    that.once('error', function () {
        SharedFile.removeFromPool(that, true);
    });
}

/* Custom events:
 * 'ready' - when instance of SharedFile is ready for use.
 * 'error' - when sharedFile failed to open/stat the file.
 */
lib.util.inherits(SharedFile, lib.EventEmitter);

/**
 * Removes shared descriptor from the pool.
 * Called on timeout when no stream uses current fd.
 * @param {SharedFile} sharedFd the shared file to remove.
 * @param {boolean} force - if true, then sharedFd will be removed unconditionally.
 */
SharedFile.removeFromPool = function(sharedFd, force) {
    if (!force && sharedFd.count !== 0) return;
    delete Application.fdPool[sharedFd.path];
    clearTimeout(sharedFd.timeout);
    if (sharedFd.fd === undefined) return;
    lib.fs.close(sharedFd.fd);
    sharedFd.fd = undefined; //protect against multiple invocations
};

/**
 * Sets idle timeout for shared descriptor.
 * After the timeout, the descriptor will be closed and removed from the pool.
 * @param {SharedFile} sharedFd the shared file to set timeout fro.
 */
SharedFile.idleTimer = function (sharedFd) {
    if(--sharedFd.count === 0) {
        sharedFd.timeout =
            setTimeout(SharedFile.removeFromPool, 1000, sharedFd);
    }
};

/**
 * Removes all descriptors from the fdPool, that currently not in use.
 */
Application.clearFdPool = function () {
    var sharedFd;
    for (var path in Application.fdPool) {
        sharedFd = Application.fdPool[path];
        SharedFile.removeFromPool(sharedFd);
    }
};

/**
 * Adds middleware callback into the queue.
 * @param {string} prefix the url prefix for request match.
 * May be parametrized with alphanumeric parameters.
 * @param {function} callback the calblack function to run on match.
 * @param {string} method request method for match.
 */
Application.prototype.appendMiddleware = function (prefix, callback, method) {
    var keys = [];
    var path = prefix;
    var capture = Application.prototype.appendMiddleware.paramCapture;
    var reg = Application.prototype.appendMiddleware.paramRegex;
    var match;
    //catch all parameter keys
    while ((match = capture.exec(prefix)) !== null) {
        //remember the key: optional parameters not implemented
        keys.push({name: match[2], optional: false});
        //replace parameter key with regex for parameter value.
        prefix = prefix.replace(match[1], reg);
    }
    //create entry in middleware queue
    this.mwareQueue.push({
        path: path, //the original path prefix
        regexp: new RegExp('^'.concat(prefix)), //the matcher for url prefix
        keys: keys, //names of parameters
        callbacks: callback, //currently only single callback implemented
        method: method});
};

//regex for parameter keys.
Application.prototype.appendMiddleware.paramCapture = /\/(:([^\/]+))\/?/;
//injected regex for matching parameter value in request url.
Application.prototype.appendMiddleware.paramRegex = "([^\/]+)";

/**
 * Converting url path to relative.
 * @param {string} path url path or suffix of url path.
 * @returns {string} the passed path, without the leading '/'.
 */
Application.relativePath = function (path) {
    return (path.indexOf('/') === 0) ? path.substr(1) : path;
};

/**
 * Pattern function for generation of next() function inside the middleware
 * callback.
 * This pattern calls next callback, and recursively generates next() argument for it.
 * For requests that not matched any registered callbacks, the default response
 * invoked.
 * Note, that this function not called directly by the middleware,
 * it wrapped inside the called next().
 * Thus all the arguments are for internal use only.
 * @param {int} idx starting index for mwareQueue.
 * @param {string} url initial request URL. The URL field in request object
 * may be safely modified: the match will be tested on this argument.
 * @param {string} method
 * @param {ExpressRequest} req the request object.
 * @param {ExpressResponse} res the response object.
 * @param {function} endSocket function that will close current socket in case of error.
 */
Application.prototype.next = function (idx, url, method, req, res, endSocket) {
    var that = this;
    var queue = this.mwareQueue;
    for (var i = idx; i < queue.length; ++i) {
        //method match
        if (queue[i].method && method !== queue[i].method) {continue;}
        //url prefix match
        var match = queue[i].regexp.exec(url);
        if (match === null || match.index !== 0) {continue;}
        //creating params
        req.params = {};
        //adding captured parameters and values to 'params'
        for (var k = 1; k < match.length; ++k) {
            req.params[queue[i].keys[k-1].name] = match[k];
        }
        //set URL suffix relative to the matched prefix (used in static())
        req.__suffix = Application.relativePath(url.substring(match[0].length));

        var nextCall = queue[i].callbacks; //callback has single callback

        //nextDef defines entry to the next iteration within current loop.
        //nextLoopback bound to constant context.
        //When next() will be called from nextCall, stack recursion will begin from Timer event.
        //Thus, long recursions due to multiple callbacks will break to separate stacks.
        var nextDef = function () {
            that.nextLoopback(i+1, url, method, req, res, endSocket);
        };
        break;
    }

    if (nextDef) {
        try {
            //catching any exceptions from nextCall only.
            nextCall.call(null, req, res, function () {
                setTimeout(nextDef, 0);
            });
        } catch (err) {
            //on any exception, assuming that middleware tried to attack
            console.error('Middleware callback thrown exception.');
            console.error(err.stack); //DEBUG
            endSocket(); //forcing connection end
        }
        return;
    }
    //default behavior when no send()/json() called for current response
    Application.defaultResponse(req, res);
};

/**
 * Default response callback.
 * Does nothing if current response was sent.
 * This callback is final: it will send the response and won't call next().
 * @param {ExpressRequest} request original request.
 * @param {ExpressResponse} response response object.
 */
Application.defaultResponse = function (request, response) {
    response.__denyResponse(404,
        'No action defined for requested URL: '
            .concat(request.path));
};

/**
 * The callback for miniHTTP.request event.
 * Creates request and response objects and triggers middlewares execution.
 * @param {IncomingMessage} request arrived miniHTTP request.
 * @param {ServerResponse} response miniHTTP response object.
 */
Application.prototype.requestHandle = function (req, res) {
    var eRequest = new shared.ExpressRequest(req);
    var eResponse = new shared.ExpressResponse(res);
    //URL without the query string
    var url = eRequest.path;
    var method = req.method.toLowerCase();
    //binding function that will close the socket in case of error
    var endSocket = lib.net.Socket.prototype.end.bind(req.socket);
    //find first middleware match and call the callback
    this.nextLoopback(0, url, method, eRequest, eResponse, endSocket);
};
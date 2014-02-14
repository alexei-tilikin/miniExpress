/* Main application module.
 * Implements functions from public miniExpress API.
 * Includes all submodules.
 */

//References to external modules.
var lib = {
    net: require('net'),
    path: require('path'),
    util: require('util'),
    url: require('url'),
    miniHTTP: require('./miniHTTP')
};
//the shared object with system-scope names
var shared = require('./namespaces').express_namespace;
//load submodules
require('./middleware');
require('./expressApp');
require('./ExpressResponse');
require('./ExpressRequest');

//copy definition of httpTokens into express_namespace
(function () {
    var httpShared = require('./namespaces').http_namespace;
    shared.httpTokens = httpShared.httpTokens;
})();

/**
 * The exported function.
 * @returns {function} the callback for miniHTTP 'request' event.
 * The miniExpress application.
 */
var miniExpress = function () {
    var app = Builder.requestHandleGen();
    Builder.call(app);
    return app;
};
//defining middlewares
miniExpress.static = shared.middleware.static;
miniExpress.cookieParser = shared.middleware.cookieParser;
miniExpress.json = shared.middleware.json;
miniExpress.urlencoded = shared.middleware.urlencoded;
miniExpress.bodyParser = shared.middleware.bodyParser;

module.exports = miniExpress;

/**
 * This constructor appends fields and functions to the app(req, res) function.
 * It called in special manner with 'this' pointing to app function.
 * Provides API defined in the exercise.
 * Hides internal implementation from the user.
 * @constructor
 */
function Builder() {
    //internal field for API methods use.
    this.__app = new shared.Application();
    //setting methods
    this.use = Builder.use;
    this.get = Builder.get;
    this.post = Builder.post;
    this.delete = Builder.delete;
    this.put = Builder.put;
    this.route = Builder.route;
    this.listen = Builder.listen;
    this.close = function () {}; //deprecated
}

/**
 * Generator of callback for miniHTTP 'request' event.
 * @returns {Function} the event callback.
 */
Builder.requestHandleGen = function () {
    return function handle(req, res) {
      shared.Application.prototype.requestHandle.call(handle.__app, req, res);
    };
};

/**
 * Pattern function for .use, .get, and all other .verb methods.
 * All these methods only differ in method argument.
 * This pattern appends the callback to the queue.
 * @param {string} path the prefix of the request path for match.
 * May be parametrized.
 * @param {function} callback the middleware callback.
 * If callback is not function, it won't be added.
 * @param {string} method the request method for match.
 */
Builder.usePattern = function (path, callback, method) {
    var args = Builder.usePattern.resolveArgs.apply(null, arguments);
    if (typeof(args[1]) !== 'function') {
        return;
    }
    this.__app.appendMiddleware.apply(this.__app, args);
};
Builder.usePattern.resolveArgs = function () {
    var args = [].slice.call(arguments);
    if (args[1] === undefined) {
        args[1] = arguments[0];
        args[0] = '/';
    } else if (typeof(args[0]) !== 'string') {
        args[0] = '/';
    } /*else {
        args[0] = args[0].toLowerCase();
    }*/
    return args;
};


Builder.use = function (path, callback) {
    Builder.usePattern.call(this, path, callback);
    return this;
};

Builder.get = function (path, callback) {
    Builder.usePattern.call(this, path, callback, 'get');
    return this;
};

Builder.post = function (path, callback) {
    Builder.usePattern.call(this, path, callback, 'post');
    return this;
};

Builder.delete = function (path, callback) {
    Builder.usePattern.call(this, path, callback, 'delete');
    return this;
};

Builder.put = function (path, callback) {
    Builder.usePattern.call(this, path, callback, 'put');
    return this;
};

/**
 * Provides information about registered middlewares for specific request methods.
 * @returns {Object} object with data about registered middlewares for specific
 * request methods (without .use() callbacks).
 */
Builder.route = function () {
    var queue = this.__app.mwareQueue;
    var out = {
        get : [],
        post: [],
        delete: [],
        put: []
    };
    for (var i = 0; i < queue.length; ++i) {
        if (!queue[i].method) {continue;}
        out[queue[i].method].push(queue[i]);
    }
    return out;
};

/**
 * Starts new instance of miniHTTP server, and invokes listen() on it.
 * See ServerHTTP.prototype.listen() for possible arguments.
 * @returns {ServerHTTP} created instance of miniHTTP server.
 */
Builder.listen = function () {
    var server = lib.miniHTTP.createServer(this);
    return server.listen.apply(server, arguments);
};

/* ExpressRequest stands for request object for miniExpress application.
 * It provides the Express API (partially).
 */

//References to external modules.
var lib = {
    util: require('util'),
    url: require('url'),
    path: require('path')
};
//the shared object with system-scope names
var shared = require('./namespaces').express_namespace;
//define shared objects
shared.ExpressRequest = ExpressRequest;

/**
 * Constructor for miniExpress.request object.
 * @param {miniHTTP.IncomingMessage} serverRequest - the underlying server request.
 * @constructor
 */
function ExpressRequest(serverRequest) {
    prepareRequest(this, serverRequest);
}

//default values for fields
ExpressRequest.prototype.cookies = {};
ExpressRequest.prototype.body = {};

/**
 * Gets value of header field.
 * @param {string} field the name of the header.
 * @returns {string} the value of requested header.
 */
ExpressRequest.prototype.get = function (field) {
    try {
        field = field.toString().toLowerCase();
    } catch (err) {
        throw new TypeError('\'field\' should be a string.');
    }
    return this.__headers[field];
};

/**
 * Looks up for parameter with specified name in following places:
 * In req.params,
 * then in req.body (if body defined),
 * then in req.query
 * @param {String} name the name (key) of the parameter to look up.
 * @returns {string} first matched value of the parameter, or undefined.
 */
ExpressRequest.prototype.param = function (name) {
    try {
        name = name.toString();
    } catch (err) {
        throw new TypeError('\'name\' should be a string.');
    }
    
    if (this.params.hasOwnProperty(name)) {return this.params[name];}
    if (this.body && this.body.hasOwnProperty(name)) {
        return this.body[name];
    }
    return this.query[name];
};

/**
 * Checks if requested type matches the 'content-type' header
 * @param {string} type the mime type string
 * @returns {boolean} true iff the 'content-length' describes the asked type.
 */
ExpressRequest.prototype.is = function (type) {
    try {
        type = type.toString().toLowerCase();
    } catch (err) {
        throw new TypeError('\'type\' should be a string.');
    }

    var header = this.get('content-type');
    if (!header) {return false;}

    if (header.indexOf(type) >= 0) {return true;}
    //escaping all special characters that may appear in MIME type
    type = type.replace(/([\.\+\-\/])/g, '\\$1');
    //replacing the asterisk to match any character
    type = type.replace(/\*/g, '.*');
    //testing for match
    var reg = new RegExp(type);
    return reg.test(header);
};

/**
 * Prepares ExpressRequest by setting some fields and defining access functions
 * to the underlying miniHTTP.IncomingMessage.
 * The IncomingMessage object is totally hidden and cannot be accessed
 * from ExpressRequest instance.
 * @param {ExpressRequest} expressRequest the request to prepare.
 * @param {miniHTTP.IncomingMessage} serverRequest the underlying server request.
 */
function prepareRequest(expressRequest, serverRequest) {
    expressRequest.protocol = 'HTTP/'.concat(serverRequest.httpVersion);
    expressRequest.host = serverRequest.headers['host'];
    this.url = lib.url.parse(serverRequest.url, true);
    expressRequest.path = this.url.pathname;
    expressRequest.query = this.url.query;
    //access to the method of the server request
    expressRequest.__method = serverRequest.method;
    //access to the headers of the server request
    expressRequest.__headers = serverRequest.headers;

    //function that reads the request body into Buffer
    //and retrieves the Buffer as callback argument.
    expressRequest.__readBody = function (callback) {
        prepareRequest.readRequestBody.call(expressRequest, serverRequest, callback);
    }
}

/**
 * Reads request body from stream into Buffer.
 * 'this' points to ExpressRequest instance.
 * If request body has data, it will be stored on this.super.__bodyBuff as Buffer.
 * @param {miniHTTP.IncomingMessage} req - the request Readable stream.
 * @param {function} callback - will be called once the body read.
 * The body buffer will be stored in internal field __bodyBuff and also returned
 * as the callback argument.
 */
prepareRequest.readRequestBody = function (req, callback) {
    var expressRequest = this;
    if (expressRequest.__bodyBuff) { //body already read
        callback(expressRequest.__bodyBuff);
        return;
    }
    var length = parseInt(this.get('content-length'));
    if (isNaN(length) || length < 1) {
        callback();
        return;
    }

    var body = new shared.BufferFiller(length);
    req.on('readable', function () {
        var chunk;
        if (!(chunk = req.read())) {
            return;
        }
        body.append(chunk.toString());
    }).once('end', function () {
            expressRequest.__bodyBuff = body.getBuffer();
            callback(expressRequest.__bodyBuff);
    });
};
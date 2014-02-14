/* ExpressResponse stands for response object for miniExpress application.
 * It provides the Express API (partially).
 */

//References to external modules.
var lib = {
    fs: require('fs'),
    path: require('path'),
    util: require('util'),
    Readable: require('stream').Readable
};
//the shared object with system-scope names
var shared = require('./namespaces').express_namespace;
//define shared objects
shared.ExpressResponse = ExpressResponse;

/**
 * Constructor for miniExpress.response object.
 * @param {miniHTTP.ServerResponse} serverResponse the underlying server response.
 * @constructor
 */
function ExpressResponse(serverResponse) {
    //creating object with internal implementation.
    //cannot be accessed directly, defines redirection functions for some operations.
    new EResponse(this, serverResponse);
}

/**
 * Chainable method.
 * Setter for header fields.
 * @param {String|object} field key for header property. Case-insensitive.
 * If field is object, then all properties will be added as separate headers.
 * @param {String|Array} [value] value for header property.
 * If not set, then 'true' assumed.
 * If Array, then treated as multiple properties of single header.
 * @returns {ExpressResponse} this.
 */
ExpressResponse.prototype.set = function (field, value) {
    try {
        if (typeof(field) === 'object') {
            for (var key in field) {
                this.__setHeader(key, field[key]);
            }
            return;
        }

        this.__setHeader(field, value);
        return this;
    } catch (err) {
        throw new TypeError('\'field\' and \'name\' should be both strings.');
    }
};

/**
 * Getter for header fields
 * @param {string} name the name of the field for lookup in headers. Case-insensitive.
 * @returns {string|array|undefined} value of header.
 * If headers already sent or if such header not exists,
 * then 'undefined' returned.
 * If asked header has multiple representations (like 'set-cookie'),
 * then array of all representations returned.
 * Otherwise, string with header value returned.
 */
ExpressResponse.prototype.get = function (name) {
    try {
        return this.__getHeader(name);
    } catch (err) {
        throw new TypeError('\'name\' should be a string.');
    }
};

/**
 * Chainable method.
 * Sets status code for response
 * @param {int} code the response code. Only integers >= 100 accepted.
 * @returns {ExpressResponse} this.
 */
ExpressResponse.prototype.status = function (code) {
    code = parseInt(code);
    if (isNaN(code) || code < 100) {
        return this;
    }
    this.__statusCode(code);
    return this;
};

/**
 * Chainable method.
 * Parses given type and sets corresponding 'content-type' header.
 * @param {string} type the type key in form of file extension or type name.
 * @returns {ExpressResponse} this.
 */
ExpressResponse.prototype.type = function (type) {
    this.__setHeader('content-type',
        EResponse.typeDictionary(lib.path.extname(type)));
    return this;
};

/**
 * Sends response with the passed body.
 * If content-length still not specified, it will be calculated from the given body.
 * @param {int} [status] optional, status code of response.
 * Should be integer >= 100, otherwise ignored.
 * Only statuses 200, 500, 404 supported by the server.
 * Any other status numbers will default to 200.
 * @param {string|object} body body content. May be json.
 */
ExpressResponse.prototype.send = function () {
    var args = ExpressResponse.prototype.send.resolveArgs.apply(null, arguments);
    var status = args[0];
    var body = args[1];

    var bodyStream; //Readable stream with body content
    var type, length;
    switch (typeof(body)) {
        case 'string':
            type = EResponse.typeDictionary(''); //default = html
            var buff = new Buffer(body);
            length = buff.length;
            bodyStream = new shared.CustomReadStream(buff);
            break;
        case 'object':
            if (body instanceof Buffer) {
                type = EResponse.typeDictionary('octet');
                length = body.length;
                bodyStream = new shared.CustomReadStream(body);
            } else {
                this.json(status, body);
                return;
            }
            break;
        case 'undefined':
        default:
            if (typeof(status) !== 'number') {
                throw TypeError('\'body\' argument must persist.');
            }
            this.__denyResponse(status); //will also work for 200
            return;
    }
    if (isNaN(parseInt(this.get('content-length')))) {
        this.set('content-length', length);
    }
    if (!this.get('content-type')) {
        this.set('content-type', type);
    }
    this.status(status);
    this.send.sendStream(bodyStream);
};
ExpressResponse.prototype.send.resolveArgs = function () {
    var args = [].slice.call(arguments, 0, 2);
    if (args[1] === undefined && typeof(args[0]) !== 'number') {
        //rearranging arguments
        args[1] = args[0];
        args[0] = undefined;
    }
    return args;
};

/**
 * Sends json object in response body.
 * @param {int} [status] optional, status code of response.
 * Only statuses 200, 500, 404 supported by the server.
 * Any other status numbers will default to 200.
 * @param {object} The json object to send in body.
 */
ExpressResponse.prototype.json = function () {
    var args = ExpressResponse.prototype.send.resolveArgs.apply(null, arguments);
    var status = args[0];
    var body = args[1];
    try {
        var json = JSON.stringify(body);
    } catch (err) {
        console.error(
            'ExpressResponse.json:: \'body\' has illegal json format.');
        return;
    }

    this.set('content-type', 'application/json'); //forcing content-type
    var buff = new Buffer(json);
    this.set('content-length', buff.length); //forcing content-length
    this.status(status);
    //sending as Readable stream
    this.send.sendStream(new shared.CustomReadStream(buff));
};

/**
 * Optional method for sending file in response.
 * @param {string} path - path of the file, can be relative to root in options.
 * @param {object} [options] - object with options:
 *  root - root directory for relative filenames.
 *  url - original url of request (for information in deny response).
 * @param {function} [callback] - callback to be called when file finally sent.
 * first argument will be error - if occurred.
 */
ExpressResponse.prototype.sendfile = function () {
    var args = ExpressResponse.prototype.sendfile.resolveArgs.apply(null, arguments);
    var path = args[0].toString(); 
    var options = args[1] || {};
    var userCallback = (typeof(args[2]) === 'function') ? args[2] : function() {};

    if (typeof(options.url) !== 'string') {
        delete options.url;
    }
    var res = this;
    var callback = function (err ,sharedFd) {
        res.__sendFileCallback(err, sharedFd, options.url, userCallback);
    };

    var filePath = (options.root) ? lib.path.resolve(options.root, path) : path;
    res.__setBodyFromFile(filePath, callback);
};
ExpressResponse.prototype.sendfile.resolveArgs = function () {
    var args = [].slice.call(arguments, 0, 3);
    if (args[2] === undefined && typeof(args[1]) === 'function') {
        args[2] = args[1];
        args[1] = undefined;
    }
    return args;
};

/**
 * Callback on 'error' or 'end' event from file stream when file sent with
 * sendFile().
 * @param err - the error object, if occurred.
 * @param {SharedFile} sharedFd - associated shared file descriptor.
 * @param {string} url - the original url of request.
 * @param {function} callback called once the file transfer done (or on error).
 * @private
 */
//on error from sharedFd/stream, on end from stream
ExpressResponse.prototype.__sendFileCallback = function (err ,sharedFd, url, callback) {
    if (err) {
        sharedFd.emit('error', err); //notify waiting requests + remove SharedFile
        console.error('Error while sending file: '.concat(err));
        this.__denyResponse(404,  (url
            ? 'Requested resource URL: '.concat(url)
            : ''));
    }
    callback.call(null, err);
};

/**
 * Chainable method.
 * Sets new cookie to be sent in response.
 * @param {string} name the cookie name.
 * @param {string|object} value - value for the cookie. May be json.
 * @param {object} options - fields for cookie. Addtional options:
 * {maxAge: int} - number of milliseconds for cookie before expiration.
 * Overrides field 'expires'.
 */
ExpressResponse.prototype.cookie = function (name, value, options) {
    var sentOptions = options || {};
    if (typeof(name) !== 'string') {
        console.error(
            'ExpressResponse.cookie():: \'name\' should be a string.');
        return;
    }
    if (typeof(value) !== 'string') {
        try {
            value = JSON.stringify(value);
        } catch (err) {
            console.error('ExpressResponse.cookie():: ' 
            + '\'value\' should be a string or json object.');
            return;
        }
    }
    if (typeof(sentOptions) !== 'object') {
        console.error('ExpressResponse.cookie():: '
            + '\'options\' should be an object.');
        return;
    }
    var age = parseInt(sentOptions.maxAge);
    if (!isNaN(age)) {
        sentOptions.expires = new Date(Date.now() + age).toUTCString();
    }
    if (!sentOptions.path) {
        sentOptions.path = '/'; //default path
    }
    var multiValue = [lib.util.format('%s=%s', name, value)];
    for (var k in sentOptions) {
        if (k == 'maxAge') {continue;}
        if (sentOptions[k] === true) {
            multiValue.push(k);
        } else {
            multiValue.push(lib.util.format('%s=%s', k, sentOptions[k]));
        }
    }
    this.set('set-cookie', multiValue);
    return this;
};

/**
 * Internal implementation of express response object.
 * @param {ExpressResponse} the parent miniExpress response object.
 * @param {ServerResponse} serverResponse underlying miniHTTP response object.
 * @constructor
 */
function EResponse(parent, serverResponse) {
    this.super = parent;
    this.__sResponse = serverResponse;
    this.init(parent, serverResponse);
}


/**
 * Defines redirection functions for use from ExpressResponse instance.
 * All defined functions are internal, they are not part of miniExpress API.
 * Some of them redirected to the EResponse instance.
 * Hides direct access to the underlying objects from ExpressResponse object.
 * @param {ExpressResponse} expressRes - current response object.
 * @param {miniHTTP.ServerResponse} httpRes - underlying server response.
 */
EResponse.prototype.init = function (expressRes, httpRes) {
    var that = this;
    //sends body from Readable stream
    expressRes.send.sendStream = function (bodyStream) {
        that.send.call(that, bodyStream);
    };
    //sends local file in response body.
    expressRes.__setBodyFromFile = function () {
        that.setBodyFromFile.apply(that, arguments);
    };
    //redirects to ServerResponse.denyResponse
    expressRes.__denyResponse = function () {
        that.denyResponse.apply(that, arguments);
    };
    //redirects to ServerResponse.setHeader
    expressRes.__setHeader = function () {
      httpRes.setHeader.apply(httpRes, arguments);
    };

    //redirects to ServerResponse.getHeader
    expressRes.__getHeader = function (name) {
        httpRes.getHeader.call(httpRes, name);
    };
    //access to ServerResponse.statusCode
    expressRes.__statusCode = function (code) {
        if (code) {httpRes.statusCode = code;}
        return httpRes.statusCode;
    }
};

/**
 * Static function.
 * Hardcoded mapping from file extensions and mime types
 * into 'content-type' header property.
 * @param key may be extension of response file, or some keyword for format.
 * Unknown key defaults to text/html.
 * @returns {string} value for 'content-type' property.
 */
EResponse.typeDictionary = function (ext) {
    switch (ext.toLowerCase()) {
        case '.js':
        case 'js':
        case 'javascript':
        case 'application/javascript':
            return 'application/javascript;charset=utf-8';
        case '.css':
        case 'css':
        case 'text/css':
            return 'text/css;charset=utf-8';
        case '.jpg':
        case '.jpeg':
        case 'image/jpeg':
            return 'image/jpeg';
        case '.gif':
        case 'gif':
        case 'image/gif':
            return 'image/gif';
        case 'png':
        case '.png':
        case 'image/png':
            return 'image/png';
        case '.txt':
        case 'plain':
        case 'text/plain':
            return 'text/plain;charset=utf-8';
        case 'octet':
        case '.bin':
            return 'application/octet-stream';
        case 'json':
        case 'application/json':
            return 'application/json';
        /*case '.html':
        case '.htm':
        case 'html':*/
        default:
            return 'text/html;charset=utf-8';
    }
};

/**
 * Sends static file in response body.
 * @param {String} filePath local path to the file.
 * @param {function} callback - will be called on error
 * or once the file transfer done.
 */
EResponse.prototype.setBodyFromFile = function (filePath, callback) {
    var res = this;
    var sharedFd = shared.Application.fdPool[filePath];
    if (sharedFd === undefined) {
        //open new fd
        sharedFd = new shared.SharedFile(filePath);
        shared.Application.fdPool[filePath] = sharedFd;
        res.openFile(sharedFd, callback);
    } else {
        if (sharedFd.size === undefined) {
            //wait for fd to open and then create new stream
            sharedFd.once('ready', function () {
                res.getStream(sharedFd, callback);
            }).once('error', function (err) { //no error loops - 'once' used.
                    callback.call(null, err);
                });
        } else {
            res.getStream(sharedFd, callback);
        }

    }
};

/**
 * Opens new file descriptor for requested file.
 * @param {SharedFile} sharedFd - new instance of SharedFile
 * with path of requested file.
 * @param {function} callback - will be called on error.
 */
EResponse.prototype.openFile = function (sharedFd, callback) {
    var res = this;

    lib.fs.open(sharedFd.path, 'r', function (err, fd) {
        sharedFd.fd = fd;
        res.onFdOpen(err, sharedFd, callback);
    });
};

/**
 * Subroutine of openFile(). Callback for fs.open().
 * @param err - possible error from fs.open.
 * @param {SharedFile} sharedFd - current shared file.
 * @param {function} callback - will be called on error.
 */
EResponse.prototype.onFdOpen = function (err, sharedFd, callback) {
    var res = this;
    if (err) {
        callback.call(null, err, sharedFd);
        return;
    }
    lib.fs.fstat(sharedFd.fd, function (err, stats) {
        res.onFdStat(err, stats, sharedFd, callback);
    });
};

/**
 * Subroutine of onFdOpen(). Callback for fs.fstat().
 * @param err - possible error from fs.fstat().
 * @param {fs.Stats} stats - result from fs.fstat().
 * @param {SharedFile} sharedFd - current shared file.
 * @param {function} callback - will be called on error.
 */
EResponse.prototype.onFdStat = function (err, stats, sharedFd, callback) {
    if (err) {
        callback.call(null, err, sharedFd);
        return;
    }
    sharedFd.size = stats.size;
    this.getStream(sharedFd, callback);
    sharedFd.emit('ready');
};

/**
 * Creates Readable stream on shared file,
 * and sends this stream as response body.
 * @param {SharedFile} sharedFd - shared file for response body.
 * @param {function} callback - will be called on error
 * or once the file transfer done.
 */
EResponse.prototype.getStream = function (sharedFd, callback) {
    var res = this;
    res.__sResponse.setHeader('content-length', sharedFd.size);
    //creating read stream: fd is already open
    var fileStream = lib.fs.createReadStream(null,
        {fd:sharedFd.fd, start:0, autoClose:false});
    sharedFd.count++;
    clearTimeout(sharedFd.timeout); //stop timeout: fd not idle

    fileStream.once('error', function (err) { //critical error
        res.onStreamError(err, sharedFd, callback);
    }).once('end', function () {
            //set timeout on idle fd.
            shared.SharedFile.idleTimer(sharedFd);
            callback.call(null, undefined, sharedFd); //triggering user-defined callback
        });
    res.body = fileStream; //this field used only in onStreamError()
    res.super.type(sharedFd.path);
    res.__sResponse.statusCode = 200;
    res.send(fileStream); //start sending the response
};

//only on error from open file stream
EResponse.prototype.onStreamError = function (err, sharedFd, callback) {
    console.error('Critical error during file stream read: '.concat(err));
    this.body.unpipe(this.__sResponse);
    sharedFd.count--;
    callback.call(null, err, sharedFd);
};

/**
 * Redirects to miniHTTP deny response.
 * Sends response only if wasn't sent yet.
 */
EResponse.prototype.denyResponse = function (responseCode, message) {
    if (this.sent) {return;} //send response only once
    this.sent = true;
    this.__sResponse.denyResponse(responseCode, message);
};

/**
 * Sends Readable stream content as response body.
 * @param {undefined|net.Readable} body - prepared Readable stream with body data.
 * If undefined, then response without body sent.
 */
EResponse.prototype.send = function (body) {
    if (this.sent || (body !== undefined && !(body instanceof lib.Readable))) {
        return;
    }
    this.sent = true;
    if (body) {
        //writing body
        body.pipe(this.__sResponse);
    } else { //empty response without body
        this.__sResponse.end();
    }
};
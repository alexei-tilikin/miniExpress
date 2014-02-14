/*
 * Definition and implementation of miniHTTP.ServerResponse type.
 * Also defines hidden Response type with internal implementation of of server response.
 */

//References to external modules.
var lib = {
    fs: require('fs'),
    path: require('path'),
    querystring: require('querystring'),
    util: require('util'),
    Writable: require('stream').Writable
};
//the shared object with system-scope names
var shared = require('./namespaces').http_namespace;
//define shared objects
shared.ServerResponse = ServerResponse;
shared.Response = Response;

/**
 * Constructor for miniHTTP response object.
 * @param {Response} response the underlying server response.
 * @constructor
 */
function ServerResponse(response) {
    var that = this;
    lib.Writable.call(that);
    that.__response = response;
    //readonly status flag. Synchronized with that.__response.headersSent
    that.headersSent = false;

    //called when socket closed before the stream finished
    function responseClose() {
        that.emit('close');
    }
    response.socket.once('end', responseClose);

    that.once('finish', function () {
        response.socket.removeListener('end', responseClose);
        //HTTP pipelining support
        response.request.nextRequest(response.socket);
    }).once('error', function () {
            //forcing connection close
            that.__response.socket.end();
    });
}
//Response is a Writable stream. The stream consumes the body data for sending.
lib.util.inherits(ServerResponse, lib.Writable);

ServerResponse.prototype.statusCode = 200; //default status code
ServerResponse.prototype.sendDate = true; //default flag for send date in headers

//define & send the headers
ServerResponse.prototype.writeHead = function (statusCode, reasonPhrase, headers) {
    statusCode = parseInt(statusCode);
    if (isNaN(statusCode) || statusCode < 100) {
        throw new TypeError('\'statusCode\' should be a positive integer >= 100');
    }
    if (arguments[2] === undefined) {
        reasonPhrase = undefined;
        headers = arguments[1];
    }
    this.__response.header = headers;
    if (reasonPhrase) {
        this.__response.status.reason = reasonPhrase.toString();
    }
    this.__response.status.code = statusCode;
    this.__response.sendHeader(undefined, this.sendDate);
    this.headersSent = true;
};

/**
 * Sets response header with one or multiple values.
 * @param {string} name name of header.
 * @param {string|Array} [value] value to set for the header.
 * If omitted, then 'true' assumed.
 * If value is array, then all items will be joined
 * and added as properties for the single header in format:
 * 'header: value[0]; value[1]...'
 */
ServerResponse.prototype.setHeader = function (name, value) {
    name = name.toString().toLowerCase();
    if (value === undefined) {
        value = 'true';
    } else if (value instanceof Array) {
        value = value.join(shared.httpTokens.MULTI_SEP);
    } else {
        value = value.toString().toLowerCase();
    }
    
    this.__response.appendHeader(name, value);
};

/**
 * Retrieves value of header with specified name.
 * @param {string} name the name of the field for lookup in headers. Case-insensitive.
 * @returns {string|array|undefined} value of header.
 * If headers already sent or if such header not exists, 
 * then 'undefined' returned.
 * If asked header has multiple representations (like 'set-cookie'),
 * then array of all representations returned.
 * Otherwise, string with header value returned.
 */
ServerResponse.prototype.getHeader = function (name) {
    if (this.__response.sent) {return;} //all headers sent
    return this.__response.header[name.toString().toLowerCase()];
};

/**
 * Deletes header with specified name (if exists).
 * @param {string} name the name of the header to delete.
 */
ServerResponse.prototype.removeHeader = function (name) {
    name = name.toString();
    delete this.__response.header[name];
};

/**
 * Internal function for Writable implementation.
 * @private
 */
ServerResponse.prototype._write = function (chunk, encoding, callback) {
    if (!this.__response.headersSent) { //forcing headers before the body
        this.__response.sendHeader(this.statusCode, this.sendDate);
        this.headersSent = true;
    }
    this.__response.socket.write(chunk, encoding, callback);
};

/**
 * Sets timeout on client connections.
 * Also,sets timeout callback and cancel default activity.
 * By default, after 2 sec timeout, connection is closed.
 * @param {int} msec idle timeout length.
 * @param {function} callback function to call on client connection that idle
 * for the defined time. The callback gets the socket as argument.
 */
ServerResponse.prototype.setTimeout = function (msec, callback) {
    shared.Request.setTimeout(msec, callback, this.__response.socket);
};

/**
 * Additional method.
 * Sends standard deny response with specified information.
 * @param {int} responseCode the response code. Expected to be error code,
 * but 200 will also work.
 * @param {string} message body message in HTML format.
 */
ServerResponse.prototype.denyResponse = function (responseCode, message) {
    this.statusCode = responseCode;
    this.setHeader('content-type', 'text/html;charset=utf-8');
    var body = ['<html><head><title>Message from server</title></head>',
        '<body style="font-family: monospace;"><h1 style="text-align: center">',
        shared.httpTokens.responseCodes[responseCode], ' (', responseCode, ')',
        '</h1><h2>', message,
        '</h2></body></html>'].join('');
    this.setHeader('content-length', body.length);
    this.end(body);
};

/**
 * Constructor for internal response object with hidden implementation.
 * @param {net.Socket} socket current client connection.
 * @param {Boolean} persistent flag for persistent connection.
 * @param {Request} req the request that caused this response.
 * @param {String} ver number of HTTP response version.
 * Legal values are [HTTP/1.0, HTTP/1.1].
 * @constructor
 */
function Response(socket, persistent, req, ver) {
    this.socket = socket;
    this.request = req;
    //the status line
    this.status = {
        ver: ((ver === undefined)? 'HTTP/1.1' : ver)
        //also has response code, reason string (added later)
    };
    this.header = {
        'content-length': 0,
        'connection' : ((persistent) ? 'keep-alive' : 'close')
    };
}

/**
 * Formatter for response status line.
 * @param {Object} status container with status line fields.
 * @returns {String} formatted status line.
 */
Response.formatStatus = function (status) {
    var buff = [];
    for (var m in status) {
        buff.push(status[m]);
        buff.push(shared.httpTokens.SP);
    }
    buff[buff.length - 1] = shared.httpTokens.CRLF;
    return buff.join('');
};

/**
 * Formatter for response header properties.
 * @param {Object} header container with header properties.
 * @returns {String} formatted response header (terminated).
 */
Response.formatHeader = function (header) {
    return lib.querystring.stringify(header,  shared.httpTokens.CRLF,
        shared.httpTokens.DEF).concat(shared.httpTokens.BODY_SEP);
};
//disabling escape when converting objects to string
lib.querystring.escape = function () {
    return arguments[0];
};

/**
 * Support for multiple headers with the same name.
 * Currently supported for 'set-cookie' only.
 * In all other headers, existing value will be overwritten.
 * This functions may not be called if header known to be a single instance.
 * @param {string} name - name of header
 * @param {string} value - pre-formatted string representation for value of header.
 */
Response.prototype.appendHeader = function (name, value) {
    if (name !== 'set-cookie' || this.header[name] === undefined) {
        this.header[name] = value;
    } else if (this.header[name] instanceof Array) {
        this.header[name].push(value);
    } else {
        this.header[name] = [this.header[name], value];
    }
};

/**
 * Formats and joins together status line and header data.
 * @returns {string} formatted header part of response.
 * After this data, the body should follow immediately (if exists).
 */
Response.prototype.dumpHeader = function () {
    return [Response.formatStatus(this.status),
        Response.formatHeader(this.header)].join('');
};

/**
 * Sets response code and reason string.
 * These appear in status line, not in header.
 * @param responseCode HTTP response code.
 */
Response.prototype.setCode = function (responseCode) {
    if (!shared.httpTokens.responseCodes.hasOwnProperty(responseCode)) {
        responseCode = 200; //default response code
    }
    this.status.code = responseCode;
    this.status.reason = shared.httpTokens.responseCodes[responseCode];
};

Response.prototype.sendHeader = function (statusCode, sendDate) {
    this.headersSent = true; //sending the header only once
    if (statusCode !== undefined) {
        this.setCode(statusCode);
    }
    if (sendDate) {
        this.header['date'] = new Date().toUTCString();
    }
    if (!this.header['content-type']) {//setting default content-type
        this.header['content-type'] = 'text/html';
    }
    if (!this.header['content-length']) {
        console.warn(
            'miniHTTP Warning: \'content-length\' not specified.'
                .concat('\r\nSetting to 0.'));
        this.header['content-length'] = '0';
    }
    //writing headers
    this.socket.write(this.dumpHeader());
};

/**
 * Early deny response.
 * Used only for errors with request parsing.
 * Request that sends deny response through this method will never be raised with
 * 'request' event on miniHTTP.
 */
Response.prototype.denyResponse = function (responseCode, message) {
    this.header['content-type'] = 'text/html;charset=utf-8';
    var body = ['<html><head><title>Error occurred</title></head>',
        '<body style="font-family: monospace;"><h1 style="text-align: center">',
        shared.httpTokens.responseCodes[responseCode], ' (', responseCode, ')',
        '</h1><h2>', message,
        '</h2></body></html>'].join('');
    this.header['content-length'] = body.length;
    this.sendHeader(responseCode, true);
    this.socket.end(body); //illegal request assumed: closing the socket
};
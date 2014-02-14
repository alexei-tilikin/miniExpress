/* Submodule of miniExpress.
 * Contains implementation of middlewares.
 */

//References to external modules.
var lib = {
    net: require('net'),
    path: require('path'),
    util: require('util'),
    url: require('url'),
    querystring: require('querystring'),
    miniHTTP: require('./miniHTTP')
};
//the shared object with system-scope names
var shared = require('./namespaces').express_namespace;

var middleware = {};

/**
 * Setting root folder for static GET requests.
 * @param {String} rootFolder server root folder. If rootFolder not a string,
 * then default of current working path will be used.
 * @return {function} the callback function that will create response with
 * static file resource. Returned callback is final: it will send the response,
 * and won't call next().
 */
middleware.static = function (rootFolder) {
    try {
        rootFolder = rootFolder.toString();
    } catch (err) {
        rootFolder = '';
    }
    //security issue: forcing absolute path
    rootFolder = lib.path.resolve(rootFolder);

    return function (req, res, next) {
        var method = req.__method;

        if (method.toLowerCase() !== 'get') { //skip non-GET requests
            next();
            return;
        }
        var filePath = lib.path.resolve(rootFolder, req.__suffix);
        if (filePath.indexOf(rootFolder) !== 0) {
            //Security violation: tried to access beyond the rootFolder tree,
            res.__denyResponse(500,
                'URL falls outside root tree: '.concat(req.path));
        } else {
            res.sendfile(filePath, {url: req.path});
        }
    };
};

/**
 * Middleware for cookie parser from headers of incoming request.
 * @returns {Function} the callback that parses the cookies and puts object with
 * cookie names in req.cookies.
 */
middleware.cookieParser = function () {
    return  middleware.cookieParser.callback;
};

middleware.cookieParser.callback = function (req, res, next) {
    var cookies = req.get('cookie');
    if (!cookies) {
        next();
        return;
    }
    req.cookies = lib.querystring.parse(cookies,
        shared.httpTokens.MULTI_SEP, shared.httpTokens.MULTI_DEF);
    next();
};

/**
 * Middleware for json parser from body of incoming request.
 * No options implemented.
 * @returns {function} the middleware callback that parses stringified json
 * from the request body and puts the object in req.body
 */
middleware.json = function () {
    return middleware.json.callback;
};

middleware.json.callback = function (req, res, next) {
    if (!req.is('application/json')) {
        next();
        return;
    }

    req.__readBody(function() {
        middleware.json.onBody.call(null, req, next);
    });
};

/**
 * Called when the request body totally read into Buffer.
 * @see prepareRequest.readRequestBody().
 */
middleware.json.onBody = function(req, next) {
    if (!req.__bodyBuff) {
        next();
        return;
    }
    try {
        req.body = JSON.parse(req.__bodyBuff.toString());
    } catch (err) {
        console.warn('middleware.json: body is not valid json. Not parsed.');
        req.body = {};
    }
    next();
};

/**
 * Middleware for callback that reads request body and parses data
 * from the FORM POST.
 * @returns {Function} parse request body and puts the parsed object in req.body.
 */
middleware.urlencoded = function () {
    return middleware.urlencoded.callback;
};

middleware.urlencoded.callback = function (req, res, next) {
    if (!req.is('application/x-www-form-urlencoded')) {
        next();
        return;
    }
    req.__readBody(function(bodyBuff) {
        if (!bodyBuff) {next(); return;}
        req.body = lib.querystring.parse(req.__bodyBuff.toString());
        next();
    });
};

/**
 * Middleware for callback that parses request body from either json, or urlencoded
 * formats.
 * @returns {Function} parses request body and produces parsed object in req.body.
 */
middleware.bodyParser = function () {
    return middleware.bodyParser.callback;
};

/* Callbacks json and urlencoded catch different content-types.
 * They can be called one after another without any additional checks.
 * Simulating pseudo-next function to redirect from json() to urlencoded().
 */
middleware.bodyParser.callback = function (req, res, next) {
    middleware.json.callback(req, res, function () {
        middleware.urlencoded.callback(req, res, next);
    });

};

//sharing middlewares
shared.middleware = {
    static: middleware.static,
    cookieParser: middleware.cookieParser,
    json: middleware.json,
    urlencoded: middleware.urlencoded,
    bodyParser: middleware.bodyParser
};
/* Submodule of miniHTTP.
Can be used as standalone module.
 */

//References to external modules.
var lib = {
    util: require('util'),
    stream: require('stream')
};

(function () {
    var namespaces = require('./namespaces');
    //share to miniHTTP namespace
    namespaces.http_namespace.BufferFiller = BufferFiller;
    namespaces.http_namespace.CustomReadStream = CustomReadStream;

//share to miniExpress namespace
    namespaces.express_namespace.BufferFiller = BufferFiller;
    namespaces.express_namespace.CustomReadStream = CustomReadStream;
})();

module.exports = {
    BufferFiller:BufferFiller,
    CustomReadStream: CustomReadStream
};

/**
 * Buffer adapter that allows appending data from the last position.
 * @param {int} capacity - total capacity of the buffer. When capacity reached,
 * onFull called.
 * @constructor
 */
function BufferFiller(capacity) {
    capacity = parseInt(capacity);
    if (!(capacity > 0)) {
        throw "capacity must be positive integer.";
    }
    this.buff = new Buffer(capacity);
    this.pos = 0;
}

/**
 * This function called once the buffer becomes full.
 * It expected to be overridden by the client.
 * @param {String} tail substring of last chunk -
 * the part that not copied into the buffer.
 */
BufferFiller.prototype.onFull = function (tail) {};

/**
 * Appends more data to the buffer from the position of previous chunk end.
 * @param {String} chunk - the data to append to the buffer.
 */
BufferFiller.prototype.append = function (chunk) {
    var written = this.buff.write(chunk, this.pos);
    this.pos += written;
    if (this.pos === this.buff.length) {
        this.onFull(new Buffer(chunk).toString('utf8', written));
    }
};

/**
 * Returns underlying data buffer.
 * @returns {Buffer} the buffer with written data.
 */
BufferFiller.prototype.getBuffer = function () {
    return this.buff;
};

/**
 * Custom readable stream. Provides ReadStream layer over Buffer.
 * @param buff the underlying Buffer with data.
 * @param opt stream options for Readable constructor.
 * @constructor
 */
function CustomReadStream(buff, opt) {
    lib.stream.Readable.call(this, opt);
    this._data = (buff instanceof Buffer) ? buff : new Buffer(buff);
    this._pos = 0;
    this._ended = false;
}
lib.util.inherits(CustomReadStream, lib.stream.Readable);

/**
 * Internal function for custom stream functionality.
 * @param {int} size- number of octets to read.
 * @private
 */
CustomReadStream.prototype._read = function (size) {
    if (this._ended) return;
    if (size === undefined) size = 1;
    size = parseInt(size);
    if (!(size > 0)) return;
    if (this._pos === this._data.length) {
        this.push(null);
        this._ended = true;
        return;
    }
    var end = Math.min(this._pos + size, this._data.length);
    if (!this.push(this._data.slice(this._pos, end))) {
        this._ended = true;
    }
    this._pos = end;
};

/**
 * Getter for length of underlying Buffer.
 * @returns {int} length of data stream in bytes.
 */
CustomReadStream.prototype.length = function () {
    return this._data.length;
};
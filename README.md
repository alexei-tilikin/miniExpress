miniExpress
===========

miniExpress is a custom implementation of Express-like module.
It includes and uses module miniHTTP that implements some API of 
Node HTTP module.
The module miniHTTP can be used independently as alternative to Node http.

Usage:
    var module = require('mini_express');
    var app = module();
    app.use(<callback>);
    ...
    
    var server = app.listen(8080);
    ....
    
    server.close(<callback>); //closing all connections

app.js - sample runner with static mount of everything under 'www' directory.
test/tester.js - the testing suite. 
test/load.js - load test of big amount of simultaneous requests.

#!/usr/bin/env node

var jester  = require('./'),
    fs      = require('fs');

var context = jester.createContext();
context.start();

var args = process.argv.slice(1);

if (args.length < 2) {
    context.repl();
} else {
    fs.readFile(args[1], 'utf8', function(err, source) {
        context.run(source, args[0]);
    });
}

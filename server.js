/**
 * Created by Deny Azzolin on 11/21/21
 */

// some useful tools
var fastify = require('fastify'), //our beloved REST api framework...
    //errors = require('restify-errors'), //a extended collection of restify errors
   // Q = require('q'), //ok, we may not need Q since native Promises are enough...
    debug = require('debug')('Server'), //write useful logging to console for now
    //ip = require('request-ip'), //useful to extract actual IP address from requests
    cluster = require('cluster'), //hey, if we have multiple cores, let's use them...
    uuid = require('uuid'),
    locale = require('locale'),
    os = require('os');

//this is our custom modules
var config = require('./config/config'), //host of a plethora of configuration which should be injected...
    routes = require('./api/routes'), //the actual api routes
    Mongo = require('./model/mongomodel'), //the mongoDB model we do use to hold users, tokens, etc
    Model = require('./model/model'), //the mongoDB model we do use to hold users, tokens, etc
    Auth = require('./api/authenticator');

//vars
var model = null;

async function start() {
    return Promise.resolve(1);
}

async function setupMongo() {
    var the_model = new Model();
    return the_model.initDB();
}

function setupServer() {
    var server = fastify();
    var port = process.env.PORT || config.server.port;
    //server.use(restify.plugins.bodyParser());
    //server.use(restify.plugins.queryParser());
    //server.use(restify.plugins.urlEncodedBodyParser({ mapParams : true }));
    //server.pre(restify.pre.sanitizePath()); // Add this line
    server.addHook('onRequest', (req, res, next) => {
        // set request to host meaningful data across modules
        req.data = {
            model: model,
            session: uuid.v4()
        };
        next();
    });

    //this is just to retrieve the calling IP address, useful for geofencing
    //server.pre(function (req, res, next) {
    //    var iip = ip.getClientIp(req);
    //    if (iip) req.data.ip = iip;
    //    if (req.href() != "/") debug(req.method, req.href(), req.data.session, iip);
    //    next();
    //});

    //this is to ensure we handle language correctly from the incoming request
    //server.pre(function (req, res, next) {
    //    var l = new locale.Locales(req.headers["accept-language"]);
    //    var b = l.best(config.service.locales);
    //    if (!b) b = locale.Locale["default"];
    //    req.data.lang = b;
    //    next();
    //});

    //this is to prepare the request to host geo coordinates, useful for geofencing
    //server.pre(function (req, res, next) {
    //    var loc = req.headers["X-QC-Location"];
    //    if (loc) {
    //        var locd = loc.split('/');
    //        if (locd) {
    //            var location = {};
    //            if (locd[0]) location['lat'] = locd[0];
    //            if (locd[1]) location['lon'] = locd[1];
    //            if (locd[2]) location['acc'] = locd[2];
    //            req.data.location = location;
    //        }
    //    }
    //    next();
    //});

    //includes a function to help set extended error codes
    server.addHook('onRequest', (req, res, next)=> {
        req.setQCHeader = function (resx, code, err, nxt) {
            resx.header("X-QC-ErrorCode", code);
            resx.header("Content-Type", "application/json");
            debug('ERR handler - Http:', err.statusCode, ' QC:', code, req.data.session);
            nxt(err);
        };
        next();
    });

    server.register(require('@fastify/multipart'),{ attachFieldsToBody: 'keyValues' });

    server.register(require('@fastify/formbody'));


    //add the routing 
    routes(server, new Auth(model));

    server.listen({port:port, host:"0.0.0.0"}, function (err, addr) {
        if(err){
            debug('>>> Error starting server', err);
            process.exit(1);
        }
        debug("Server listening at %s", addr);
    });

}

//starting...
debug.log = console.log.bind(console);
debug('> ' + config.server.name);
debug('> ' + config.server.about);
start()
    .then(setupMongo)
    .then((m)=>{
        model = m;
    })
    .then(setupServer)
    .catch(function (e) {
        debug('>> Error starting: ' + (e ? e : 'error unknown'));
    })


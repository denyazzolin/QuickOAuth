const { HostAddress } = require('mongodb');

var header = require('../api/headers'),
    config = require('../config/config'),
    //errors = require('restify-errors'),
    debug = require('debug')('auth'),
    crypto = require('crypto-js'),
    jwt = require('jsonwebtoken'),
    Validator = require('../utils/validator');

function Auth(model) {

    var model = model;
    var val = new Validator();


    function getError (status, code, msg){
        return {
            statusCode:status,
            code:code,
            message:msg
        };
    }

    this.authenticate = function (req, res, next) {
        //get the JWT from the request
        var head = req.headers["authorization"];

        if (head) {
            var token = extractBearer(head, "Bearer");

            if (token) {
                //we should have a JWT here
                val.validate(token)
                    .then((v) => {
                        req.data.jwt = v;
                        next();
                        return;
                    })
                    .catch((e) => {
                        const err = getError(401,'UnauthorizedError', 'Unauthorized. Could not validate authorization token');
                        //var err = new errors.UnauthorizedError('Unauthorized. Could not validate authorization token');
                        next(err);
                        return;
                    })

            } else {
                const err = getError(401,'UnauthorizedError', 'Unauthorized. Could not find authorization token');
                //var err = new errors.UnauthorizedError('Unauthorized. Could not find authorization token');
                next(err);
            }
        } else {
            const err = getError(401,'UnauthorizedError', 'Unauthorized. Could not find authorization token');
            //var err = new errors.UnauthorizedError('Unauthorized. Could not find authorization token');
            next(err);
        }


    }

    this.checkAppId = function (req, res, next) {
        var token = req.headers["authorization"];

        next();
    }

    this.checkAppIdSecret = function (req, res, next) {
        var token = req.headers["authorization"];

        next();
    }

    function extractBearer(head, lookfor) {

        //this should get us "Bearer", "Basic" and the token
        var parts = head.trim().split(" ");
        if (parts && parts.length >= 2) {
            if (parts[0].toLowerCase() == lookfor.toLowerCase()) {
                return parts[1];
            }
        }
        return null;
    }

}

module.exports = Auth;
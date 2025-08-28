const { expressJwtSecret } = require('jwks-rsa');

const { URL } = require('url'),
    debug = require('debug')('validator'),
    jwt = require('jsonwebtoken'),
    jwksClient = require('jwks-rsa'),
    reqbuilder = require('./requestBuilder');


var builder = new reqbuilder();


function Validator() {

    var keysIKnowSince = {};
    var issuersIKnowSince = {};
    const halfday= 12*60*60*100;


    this.validate = async function (token) {

        var jwks_addr = null;
        var iss = null;
        var kid = null;
        var thekey = null;

        //helper functions
        async function getADiscoveryDoc() {
            var options = {
                method: 'GET',
                uri: iss + '.well-known/openid-configuration',
                forceJson: true
            };

            var now = Date.now();
            var i = issuersIKnowSince[iss];
            if (i && i.since) {
                if (now-i.since.getTime()<=halfday) return i.doc;
            } 
            
            var d = await builder.managedRequest(options);
            issuersIKnowSince[iss] = { since: new Date(), doc: d};
            return d;
        }

        async function getAJWKSDoc() {
            var options = {
                method: 'GET',
                uri: jwks_addr, //iss + '/.well-known/jwks.json',
                forceJson: true
            };

            var now = Date.now();
            var ek = {};
            var i = keysIKnowSince[iss];
            if (i && i.easykeys) {
                if (i.easykeys[kid]) return i.easykeys[kid];
            } 

            var d = await builder.managedRequest(options);

            if (d.keys){

                d.keys.forEach((akey) => {
                    ek[akey.kid] = akey.x5c;
                });

                keysIKnowSince[iss] = {easykeys:ek};

                if(ek[kid]) return ek[kid];
                else throw { message: 'kid not found in the doc'};

            } else throw { message: 'no keys in the doc'};
        }


        function buildEasyKeys() {
            return easyKeys;
        }

        async function extraValidations() {
            //add here validation of nbf or any others
            return true;
        }

        async function decodeJWT(thetoken) {
            return jwt.decode(thetoken, { complete: true });
        }

        async function validateJWT() {
            var key = '-----BEGIN PUBLIC KEY-----\n' + thekey + '\n-----END PUBLIC KEY-----';
            return jwt.verify(token, key);
        }

        var p = new Promise((res, rej) => {

            var decodedToken = null;
            var discoveryDoc = null;
            var jwksdoc = null;
            var validatedJwt = null;

            if (token) {

                decodeJWT(token)
                    .then((v) => {
                        decodedToken = v;
                        iss = decodedToken.payload.iss;
                        kid = decodedToken.header.kid;
                    })
                    .then(getADiscoveryDoc)
                    .then((v) => {
                        discoveryDoc = v;
                        jwks_addr = discoveryDoc.jwks_uri;
                    })
                    .then(getAJWKSDoc)
                    .then((v) => {
                        thekey = v;
                    })
                    .then(validateJWT)
                    .then((v) => {
                        validatedJwt = v;
                    })
                    .then(extraValidations)
                    .then((v) => {
                        res(decodedToken);
                    })
                    .catch((e) => {
                        rej(e);
                    });
            } else rej('No token provided');

        });

        return p;

    }




};

module.exports = Validator;
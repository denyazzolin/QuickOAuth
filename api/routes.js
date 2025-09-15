const { SSL_OP_ALL } = require("constants");
const { networkInterfaces } = require("os");
const { nextTick } = require("process");
const { check } = require("./headers");

const
    { URL } = require('url'),
    config = require('../config/config'),
    debug = require('debug')('api'),
    jwt = require('jsonwebtoken'),
    jwksClient = require('jwks-rsa'),
    uuid = require('uuid'),
    reqbuilder = require('../utils/requestBuilder');

var auth = null;
var builder = new reqbuilder();

debug.log = console.log.bind(console);

/**
 * Produce a restify-type error
 * @param {*} status 
 * @param {*} code 
 * @param {*} msg 
 * @returns 
 */
function getErrorItem(status, code, msg) {
    return {
        statusCode: status,
        code: code,
        message: msg
    };
}

/**
 * Yeah we are running
 * @param req
 * @param res
 * @param next
 */
function hello(req, res, next) {
    res.contentType = 'json';
    res.code(200).send({ hello: 'World' });
    next();
}


/**
 * Just a helper to send redirects
 * @param {*} fields a key-value object with the query params of the redirection 
 * @param {*} uri the nodesj URL object with the original redirect uri and query string
 * @param {*} res response obj
 * @param {*} state a state, if informed
 * @param {*} next the next handler
 */
function oAuthRedirect(fields, uri, res, state, next) {
    if (state) fields['state'] = state;
    uri.search = new URLSearchParams(fields).toString();
    res.redirect(302, uri.href, next);
}


/**
 * Produces and signs a JWT
 * @param {*} doc an object with the parameters
 * @param {*} issuer an provider-aware issuer URI (as a string)
 * @param {*} cscopes extended scopes to add
 * @returns a JSON JWT object
 */
function produceJWT(doc, issuer, rt, isAzure) {

    var tk = config.providers[doc.provider].token;
    var keyobj = tk.key;
    var keys = null;
    var use = keyobj.use;

    var ret = {
        access_token: null,
        token_type: "Bearer",
        expires_in: tk.expiration * 60
    }

    if (rt) ret.refresh_token = rt;

    try {

        //depending on the the "use" config, we will direclty use a key or randomly rotate over existing ones
        if (!use) {
            //lets randomly rotate if we have more than one key
            var l = Object.keys(keyobj.keys).length;
            if (l > 0) {
                var idx = Math.random().toFixed(0) * (l - 1);
                use = Object.keys(keyobj.keys)[idx];
            } else use = Object.keys(keyobj.keys)[0]; //the first 

        }
        keys = keyobj.keys[use];

        var custom = {
            client_id: doc.client_id,
            token_type: "access_token",
            sub: doc.userid
        };

        var user = null;

        var base = {
            algorithm: tk.alg,
            expiresIn: tk.expiration * 60,
            audience: doc.client_id,
            issuer: issuer,
            keyid: use,
            jwtid: uuid.v1()
        };

        if (doc.userid) {
            config.collections.user.data.every((u) => { if (u.userid == doc.userid) { user = u; return false; } return true; });
        }

        //addons
        if (doc.scope && !isAzure) custom["claims"] = doc.scope;


        if (user) {
            if (isAzure) {
                base.subject = user.userid;
                custom.first_name = user.firstname;
                custom.last_name = user.lastname;
            }
        }


        if (doc.user_roles && !isAzure) {
            custom["roles"] = doc.user_roles;
        }

        if (isAzure) {
            custom.aud_name = doc.client_id,
                custom.id = doc.userid
            if (doc.user_roles) {
                custom["groups"] = doc.user_roles.split(',');
            }
            base.audience = uuid.v1();
            if (user) custom.upn = user.email;
            delete custom.client_id;
            delete base.jwtid
        }


        var token = jwt.sign(
            custom,
            keys.priv,
            base
        );

        ret.access_token = token;
    } catch (e) {
        debug(e);
        ret = null;
    };

    return ret;
}

/**
 * Authorize an user - OAuth2 call, will always redirect to the login page and then back to redirect_uri (even if not informed)
 * @param {} req 
 * @param {*} res 
 * @param {*} next 
 */
function authorize(req, res, next) {

    //helper functions
    async function doCode() {
        return model.produceAuthCode(doc);
    }

    async function doUpdateCode() {
        if (doc.userid) return model.produceAuthCode(doc);
        else return Promise.resolve(upd);
    }

    async function checkCookie() {
        if (cookie) {
            const cvals = cookie.split('=');
            if (cvals && cvals.length >= 2) {
                debug(cvals);
                if (cvals[0] == 'pf') {
                    var json = Buffer.from(cvals[1], 'base64').toString('utf-8');
                    if (json) {
                        json = JSON.parse(json);
                        return json;
                    }
                }
            }
        }
        return null;
    }


    //get access to extended data in the request
    var model = req.data.model,
        session = req.data.session;

    //data in the request
    var response_type = req.query.response_type ? req.query.response_type.toLowerCase() : null;
    var client_id = req.query.client_id ? req.query.client_id : null;
    var redirect_uri = req.query.redirect_uri ? req.query.redirect_uri : 'http://127.0.0.1:8081/';
    var scope = req.query.scope ? req.query.scope : null;
    var state = req.query.state ? req.query.state : null;
    const cookie = req.headers.cookie;
    var upd = null;

    debug("Authorize: The client id is:" + client_id);

    //prepare redirections
    var redir = null;
    var redir_fields = {};
    try {
        redir = new URL(redirect_uri);
        redir.searchParams ? redir.searchParams.forEach((value, key) => { redir_fields[key] = value }) : {};
    } catch (e) {
        res.code(400).send(getErrorItem(400,'BadRequestError','malformed redirect_uri'));
        //next();
        return;
    }
    var provider = req.params.idp ? req.params.idp : 'default';


    //check for required data
    if (response_type == null || client_id == null) {
        redir_fields['code'] = 'invalid_request';
        oAuthRedirect(redir_fields, redir, res, state, next);
        return;
    }

    //ok, now we have to do several things
    // 1) we need to check if the client_id informed is in our db
    // 2) we need to check if the scopes required (if any) are supported by the client id - we may skip this one for simplicity
    // 3) we need to check if the provider supports code grant 
    // 4) let's check if we have a cookie with a logged user
    // 5) we will redirect to a login page associated with the provider, if no cookie was found
    // 6) if we find a cookie, we will generate a code grant ready to be changed to a token
    // 7) if the login is needed and successfull, we need to generate a code grant associated to the user, provider and scope

    //only authorization code is supported right now
    if (config.providers[provider].grants[response_type]) {

        //ok, let's go ahead and craft a "temporary" authcode
        var doc = {
            client_id: client_id,
            redirect_uri: redirect_uri,
            userid: null,
            provider: provider,
            state: state,
            scope: scope,
            user_roles: null,
            code: null
        };
        var code = null;

        //ok, let's check if we have this client id
        model.findClient(client_id, provider)
            .then((cc) => {
                //we got a client
                //the scopes, if requested, must be compatible
                //the host and path of redirect_uri, if listed in the client, must match
                var aclient = cc.client;
                if (scope) {
                    var s = scope.split(',');
                    if (Array.isArray(s)) {
                        var eligible = true;
                        s.forEach((sc) => { aclient.scopes.indexOf(sc) < 0 ? eligible = false : eligible = eligible; });
                        if (!eligible) throw { code: 'INVALID_SCOPE', err: 'invalid_scope' };
                    } else {
                        //ooops
                        throw { code: 'INVALID_SCOPE', err: 'invalid_scope_format' };
                    }
                } else if (aclient.scopes) doc.scope = aclient.scopes.toString();
            })
            .then(checkCookie)
            .then((c) => {
                if (c) {
                    //yay, we have a user in the cookie
                    //in this case, we do not need the login page
                    //we will update the code and send back to the user
                    doc.userid = c.userid;
                    doc.user_roles = c.roles ? c.roles.toString() : null;
                }
            })
            .then(doCode)
            .then((u) => { upd = u; })
            .then(doUpdateCode)
            .then((v) => {
                doc.code = v.authcode;

                if (!doc.userid) {
                    var login_uri = '/page/login/deliver?code=' + encodeURIComponent(doc.code) + '&idp=' + doc.provider + '&redirect_uri=' + encodeURIComponent(doc.redirect_uri) + '&clientid=' + encodeURIComponent(doc.client_id);
                    //allright, now we only need to redirect to the login page
                    res.redirect(302, login_uri, next);
                } else {
                    //all is set, now we redirect to the informed uri
                    var redir = new URL(redirect_uri);
                    var redir_fields = {};
                    redir.searchParams ? redir.searchParams.forEach((value, key) => { redir_fields[key] = value }) : {};

                    redir_fields['code'] = doc.code;
                    oAuthRedirect(redir_fields, redir, res, state, next);
                }
            })
            .catch((e) => {
                if (e && e.code) redir_fields['code'] = e.err;
                else redir_fields['code'] = 'server_error';
                oAuthRedirect(redir_fields, redir, res, state, next);
            });

    } else {
        redir_fields['code'] = 'unsupported_response_type';
        oAuthRedirect(redir_fields, redir, res, state, next);
        return;
    }

}

/**
 * Deliver a page from an existing provider
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 */
function deliverPage(req, res, next) {

    //get access to extended data in the request
    var model = req.data.model,
        session = req.data.session;

    //data in the request
    var page = req.params.page ? req.params.page : 'notfound';
    var code = req.query.code ? req.query.code : null;
    var client_id = req.query.clientid ? req.query.clientid : "Unspecified";
    var redirect_uri = req.query.redirect_uri ? req.query.redirect_uri : 'https://127.0.0.1:8081/';
    var provider = req.query.idp ? req.query.idp : 'default';
    var accounts = req.query.acc ? req.query.acc : null;
    var account_content = "";

    var the_uri = (provider != 'default' ? '/idp/' + provider : '') + '/' + page;
    var the_page = config.providers[provider].grants["code"][page];

    debug("Deliver: The client id is:" + client_id);

    //treat accounts list, if informed
    if (accounts) {
        //some very misplaced map of account types
        var ac_type = {
            "QC_OPS": 'glyphicon glyphicon-user',
            "VENDOR": 'glyphicon glyphicon-usd'
        }

        var items = accounts.split(','); //get the individual accounts
        debug(items);
        items.forEach((i, idx) => { items[idx] = i.split(';') }); //get the item parts
        items.forEach((i) => {
            account_content += "<div>"
                + "  <button type=\"button\" class=\"btn btn-default btn-lg\"  onclick=\"sel(" + i[0] + ")\">"
                + "   <span class=\"glyphicon glyphicon-user\" aria-hidden=\"true\"></span>" + i[1];
            + "   </button>"
                + "</div>";

        });

    }


    //let's replace what we have to in the login page
    var replaces = [
        { fragment: '$LOGIN', value: the_uri },
        { fragment: '$CODE', value: code },
        { fragment: '$IDP', value: provider },
        { fragment: '$REDIRECT_URI', value: redirect_uri },
        { fragment: '$ACCOUNTS', value: account_content },
        { fragment: '$CLIENTID', value: client_id }
    ];
    replaces.forEach((pair) => { var s = the_page.replace(pair.fragment, pair.value); the_page = s });

    //allright, let's deliver the page and hope for the best...
    res.header("Content-Type", "text/html");
    res.header("Content-Length", the_page.length );
    res.code(200);
    res.raw.end(the_page);
    //next();

}


/**
 * OAuth2.0 token endpoint
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 * @returns 
 */
function token(req, res, next) {

    //helper functions
    function returnError(type, code, message) {
        var msg = {
            error: code,
            error_description: message
        };
        return msg;
    }



    //different grants functions
    async function processGrants() {
        return grantProcessor[type].processFunction();
    }

    async function doAuthCode() {

        var acode = null;

        async function produceARefresh() {
            debug(acode);
            if (config.providers[acode.provider].grants["authorization_code"].produce_refresh) {
                return model.produceRefreshToken(acode.code, acode.client_id, acode.provider, acode.redirect_uri, acode.state);
            }
            else return null;
        }

        function setCookie(obj) {
            const val = JSON.stringify(obj);
            const b = Buffer.from(val, 'utf-8').toString('base64');
            res.header('Set-Cookie', 'acc=' + b + '; Max-Age=1200;');
            debug('Set-Cookie', 'acc=' + b + '; Max-Age=1200;');
        }

        var p = new Promise((resolve, reject) => {

            model.findAuthCode(code)
                .then((c) => {
                    //debug(">>");
                    debug(c);
                    var now = new Date();
                    //we got an auth code, let's check its expiration, state, client_id and redirect_uri
                    //and if the informed scopes are all in the list
                    if ((c.doc.client_id == client_id) &&
                        (c.doc.expiration - now >= 0) &&
                        (c.doc.redirect_uri == redirect_uri) &&
                        (c.doc.state == state) &&
                        (c.doc.status == 1)) {

                        var scopeok = true;
                        var finalscope = [];
                        if (scope) {
                            //informes scopes should only reduce the list
                            if (c.doc.scope) {
                                var sc = scope.split(',');
                                sc.forEach((se) => {
                                    if (c.doc.scope.indexOf(se) >= 0) {
                                        finalscope.push(se);
                                    } else scopeok = false;
                                });
                                c.doc.scope = finalscope.toString();
                            }
                        }

                        if (!scopeok) {
                            reject({ action: false, code: 'INVALID_SCOPE', err: returnError("400", "invalid_scope", "scopes are a mismatch") });
                        } else acode = c.doc;

                    } else {
                        reject({ action: false, code: 'INVALID_GRANT', err: returnError("400", "invalid_grant", "autch code is not valid") });
                    }
                })
                .then(produceARefresh)
                .then((rt) => {
                    //debug(">>>");
                    debug(rt);
                    //ok, now we need to produce the jwt!!!
                    var pr = config.providers[provider];
                    var j = produceJWT(acode, addr, rt.refresh_code, pr.token.isAzure);
                    if (j) {
                        //set the access token cookie!!
                        setCookie(j.access_token);
                        resolve(j);
                    }
                    else reject({ action: false, code: 'ERROR', err: returnError("500", "error", "could not produce a jwt") });
                })
                .catch((e) => {
                    reject(e);
                })
        });

        return p;
    }

    async function doToken() {
        var p = new Promise((resolve, reject) => {
            reject({ action: false, code: 'UNSUPPORTED', err: returnError("400", "unsupported_grant_type", "can't do this grant") })
        });
        return p;
    }

    async function doPassword() {
        var p = new Promise((resolve, reject) => {
            reject({ action: false, code: 'UNSUPPORTED', err: returnError("400", "unsupported_grant_type", "can't do this grant") })
        });
        return p;
    }

    async function doClientCreds() {
        var p = new Promise((resolve, reject) => {
            //we already authenticated the client, so we will just produce a JWT
            var doc = {
                provider: provider,
                client_id: client_id,
                userid: null
            }

            var j = produceJWT(doc, addr);
            if (j) resolve(j);
            else reject({ action: false, code: 'ERROR', err: returnError("500", "error", "could not produce a jwt") });
        });
        return p;

    }

    async function doRefreshToken() {
        var p = new Promise((resolve, reject) => {

            //let's look for an refresh token. if found, we will then fetch the associated authcode and produce a JWT out of it
            model.findRefreshToken(refresh_token)
                .then((r) => {
                    debug(r);
                    code = r.refresh_token.code;
                    client_id = r.refresh_token.client_id;
                    redirect_uri = r.refresh_token.redirect_uri;
                    state = r.refresh_token.state
                })
                .then(doAuthCode)
                .then((j) => {
                    resolve(j);
                })
                .catch((e) => {
                    reject({ action: false, code: e.code, err: e.err });
                })
        });
        return p;

    }


    //get access to extended data in the request
    var model = req.data.model,
        session = req.data.session;

    //authorization is necessary
    var basicauth = req.headers["authorization"];
    var authdata = null;

    //data in the request
    var grant_type = req.body.grant_type ? req.body.grant_type.toLowerCase() : null;
    var response_type = req.body.response_type ? req.body.response_type.toLowerCase() : null;
    var client_id = req.body.client_id ? req.body.client_id : null;
    var redirect_uri = req.body.redirect_uri ? req.body.redirect_uri : 'http://127.0.0.1:8081/';
    var code = req.body.code ? req.body.code : null;
    var scope = req.body.scope ? req.body.scope : null;
    var username = req.body.username ? req.body.username : null;
    var password = req.body.password ? req.body.password : null;
    var state = req.body.state ? req.body.state : null;
    var refresh_token = req.body.refresh_token ? req.body.refresh_token : null;
    var client_scopes = null;

    debug("Token: The client id is:" + client_id);
    debug("Token: The redirect uri is:" + redirect_uri);

    //we need to look for the distinction between grant_type and response_type
    //this is one of failures of this standard since a response_type is for a GET, not POST :)
    //grant_type takes precedence if both are informed
    var type = grant_type ? grant_type : response_type;

    //the provider
    var provider = req.params.idp ? req.params.idp : 'default';
    var addr = 'http://' + req.headers.host + (req.params.idp ? '/idp/' + req.params.idp : '/');

    //help decide what to do later on, depending on grant_type
    var grantProcessor = {
        "authorization_code": {
            requiredFields: [code, redirect_uri, client_id],
            processFunction: doAuthCode
        },
        "token": {
            requiredFields: [client_id],
            processFunction: doToken
        },
        "password": {
            requiredFields: [username, password],
            processFunction: doPassword
        },
        "client_credentials": {
            requiredFields: [],
            processFunction: doClientCreds
        },
        "refresh_token": {
            requiredFields: [refresh_token],
            processFunction: doRefreshToken
        }
    }


    //authdata is always necessary (well, except if this was a "token" grant)
    if (basicauth) {
        var authdata = [];
        var raw = basicauth.replace('Basic', '').replace('basic', '').trim();
        raw = (Buffer.from(raw, 'base64')).toString('utf-8');

        var l = raw.lastIndexOf(":");

        if (l != -1) {
            authdata[0] = raw.substring(0, l);
            authdata[1] = raw.substring(l + 1)
        }
    } else {
        //stop here
        res.code(401).send(returnError("401", "invalid_client", "Authorization failed"));
        //next();
        return;
    }


    //now lets process what is basic for all grants....
    if (type) {

        //check required fields
        var fields = grantProcessor[type].requiredFields;
        var err = 0;
        fields.forEach((data) => { err = data ? err++ : err });

        if (err == 0) {

            //check if the authentication (client id and secret) matches
            model.checkClient(authdata[0], authdata[1], provider)
                .then((c) => {
                    client_scopes = c.client.scopes;
                })
                .then(processGrants) //here we shift the code to treat each (supported) grant
                .then((j) => {
                    //the successful return should be a well-formed oauth response
                    res.code(200).send(j);
                    //next();
                })
                .catch((e) => {
                    debug(e);
                    var erm = 'generic_error'
                    var hc = 400;
                    if (e.code == 'AUTHCODE_NOT_FOUND') erm = 'invalid_grant';
                    else if (e.code == 'CLIENT_SECRET_NOT_MATCH') erm = 'invalid_client';
                    else if (e.code == 'CLIENT_NOT_FOUND') erm = 'unauthorized_client';
                    else if (e.code == 'INVALID_GRANT') erm = 'invalid_grant';
                    else if (e.code == 'UNSUPPORTED') erm = 'unsupported_grant_type';
                    else if (e.code == 'INVALID_SCOPE') erm = 'invalid_scope';
                    else if (e.code == 'ERROR') {
                        erm = 'error';
                        hc = 500;
                    }
                    res.code(500).send(returnError("500", erm, e.err));
                    //next();
                })



        } else {
            //oops, 400
            res.code(400).send(returnError("400", "invalid_request", "required fields are missing"));
            //next();
        }


    } else {
        //oops, 400
        res.code(400).send(returnError("400", "invalid_request", "required grant type or response type fields are missing"));
        //next();
    }

}

/**
 * Delivers the hoem page of th embedded identity app
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 */
function identityApp(req, res, next) {
    //here we will do the loopback with the token endpoint and deliver the 
    res.code(200).send({ hello: "authorize" });
    //next();
}

/**
 * Updates or adds an user to the identity pool
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 */
function addUpdateUser(req, res, next) {
    res.code(200).send({ hello: "authorize" });
    //next();
}

/**
 * Get user profile based on the params or "self", based on sub claim on the JWT
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 */
function getUser(req, res, next) {
    res.code(200).send({ hello: "authorize" });
    //next();
}

/**
 * removes an uses
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 */
function delUser(req, res, next) {
    res.code(200).send({ hello: "authorize" });
    //next();
}


/**
 * Logs a user against the identity pool, serves out account profile pages as well
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 */
function login(req, res, next) {
    //get access to extended data in the request
    var model = req.data.model,
        session = req.data.session;

    async function verify() {
        return model.verifyUser({ userid: username, password: password, provider: provider });
    }

    async function updateAuthCode() {
        return model.produceAuthCode(authcode);
    }

    async function checkForExtendedRoles() {
        return model.retrieveExtraRoles(authcode.userid, authcode.provider);
    }

    function setCookie(obj) {
        const val = JSON.stringify(obj);
        const b = Buffer.from(val, 'utf-8').toString('base64');
        res.header('Set-Cookie', 'pf=' + b + '; Max-Age=1200;');
    }


    //the authcode is the link between the calls
    var code = req.body.code ? req.body.code : null;
    var authcode = null;

    //const data = await req.file();

    //we need these in order to return to this login page in case of not being able to fetch the auth code
    // var username = req.params.username ? req.params.username : null;
    //var password = req.params.password ? req.params.password : null;
    //var client_id = req.body.clientid ? req.body.clientid : null;

    var username = req.body.username ? req.body.username : null;
    var password = req.body.password ? req.body.password : null;
    var client_id = req.body.clientid ? req.body.clientid : null;
    var provider = req.params.idp ? req.params.idp : 'default';
    var state = req.body.state ? req.body.state : null;
    var redirect_uri = req.body.redirect_uri ? req.body.redirect_uri : 'http://127.0.0.1:8081/';


    if (code && username) {
        var user = null;
        //well, first of all, we need to try to get the code back
        model.findAuthCode(code)
            .then((c) => {
                //yay, we got it
                authcode = c.doc;

                //we will rewrite the other page params from the stored access code
                provider = authcode.provider ? authcode.provider : provider;
                state = authcode.state ? authcode.state : state;
                redirect_uri = authcode.redirect_uri ? authcode.redirect_uri : redirect_uri;

                debug('We got the authcode done');
                debug('Login: the client id embedded on teh auth code is' + authcode.client_id);
                debug(authcode);

            })
            .then(verify) //verify if the user and password do match
            .then((c) => {
                //yay, we got a match, now we have to update the authcode in the db
                authcode.userid = c.user.userid;
                authcode.user_roles = c.user.roles ? c.user.roles.toString() : null;
                //set the session cookie
                setCookie(c.user);
                debug('user verification happened, cookie set');

            })
            .then(updateAuthCode)
            .then((c) => {
                debug('We have updated the authcode');
                debug(c);
            })
            .then(checkForExtendedRoles)
            .then((r) => {
                //we may have  got extra roles
                debug('We checked for extra roles');
                debug(r);
                if (r && r.roles && r.roles.length > 0) {
                    //ha, we got extra roles, so we may want to ask if the user wants to apply them
                    var acc = ['-1;Continue with base account type'];
                    r.roles.forEach((rr) => { acc.push(rr._id + ';' + rr.title) });
                    var acc_field = acc.toString();
                    var login_uri = '/page/account/deliver?code=' + encodeURIComponent(code) + '&idp=' + provider + '&redirect_uri=' + encodeURIComponent(redirect_uri) + '&acc=' + encodeURI(acc_field) + (state ? '&state=' + state : '') + "&clientid=" + encodeURIComponent(client_id);
                    res.redirect(302, login_uri, next);
                    throw { action: false, code: 'NOT_AN_ERROR', err: '' };
                } else {
                    debug('here');
                    //all is set, now we redirect to the informed uri
                    var redir = new URL(redirect_uri);
                    var redir_fields = {};
                    redir.searchParams ? redir.searchParams.forEach((value, key) => { redir_fields[key] = value }) : {};

                    redir_fields['code'] = code;
                    oAuthRedirect(redir_fields, redir, res, state, next);
                }
            })
            .catch((e) => {
                debug(e);
                if (e && e.code != 'NOT_AN_ERROR') {
                    //let's send people back to a login page, with the abstracted error codes
                    var login_uri = '/page/login/deliver?code=' + encodeURIComponent(code) + '&idp=' + provider + '&redirect_uri=' + encodeURIComponent(redirect_uri) + '&error=' + e.code + '&err_msg=' + encodeURIComponent(e.err) + (state ? '&state=' + state : '') + "&clientid=" + encodeURIComponent(client_id);
                    res.redirect(302, login_uri, next);
                }
            })

    } else {
        var login_uri = '/page/login/deliver?code=' + encodeURIComponent(code) + '&idp=' + provider + '&redirect_uri=' + encodeURIComponent(redirect_uri) + '&error=-9&err_msg=' + encodeURIComponent('Missing internal authorization data') + (state ? '&state=' + state : '') + "&clientid=" + encodeURIComponent(client_id);
        res.redirect(302, login_uri, next);
    }

}


/**
 * just retrieve accounts
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 */
function account(req, res, next) {
    //get access to extended data in the request
    var model = req.data.model,
        session = req.data.session;

    async function verify() {
        return model.verifyUser({ userid: username, password: password, provider: provider });
    }

    async function updateAuthCode() {
        if (authcode.stat != 0)
            return model.produceAuthCode(authcode);
        else return null;
    }

    async function checkForExtendedRoles() {
        if (acc_id != '-1')
            return model.retrieveExtraRoles(authcode.userid, authcode.provider);
        else return null;
    }



    //the authcode is the link between the calls
    var code = req.body.code ? req.body.code : null;
    var authcode = null;

    //we need these in order to return to this login page in case of not being able to fetch the auth code
    var provider = req.params.idp ? req.params.idp : 'default';
    var state = req.body.state ? req.body.state : null;
    var redirect_uri = req.body.redirect_uri ? req.body.redirect_uri : 'http://127.0.0.1:8081/';
    var acc_id = req.body.acc_id ? req.body.acc_id : null;
    var extra_roles = null;

    debug({
        code: code,
        provider: provider,
        redirect_uri: redirect_uri,
        acc_id: acc_id,
        state: state
    });

    var user = null;
    //well, first of all, we need to try to get the code back
    model.findAuthCode(code)
        .then((c) => {
            //yay, we got it
            authcode = c.doc;

            //we will rewrite the other page params from the stored access code
            provider = authcode.provider ? authcode.provider : provider;
            state = authcode.state ? authcode.state : state;
            redirect_uri = authcode.redirect_uri ? authcode.redirect_uri : redirect_uri;
            authcode.stat = 0;

        })
        .then(checkForExtendedRoles)
        .then((r) => {
            //we should have got extra roles
            if (r && r.roles) {
                if (r.roles.length > 0) {
                    extra_roles = r.roles.find((e) => { return e.role_set == parseInt(acc_id) });
                    authcode.user_roles = extra_roles.roles.toString();
                    authcode.stat = 1;
                }
            }
        })
        .then(updateAuthCode)
        .then((v) => {
            //all is set, now we redirect to the informed uri
            var redir = new URL(redirect_uri);
            var redir_fields = {};
            redir.searchParams ? redir.searchParams.forEach((value, key) => { redir_fields[key] = value }) : {};

            redir_fields['code'] = code;
            oAuthRedirect(redir_fields, redir, res, state, next);
        })
        .catch((e) => {
            //let's send people back to the page, with the abstracted error codes
            var login_uri = '/page/account/deliver?code=' + encodeURIComponent(code) + '&idp=' + provider + '&redirect_uri=' + encodeURIComponent(redirect_uri) + '&error=' + e.code + '&err_msg=' + encodeURIComponent(e.err) + (state ? '&state=' + state : '');
            res.redirect(302, login_uri, next);
        })

}

/**
 * OIDC well-known jwks url endpoint
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 */
function getJWKS(req, res, next) {
    //get access to extended data in the request
    var model = req.data.model,
        session = req.data.session;
    var p = req.params.idp ? req.params.idp : 'default';

    var jwks = {
        keys: []
    };
    var provider = config.providers[p];
    if (provider) {
        for (var k in provider.token.key.keys) {
            if (provider.token.key.keys.hasOwnProperty(k)) {

                var key = provider.token.key.keys[k];
                var keyf = {
                    alg: provider.token.alg,
                    kty: provider.token.kty,
                    use: "sig",
                    kid: k,
                    x5c: []
                };

                //for x5c, trim all newlines, headers, etcof pub key
                var temp = key.pub.replace('-----BEGIN PUBLIC KEY-----', '').replace('-----END PUBLIC KEY-----', '').trim();
                keyf.x5c.push(temp);
                jwks.keys.push(keyf);
            }
        }
    }


    res.code(200).send(jwks);
    //next();
}


/**
 * Return the user profile associated to the JWT in the Authorization header
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 */
function getMe(req, res, next) {
    //get access to extended data in the request
    var model = req.data.model,
        session = req.data.session;
    var p = req.params.idp ? req.params.idp : 'default';  //despite what the JWT says, we will look for the user base in the provider
    var j = (req.data ? (req.data.jwt ? req.data.jwt : null) : null);

    if (j) {

        //okay we have a JWT...but does it have the proper claims to call this function?
        if (j.payload && j.payload.claims && j.payload.claims.indexOf('profile') >= 0) {

            //alright, let's find the user
            model.findUser(j.payload.sub, p)
                .then((v) => {
                    //we found an user
                    var usr = {
                        userid: j.payload.sub,
                        firstname: v.user.firstname,
                        lastname: v.user.lastname,
                        roles: j.payload.roles
                    };

                    res.code(200).send(usr);
                    //next();
                })
                .catch((e) => {
                    res.code(500).send(getErrorItem(500,'Server condition','Could not find the user'));
                    //next();
                })

        } else {
            res.code(401).send(getErrorItem(401, 'Unauthorized','Not enough claims'));
            //next();
        }

    } else {
        res.code(401).send(getErrorItem(401, 'Unauthorized','JWT not present'));
        //next();
    }

}


/**
 * OIDC well-known discover document
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 * @returns 
 */
function getConfig(req, res, next) {
    //get access to extended data in the request
    var model = req.data.model,
        session = req.data.session;
    var p = req.params.idp;
    var provider = null;
    var addr = 'http://' + req.headers.host + (p ? '/idp/' + p + '/' : '/');

    if (p) {
        provider = config.providers[p];
        if (!provider) {
            res.send(404, 'Configuration not found');
            next();
            return;
        }
    } else provider = config.providers['default'];


    var openconfig = {
        issuer: addr,
        authorization_endpoint: addr + 'authorize',
        token_endpoint: addr + 'token',
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        jwks_uri: addr + '.well-known/jwks.json'
    };

    res.code(200).send(openconfig);
    //next();
}


/**
 * Just a tool that analizes the incoming JWT as a header or query param
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 */
function sampleValidator(req, res, next) {

    //helper functions
    async function getADiscoveryDoc() {
        var options = {
            method: 'GET',
            uri: addr + '.well-known/openid-configuration',
            forceJson: true
        };
        return await builder.managedRequest(options);
    }

    async function getAJWKSDoc() {
        var options = {
            method: 'GET',
            uri: decodedtoken.payload.iss + '.well-known/jwks.json',
            forceJson: true
        };
        debug(options);
        return await builder.managedRequest(options);
    }

    function redirectTo(place) {
        res.redirect(302, place, next);
    }

    function returnAuthTokenFromRequest() {
        if (!thetoken) {
            var raw = req.headers["authorization"] ? req.headers["authorization"] : null;
            if (!raw) {
                raw = req.query.authorization ? req.query.authorization : null; //no token in the auth header, let's try the query string
                token_source = '<span class="label label-primary">from a query field</span>'
            } else token_source = '<span class="label label-success">from authorization header</span>'
            if (raw) raw = raw.replace('Bearer', '').replace('bearer', '').trim();
            return raw;
        } else {
            token_source = '<span class="label label-default">Inline from a TOKEN endpoint call</span>'
            return thetoken;
        }
    }

    function decodeJWT() {
        return jwt.decode(thetoken, { complete: true });
    }

    function validateJWT() {
        var key = '-----BEGIN PUBLIC KEY-----\n' + easykeys[decodedtoken.header.kid] + '\n-----END PUBLIC KEY-----';
        return jwt.verify(thetoken, key);
    }

    async function doToken() {
        if (code) {
            //prep the fields and headers
            var fields = {};
            var cc = getClientId(clientid);

            fields["grant_type"] = 'authorization_code';
            fields["code"] = code;
            fields["client_id"] = cc.clientid;// client_data[provider].client;
            fields["redirect_uri"] = encodeURI(here);

            var headers = { authorization: cc.auth }; //client_data[provider].auth

            var options = builder.build('POST', oauthconfig.token_endpoint, null, fields, true, headers);

            return await builder.managedRequest(options);

        } else return false;
    }

    function writeStuff() {

        var auth_source = '<p>The token was sourced ' + token_source + '</p><br><small>' + thetoken + '</small>';
        var valid = '<h4><span class="label label-success">Success</span></h4><br>' + JSON.stringify(val, null, 2);

        var page = config.myapp.pages.validator;
        var the_config = JSON.stringify(oauthconfig, null, 2);
        var the_decoded = JSON.stringify(decodedtoken, null, 2);
        var the_keys = JSON.stringify(actualkeys, null, 2);
        var the_token = access_token ? access_token : '';
        var the_valid = valid;

        //some markings
        the_config = the_config.replace("\"jwks_uri\"", "<mark>\"jwks_uri\"</mark>");
        the_keys = the_keys.replace("\"kid\"", "<mark>\"kid\"</mark>");
        the_decoded = the_decoded.replace("\"kid\"", "<mark>\"kid\"</mark>");

        page = page.replace('$Z01', auth_source);
        page = page.replace('$Z02', the_decoded);
        page = page.replace('$Z03', the_keys);
        page = page.replace('$Z04', the_valid);
        page = page.replace('$Z00', the_config);
        page = page.replace('$Z05', the_token);

        page = page.replace("\"kid\"", "<mark>\"kid\"</mark>");



        if (token_call) {
            page = page.replace('$Z300', JSON.stringify(token_call, null, 2));
            page = page.replace('$CC', code);
            page = page.replace('display:none', 'display:block');
        }

        res.header("Content-Type", "text/html");
        res.header("Content-Length", page.length );
        res.code(200);
        res.raw.end(page);
        //next();
    }

    function getClientId(id) {

        var theclient = null;
        config.collections.client.data.every((c) => { if (c.clientid == id) { theclient = c; return false; } return true; })
        theclient.auth = "Basic " + Buffer.from(theclient.clientid + ":" + theclient.secret).toString('base64');
        debug(theclient);

        return theclient;

    }

    //this is just a helper, a true client should have these as injected data
    var client_data = {
        "default": {
            client: "spiffe://homedepot.com/recipe"
        },
        "mesa": {
            client: "SIMPLE"
        }
    };

    var provider = req.params.idp ? req.params.idp : 'default';
    var p = (provider == 'default' ? null : provider);
    var addr = 'http://' + req.headers.host + (p ? '/idp/' + p + '/' : '/');
    var myself = 'http://' + req.headers.host + req.url;
    var clientid = req.query.clientid ? req.query.clientid : client_data[provider].client;
    var access_token = null;

    //handle token endpoint afterwards
    var code = req.query.code ? req.query.code : null;

    //prepare to get back to here, without a reference to an auth code
    var here = null;
    var redir_fields = "";
    here = new URL(myself);
    here.searchParams ? here.searchParams.forEach((value, key) => {
        if (key != "code") {
            if (redir_fields.length > 0) redir_fields += "&";
            redir_fields += key + "=" + decodeURIComponent(value);
        }
        debug(">>" + redir_fields);
    }) : {};
    here.search = redir_fields;//new URLSearchParams(redir_fields).toString();
    debug(">>" + here.search);

    var oauthconfig = null;
    var thetoken = null;
    var decodedtoken = null;
    var actualkeys = null;
    var easykeys = {};
    var token_source = {};
    var token_call = null;


    debug("Validator: The client id is:" + clientid);

    //the flow here should be
    // - check if we have any auth data
    // --- if not, try to figure out the provider by the URI
    // --- get the discovery doc of the provider
    // --- got to the authorization endpoint, redirecting back to here
    // - If we have a CODE query field
    // --- try to figure out the provider by the URI
    // --- get the dicovery doc of teh provider
    // --- run the TOKEN endpoint with teh client creds embedded here
    // --- decode the resulting JWT
    // --- go to the JWKS uri from the iss data, fetch the keys
    // --- validate the JWT
    // -  If we have a authorization query field with a JWT
    // --- decode the JWT
    // --- go to the JWKS uri from the iss data, fetch the keys
    // --- validate the JWT

    getADiscoveryDoc()
        .then((disc) => {
            //we got a discovery document from the informed provider
            oauthconfig = disc;
        })
        .then(doToken)
        .then((t) => {
            if (t) {
                thetoken = t.access_token;
                access_token = thetoken;
                token_call = t;
            }
        })
        .then(returnAuthTokenFromRequest)
        .then((tk) => {
            thetoken = tk;
            var cc = getClientId(clientid).clientid;
            if (!thetoken) {
                //go to authorization endpoint with the proper setup
                var there = null;
                var auth_fields = {};
                there = new URL(oauthconfig.authorization_endpoint);
                auth_fields["response_type"] = "code";
                auth_fields["client_id"] = cc;//client_data[provider].client;
                auth_fields["redirect_uri"] = here.href;//encodeURI(here.href);

                oAuthRedirect(auth_fields, there, res, null, next);
                throw { action: false, code: 'NOT AN ERROR', err: 'redirect to authorization endpoint' };
            } else debug('skipping, we got a token already');
        })
        .then(decodeJWT)
        .then((j) => {
            decodedtoken = j;
        })
        .then(getAJWKSDoc)
        .then((k, r) => {
            //we got the keys
            actualkeys = k;
            actualkeys.keys.forEach((akey) => {
                easykeys[akey.kid] = akey.x5c;
            });
        })
        .then(validateJWT)
        .then((v) => {
            //we got a verified jwt!
            val = v;
        })
        .then(writeStuff)
        .catch((e) => {
            if (e && e.code == 'NOT AN ERROR') {
                debug('redirect to auhtorization');
            } else {
                debug("Error!");
                debug(e);
                res.code(400).send(e);
                //next();
            }
        })

}


function delivePreflight(req, res, rext) {

    var origin = req.headers.origin;

    if (!origin) origin = 'http://127.0.0.1:' + config.server.port;
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET,POST');
    res.header('Access-Control-Allow-Headers', 'Origin, Authorization');
    res.code(200).send();
}

//exports the API routes
module.exports = function (server, au) {

    auth = au;

    //Oauth2 base

    server.route({
        method: 'GET',
        url: "/authorize",
        preHandler:[auth.checkAppId],
        handler: authorize
    });

    server.route({
        method: 'POST',
        url: "/token",
        preHandler:[auth.checkAppIdSecret],
        handler: token
    });

    server.route({
        method: 'GET',
        url: "/.well-known/jwks.json",
        handler: getJWKS
    });

    server.route({
        method: 'GET',
        url: "/.well-known/openid-configuration",
        handler: getConfig
    });


    //server.get("/authorize", auth.checkAppId, authorize);
    //server.post("/token", auth.checkAppIdSecret, token);
    //server.get("/.well-known/jwks.json", getJWKS);
    //server.get("/.well-known/openid-configuration", getConfig);

    //...with indicated provider

    server.route({
        method: 'GET',
        url: "/idp/:idp/authorize",
        preHandler:[auth.checkAppId],
        handler: authorize
    });

    server.route({
        method: 'POST',
        url: "/idp/:idp/token",
        preHandler:[auth.checkAppIdSecret],
        handler: token
    });

    server.route({
        method: 'GET',
        url: "/idp/:idp/.well-known/jwks.json",
        handler: getJWKS
    });

    server.route({
        method: 'GET',
        url: "/idp/:idp/.well-known/openid-configuration",
        handler: getConfig
    });

    //server.get("/idp/:idp/authorize", auth.checkAppId, authorize);
    //server.post("/idp/:idp/token", auth.checkAppIdSecret, token);
    //server.get("/idp/:idp/.well-known/openid-configuration", getConfig);
    //server.get("/idp/:idp/.well-known/jwks.json", getJWKS);

    //...and with identity pool abstract login pages

    server.route({
        method: 'GET',
        url: "/page/:page/deliver",
        handler: deliverPage
    });

    server.route({
        method: 'POST',
        url: "/login",
        handler: login
    });

    server.route({
        method: 'POST',
        url: "/account",
        handler: account
    });

    server.route({
        method: 'POST',
        url: "/idp/:idp//login",
        handler: login
    });

    server.route({
        method: 'POST',
        url: "/idp/:idp/account",
        handler: account
    });

    //server.get("/page/:page/deliver", deliverPage);  //delivers a page
    //server.post("/login", login);  //receive a post from a login page
    //server.post("/account", account);  //receive a post from an account page
    //server.post("/idp/:idp/login", login);  //receive a post from login page
    //server.post("/idp/:idp/account", account);  //receive a post from an account page

    //identity pool mgmt & "my sample app"

    server.route({
        method: 'GET',
        url: "/home",
        handler: identityApp
    });

    server.route({
        method: 'GET',
        url: "/validate",
        handler: sampleValidator
    });

    server.route({
        method: 'GET',
        url: "/idp/:idp/validate",
        handler: sampleValidator
    });

    server.route({
        method: 'GET',
        url: "/me",
        preHandler:[auth.authenticate],
        handler: getMe
    });

    server.route({
        method: 'GET',
        url: "/idp/:idp/me",
        preHandler:[auth.authenticate],
        handler: getMe
    });

    server.route({
        method: 'POST',
        url: "/identity/user",
        preHandler:[auth.authenticate],
        handler: addUpdateUser
    });

    server.route({
        method: 'GET',
        url: "/mgmt/user",
        preHandler:[auth.authenticate],
        handler: getUser
    });

    server.route({
        method: 'DELETE',
        url: "/mgmt/user",
        preHandler:[auth.authenticate],
        handler: delUser
    });

    server.route({
        method: 'POST',
        url: "/identity/verify",
        handler: login
    });

    /*
    server.get("/home", identityApp);
    server.get("/validate", sampleValidator);
    server.get("/idp/:idp/validate", sampleValidator);
    server.get("/me", auth.authenticate, getMe);  //retrieve the user profile
    server.get("/idp/:idp/me", auth.authenticate, getMe); //retrieve the user profile 
    server.post("/identity/user", auth.authenticate, addUpdateUser);  //add or update user
    server.get("/mgmt/user", auth.authenticate, getUser);  //get user
    server.del("/mgmt/user", auth.authenticate, delUser);  //delete  user
    server.post("/identity/verify", login);  //verify user credentials
    */


    //CORS enabling

    server.route({
        method: 'OPTIONS',
        url: "/authorize",
        handler: delivePreflight
    });
    server.route({
        method: 'OPTIONS',
        url: "/token",
        handler: delivePreflight
    });
    server.route({
        method: 'OPTIONS',
        url: "/.well-known/jwks.json",
        handler: delivePreflight
    });
    server.route({
        method: 'OPTIONS',
        url: "/.well-known/openid-configuration",
        handler: delivePreflight
    });

    server.route({
        method: 'OPTIONS',
        url: "/idp/:idp/authorize",
        handler: delivePreflight
    });
    server.route({
        method: 'OPTIONS',
        url: "/idp/:idp/token",
        handler: delivePreflight
    });
    server.route({
        method: 'OPTIONS',
        url: "/idp/:idp/.well-known/jwks.json",
        handler: delivePreflight
    });
    server.route({
        method: 'OPTIONS',
        url: "/idp/:idp/.well-known/openid-configuration",
        handler: delivePreflight
    });
    server.route({
        method: 'OPTIONS',
        url: "/page/:page/deliver",
        handler: delivePreflight
    });
    server.route({
        method: 'OPTIONS',
        url: "/login",
        handler: delivePreflight
    });
    server.route({
        method: 'OPTIONS',
        url: "/idp/:idp/login",
        handler: delivePreflight
    });

    //server.opts("/authorize", delivePreflight);
    //server.opts("/token", delivePreflight);
    //server.opts("/.well-known/jwks.json", delivePreflight);
    //server.opts("/.well-known/openid-configuration", delivePreflight);
    //server.opts("/idp/:idp/authorize", delivePreflight);
    //server.opts("/idp/:idp/token", delivePreflight);
    //server.opts("/idp/:idp/.well-known/openid-configuration", delivePreflight);
    //server.opts("/idp/:idp/.well-known/jwks.json", delivePreflight);
    //server.opts("/page/:page/deliver", delivePreflight);
    //server.opts("/login", delivePreflight);
    //server.opts("/idp/:idp/login", delivePreflight);

    //other
    server.route({
        method: 'GET',
        url: "/",
        handler: hello
    });



};

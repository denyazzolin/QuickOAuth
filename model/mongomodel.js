/**
 * Created by Deny Azzolin on 11/21/2021
 */


//some useful tools

var mongo = require('mongodb').MongoClient, //basic MongoDB client
    ObjectID = require('mongodb').ObjectId,
    uuid = require('uuid'),
    debug = require('debug')('MongoDB');

//our own code
var config = require('../config/config');

//data
/*
var collections = {
    "user": {
        name: "user",
        obj: null,
        indexes: [
            {
                name: "user_id",
                key: { userid: 1 },
                config: { unique: true, background: true, name: "user_id" }
            },
            {
                name: "prov_idx",
                key: { provider: 1 },
                config: { unique: false, background: true, name: "prov_idx" }
            }
        ],
        data: [
            { _id: 1, userid: "user1@domain.com", provider: 'default', firstname: "User", lastname: "Simple", password: "user1", roles: ['Store', 'Quote'] },
            { _id: 2, userid: "lda1p", provider: 'default', firstname: "User", lastname: "Simple", password: "pwd", roles: ['Store', 'Quote', 'Data'] },
            { _id: 3, userid: "mesa@mesa.com", provider: 'mesa', firstname: "Stephen", lastname: "Mesa", password: "mesa", roles: ['Store', 'Quote', 'Mesaman'] }
        ]
    },
    "ext_role": {
        name: "ext_role",
        obj: null,
        indexes: [
            {
                name: "user_id_r",
                key: { userid: 1 },
                config: { unique: false, background: true, name: "user_id_r" }
            },
            {
                name: "prov_idx_r",
                key: { provider: 1 },
                config: { unique: false, background: true, name: "prov_idx" }
            },
            {
                name: "role_idx_r",
                key: { role_set: 1 },
                config: { unique: true, background: true, name: "role_idx_r" }
            }
        ],
        data: [
            { _id: 1, role_set: 1, userid: "mesa@mesa.com", provider: 'mesa', type: "QC_OPS", title: "QuoteCenter Supplier Operator", roles: ['Store', 'Quote', "SendToOU", 'VendorManagerSuperUser'] },
            { _id: 2, role_set: 2, userid: "mesa@mesa.com", provider: 'mesa', type: "VENDOR", title: "QuoteCenter Supplier", roles: ['VendorCanEditAssortment', 'VendorCanEditPricing', 'VendorCanEditServices', 'VendorManager', 'VendorSupport'] }
        ]
    },
    "client": {
        name: "client",
        obj: null,
        indexes: [
            {
                name: "client_id",
                key: { clientid: 1 },
                config: { unique: true, background: true, name: "client_id" }
            },
            {
                name: "provider_idx",
                key: { provider: 1 },
                config: { unique: false, background: true, name: "provider_idx" }
            }
        ],
        data: [
            { _id: 1, clientid: "C1I3NT", provider: 'default', secret: "secret", scopes: ['email', 'openid', 'profile', 'admin'] },
            { _id: 2, clientid: "SIMPLE", provider: 'mesa', secret: "secret", scopes: ['email', 'openid', 'profile'] }
        ]
    },
    "refresh_token": {
        name: "refresh_token",
        obj: null,
        indexes: [
            {
                name: "token_id",
                key: { tokenid: 1 },
                config: { unique: true, background: true, name: "token_id" }
            },
            {
                name: "expt_idx",
                key: { created: 1 },
                config: { unique: false, expireAfterSeconds: 60 * 60 * 24, name: "expt_idx" }
            }
        ],
        data: [{ _id: 1, tokenid: 'dummy', code: 'dummy', client: 'dummy', provider: 'dummy' }]
    },
    "authcode": {
        name: "authcode",
        obj: null,
        indexes: [
            {
                name: "code_idx",
                key: { code: 1 },
                config: { unique: true, background: true, name: "code_idx" }
            },
            {
                name: "status_idx",
                key: { status: 1 },
                config: { unique: false, background: true, name: "status_idx" }
            },
            {
                name: "exp_idx",
                key: { created: 1 },
                config: { unique: false, expireAfterSeconds: 60 * 60 * 24, name: "exp_idx" }
            }
        ],
        data: null
    }
}
*/

debug.log = console.log.bind(console);

function MongoModel() {

    var db = null;
    var addr = null;
    var port = null;
    var dbname = null;
    var user = null;
    var pwd = null;
    var client = null;
    var prov = null;

    //get the db connection
    this.getConnection = function () {
        return db;
    }


    /**
     * Initializes the Mongo database
     * @returns true if initialization was successful, false otherwise
     */
    this.initDB = async function (db_provider, collections) {

        var state = null;

        var db = null;
        prov = db_provider;
        addr = db_provider.address;
        port = db_provider.port;
        dbname = db_provider.database;
        user = db_provider.user;
        pwd = db_provider.password;
        client = null;

        function createUserCollection() {
            return createAbstractCollection(state, collections["user"]);
        }

        function createClientCollection() {
            return createAbstractCollection(state, collections["client"]);
        }

        function createRefreshTokenCollection() {
            return createAbstractCollection(state, collections["refresh_token"]);
        }

        function createAuthCodeCollection() {
            return createAbstractCollection(state, collections["authcode"]);
        }

        function createExtraRolesCollection() {
            return createAbstractCollection(state, collections["ext_role"]);
        }

        var p = new Promise((res, rej) => {

            connect()
                .then(getCurrentState)
                .then((value) => { state = value }) //populate state
                .then(createUserCollection)
                .then((value) => { debug('Collection -' + value + '- successfully created') })
                .then(createClientCollection)
                .then((value) => { debug('Collection -' + value + '- successfully created') })
                .then(createRefreshTokenCollection)
                .then((value) => { debug('Collection -' + value + '- successfully created') })
                .then(createAuthCodeCollection)
                .then((value) => { debug('Collection -' + value + '- successfully created') })
                .then(createExtraRolesCollection)
                .then((value) => { debug('Collection -' + value + '- successfully created') })
                .then(() => {
                    res(true); //we did it!
                })
                .catch((e) => {
                    debug('>> Error when initializing Mongo:' + JSON.stringify(e));
                    rej(false); //oops
                })

        });

        return p;
    }


    /**
     * Produce or update an authorization code for an user. This function does NOT check if the user exists.
     * @param {*} doc a json object with code, client_id, provider, redirect_uri and other data from the authorize call
     * @param {*} idp a string with the IDP name (use default if ommited)
     * @returns {action:boolean, code:number, authcode:string} an object with action true and code OK if successful
     */
    this.produceAuthCode = async function (doc) {


        var p = new Promise((res, rej) => {
            if (doc) {

                var c = db.collection("authcode");
                //providers
                var provider = config.providers[doc.provider];
                if (!provider) provider = config.providers["default"]; //this is bad, but let's keep it for now

                //produce an id in any case
                var code = uuid.v4();
                var now = new Date();
                var exp = new Date(new Date().setMinutes(now.getMinutes() + (provider.grants["code"].expiration ? provider.grants["code"].expiration : 5)));

                //check if we need to either create or fetch a code
                if (!doc.code) {
                    //no code, so we create a new one and deliver back
                    doc.code = code;
                    doc.status = 0; //means it's not ready to be sent out yet
                    c.insertOne(doc)
                        .then((v) => {
                            if (v.acknowledged) res({ action: true, code: 'OK', authcode: doc.code, userid: doc.userid }); //code was inserted;
                            else rej({ action: false, code: 'NOT_INSERTED', err: 'Insert of authcode failed' }); //code not inserted;
                        })
                        .catch((v) => {
                            rej({ action: false, code: 'EXCEPTION', err: 'Exception when inserting authcode' }); //error
                        });
                } else {
                    //there's a code in the doc, so we will fetch it back and update with new dates
                    //update the doc. userid should be there as well
                    var stat = doc.stat ? doc.stat : 0;

                    c.updateOne({ code: doc.code, status: stat }, { $set: { created: now, expiration: exp, status: 1, userid: doc.userid, user_roles: doc.user_roles } }, { upsert: false })
                        .then((v) => {
                            if (v.acknowledged && v.matchedCount == 1) {
                                //yes we found and updated it                    
                                res({ action: true, code: 0, authcode: doc.code, userid: doc.userid });
                            } else rej({ action: false, code: 'NOT_UPDATED', err: 'Update of authcode not performed' });
                        })
                        .catch((v) => {
                            rej({ action: false, code: "EXCEPTION", err: 'Exception when updating authcode' });
                        })
                }

            } else rej({ action: false, code: "MALFORMED", err: 'No data was present' }); //error
        });

        return p;

    }

    /**
     * produce a refresh token associated to an auth code
     * @param {*} code a string with an access code, from which to retrieve scopes
     * @param {*} client a string with teh client id
     * @param {*} provider a string with teh provider
     * @returns {action:true, code:'OK', refresh_code:'string with the new code'}
     */
    this.produceRefreshToken = async function (code, client, prov, redir, state) {

        var p = new Promise((res, rej) => {

            if (code && client && prov) {

                //providers
                var provider = config.providers[prov];
                if (!provider) provider = config.providers["default"]; //this is bad, but let's keep it for now

                var refresh_code = uuid.v4();
                var now = new Date();
                var exp = new Date(new Date().setMinutes(now.getMinutes() + (provider.grants["refresh_token"].expiration ? provider.grants["refresh_token"].expiration : 60 * 24)));

                //craft a new refresh_token
                var rftoken = { tokenid: refresh_code, code: code, client_id: client, provider: prov, state: 0, created: now, expiration: exp, redirect_uri:redir, state:state };

                var c = db.collection("refresh_token");

                c.insertOne(rftoken)
                    .then((v) => {
                        if (v.acknowledged) res({ action: true, code: 'OK', refresh_code: refresh_code });
                        else rej({ action: false, code: 'NOT_INSERTED', err: 'Insert of refresh token failed' });
                    })
                    .catch((e) => {
                        rej({ action: false, code: "EXCEPTION", err: 'Exception when updating authcode' });
                    })


            } else rej({ action: false, code: "MALFORMED", err: 'No data was present when producing a refresh token' }); //error

        });

        return p;

    }

    /**
     * Finds and returns a refresh token
     * @param {*} refresh_code a string with a refresh code
     * @returns {action:true, code:'OK', refresh_token:'string with the new code'}
     */
    this.findRefreshToken = async function (refresh_code) {

        var p = new Promise((res, rej) => {

            if (refresh_code) {

                var c = db.collection("refresh_token");
                c.findOne({tokenid:refresh_code})
                .then((v)=>{
                    if (v) res({action:true, code:'OK', refresh_token:v});
                    else rej({ action: false, code: "REFRESH_TOKEN_NOT_FOUND", err: 'refresh token not found' }); //not found;
                })
                .catch((v) => {
                    rej({ action: false, code: 'EXCEPTION', err: 'Exception locating a refresh token' }); //error
                })

            } else rej({ action: false, code: "MALFORMED", err: 'No data was present when retrieving a refresh token' }); //error

        });

        return p;

    }


    /**
     * Find an authcode
     * @param {*} authcode string with authcode
     * @returns {action:boolean, code:number, authcode:string doc:Authcode}  action true and code OK means authcode was found
     */
    this.findAuthCode = async function (authcode) {

        var p = new Promise((res, rej) => {
            if (authcode) {
                var c = db.collection("authcode");
                c.findOne({ code: authcode })
                    .then((v) => {
                        if (v) {
                            //user was found
                            res({ action: true, code: "OK", authcode: v.code, doc: v });
                        } else rej({ action: false, code: "AUTHCODE_NOT_FOUND", err: 'authcode not found' }); //not found;
                    })
                    .catch((v) => {
                        rej({ action: false, code: 'EXCEPTION', err: 'Exception locating an authcode' }); //error
                    })
            } else rej({ action: false, code: 'MALFORMED', err: 'Authcode not informed' }); //error
        });

        return p;

    }


    /**
     * Return the extended roles for an user
     * @param {*} userid string with user id
     * @param {*} provider string with provider
     * @returns {action:boolean, code:number, authcode:string doc:Authcode}  action true and code OK means authcode was found
     */
    this.retrieveExtraRoles = async function (userid, provider) {

        var p = new Promise((res, rej) => {
            if (userid && provider) {
                var c = db.collection("ext_role");
                c.find({ userid: userid, provider: provider }).toArray()
                    .then((v) => {
                        //roles were found
                        res({ action: true, code: "OK", roles: v });
                    })
                    .catch((v) => {
                        rej({ action: false, code: 'EXCEPTION', err: 'Exception locating extroles' }); //error
                    })
            } else rej({ action: false, code: 'MALFORMED', err: 'userid or provider not informed' }); //error
        });

        return p;

    }


    /**
     * Inserts a user in the database
     * @param {*} user a user document
     * @returns an object with action true and code OK if successful
     */
    this.addUser = async function (user) {

        var p = new Promise((res, rej) => {
            if (user) {

                var c = db.collection("user");
                c.insertOne(user)
                    .then((v) => {
                        res({ action: true, code: 'OK', count: 1, id: v.insertedId }); //user was inserted;
                    })
                    .catch((v) => {
                        rej({ action: false, code: 'EXCEPTION', err: 'Exception orccurred or user already exists' }); //error
                    })
            } else rej({ action: false, code: 'MALFORMED', err: 'No dtaa was informed' }); //error
        });

        return p;

    }


    /**
     * Deletes an user in the database
     * @param {*} userid a user id (string)
     * @param {*} provider string with the provider
     * @returns {action:boolean, code:number} an object with action true and code OK if successful
     */
    this.deleteUser = async function (userid, provider) {

        var p = new Promise((res, rej) => {
            if (userid) {

                var c = db.collection("user");
                c.deleteOne({ userid: userid, provider: provider })
                    .then((v) => {
                        res({ action: true, code: "OK", count: v.deletedCount }); //user was removed;
                    })
                    .catch((v) => {
                        rej({ action: false, code: 'EXCEPTION', err: 'Exception removing user' }); //error
                    })
            } else rej({ action: false, code: "MALFORMED", err: 'Data was not present' }); //error
        });

        return p;

    }


    /**
     * Verify user credentials
     * @param {*} userdata {userid:"", password:"", provider:""}
     * @returns {action:boolean, code:number, user:User}  action true and code OK means user and pwd match
     */
    this.verifyUser = async function (userdata) {

        var p = new Promise((res, rej) => {
            if (userdata) {
                var c = db.collection("user");
                c.findOne({ userid: userdata.userid, provider: userdata.provider })
                    .then((v) => {
                        if (v) {
                            //user was found, check pwd
                            if (userdata.password == v.password) res({ action: true, code: 'OK', user: v }); //password match
                            else rej({ action: false, code: 'CREDENTIALS_NOT_MATCH', err: 'User and password do not match' }); //password mismatch;

                        } else rej({ action: false, code: 'USER_NOT_FOUND', err: 'User not found' }); //user was not found;
                    })
                    .catch((v) => {
                        rej({ action: false, code: 'EXCEPTION', err: 'Error when verifying user' }); //error
                    })
            } else rej({ action: false, code: "MALFORMED", err: "Data not informed" }); //error
        });

        return p;

    }


    /**
     * Find an user
     * @param {*} userid string with userid
     * @param {*} provider string with the provider
     * @returns {action:boolean, code:number, user:User}  action true and code OK means user was found
     */
    this.findUser = async function (userid, provider) {

        var p = new Promise((res, rej) => {
            if (user) {
                var c = db.collection("user");
                c.findOne({ userid: userid, provider: provider })
                    .then((v) => {
                        if (v) {
                            //user was found
                            res({ action: true, code: 'OK', user: v });
                        } else rej({ action: false, code: 'USER_NOT_FOUND', err: 'User not found' }); //user was not found;
                    })
                    .catch((v) => {
                        rej({ action: false, code: 'EXCEPTION', err: 'Exception when locating an user' }); //error
                    })
            } else rej({ action: false, code: 'MALFORMED', err: 'Data not informed' }); //error
        });

        return p;

    }

    /**
 * Find a client
 * @param {*} client_id string with client_id
 * @param {*} provider string with the provider
 * @returns {action:boolean, code:number, client:Client}  action true and code OK means user was found
 */
    this.findClient = async function (client_id, provider) {

        var p = new Promise((res, rej) => {
            if (client_id) {
                var c = db.collection("client");
                c.findOne({ clientid: client_id, provider: provider })
                    .then((v) => {
                        if (v) {
                            //user was found
                            res({ action: true, code: 'OK', client: v });
                        } else rej({ action: false, code: 'CLIENT_NOT_FOUND', err: 'Client not found' }); //client was not found;
                    })
                    .catch((v) => {
                        rej({ action: false, code: 'EXCEPTION', err: 'Exception when locating a client' }); //error
                    })
            } else rej({ action: false, code: 'MALFORMED', err: 'Data not informed' }); //error
        });

        return p;

    }

    /**
     * Check if client and secret do exist and match
     * @param {*} client_id string with client id
     * @param {*} secret string with secret
     * @param {*} provider string with provider
     * @returns {action:boolean, code:number, client:Client}  action true and code OK means user was found
     */
    this.checkClient = async function (client_id, secret, provider) {

        var p = new Promise((res, rej) => {

            this.findClient(client_id, provider)
                .then((data) => {
                    //we got a client
                    if (data.client.secret == secret) res({ action: true, code: 'OK', client: data });
                    else rej({ action: false, code: 'CLIENT_SECRET_NOT_MATCH', err: 'Client and secret do not match' });
                })
                .catch((e) => {
                    rej({ action: false, code: e.code, err: e.err }); //error
                })

        });

        return p;

    }


    /**
     * 
     * @param {userid:string, password:string, provider:string} userdata the data to find the user and the passwod to change. You can set empty passwords
     * @returns {ation:boolean, code:number} action true and code OK for success
     */
    this.changePassword = async function (userdata) {

        var p = new Promise((res, rej) => {
            if (userdata) {
                var c = db.collection("user");
                c.updateOne({ userid: userdata.userid, provider: userdata.provider }, { $set: { password: userdata.password } }, { upsert: false })
                    .then((v) => {
                        if (v) {
                            //user was found and updated
                            debug(v);
                            if (v.acknowledged && v.matchedCount == 1) res({ action: true, code: 'OK', data: v.value });
                            else rej({ action: false, code: 'PASSWORD_NOT_UPDATED', err: 'User not found' });
                        } else rej({ action: false, code: 'EXCEPTION', err: 'Not updated' }); //user was not found;
                    })
                    .catch((v) => {
                        rej({ action: false, code: 'EXCEPTION', err: 'Exception when changing password' }); //error,
                    })

            } else rej({ action: false, code: 'MALFORMED', err: 'Data not informed' }); //error
        });

        return p;


    }

    //
    // helper functions to build mongo database url
    //


    /**
     * Connects to Mongo via data in config 
     * @returns true if connected
     */
    async function connect() {
        var url = buildURL();
        debug('> Mongo url:' + url);

        var p = new Promise((res, rej) => {
            mongo.connect(url, function (err, d) {
                if (!err) {
                    db = d.db();
                    debug('connected');
                    res(true);
                } else rej(false);
            });
        });
        return p;
    }

    /**
     * Creates a Mongo URI via data in config
     * @returns a string with a Mongo URI
     */
    function buildURL() {
        var url = null;
        var opt = null;
        var auth = "";

        if (prov.connOptions) opt = prov.connOptions;

        if (user) auth = user + ":" + pwd + "@";

        if (addr) {
            url = 'mongodb://' + auth + addr + (port != 'NONE' ? ':' + port : '') + '/' + dbname + (opt ? '?' + opt : '');
            // url = 'mongodb://'+addr+(port!='NONE'?':'+port:'')+'/'+dbname+(opt?'?'+opt:'');
        }
        debug("> Result URL for MongoDB", url);
        return url;
    }

    /**
     * Creates a full collection in Mongo (named, with indexes and pre-populated) given a preconfigured data set and state of current database
     * @param {*} state a directory of current state previously fetched
     * @param {*} data a collection to create, with name, indexes and data
     * @returns a string with the name of collection created
     */
    async function createAbstractCollection(state, data) {

        var col = null;

        //check if we have this collection alreafy fetched bya state inspect
        debug('> creating an abstract collection:' + data.name);
        if (!state[data.name]) {
            //create the collection
            col = await db.createCollection(data.name);
        } else {
            col = state[data.name].col;
            debug("> skipping collection " + data.name);
        }

        //always check for the indexes in the data set
        if (data.indexes) {
            for (var x = 0; x < data.indexes.length; x++) {

                var idx = data.indexes[x];
                debug('> creating index ' + idx.name);

                //check if the named index already exist
                var ex = await col.indexExists(idx.name);
                if (!ex) {
                    //index does not exist, create it                        
                    var i = await col.createIndex(idx.key, idx.config);

                } else debug('> skipping index ' + idx.name);
            }
        }

        //populate the collection
        if (data.data) {
            debug('> populating collection with ' + data.data.length + ' documents');
            var p = new Promise((res, rej) => {
                col.insertMany(data.data, { ordered: false })
                    .then((value) => res(value))
                    .catch((value) => res('Skipped inserts:' + value));
            });

            var d = await p;
            debug(d);
        } else debug('> skipped data insert since there is no document to insert');

        return data.name;
    }

    /**
     * Fetches all collections in the referenced database
     * @returns a json directory with the name of the collections found and their respective Mongo collection objects
     */
    async function getCurrentState() {

        //this variable will host the fetched collections
        var c = [];

        //fetch collections
        var cols = await db.collections();

        //arrange them in a directory
        if (cols && Array.isArray(cols)) cols.forEach((v) => { c[v.collectionName] = { name: v.collectionName, col: v } });

        return c;
    }


}


module.exports = MongoModel;
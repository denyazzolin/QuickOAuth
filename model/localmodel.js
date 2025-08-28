/**
 * Created by Deny Azzolin on 11/21/2021
 */


//some useful tools

var uuid = require('uuid'),
    debug = require('debug')('LocalDB');

//our own code
var config = require('../config/config');

//the "tables"
var user = {};
var ext_role = {};
var client = {};
var refresh_token = {};
var authcode = {};


debug.log = console.log.bind(console);

function LocalModel() {

    /**
    * Initializes the local database
    * @returns true if initialization was successful, false otherwise
    */
    this.initDB = async function (db_provider, collections) {

        //let's "populate" the tables here
        var p = new Promise((res, rej) => {

            //create the "user" table
            //traverse it so we can lookup as a dir by userid and provider
            collections["user"].data.forEach((u) => {
                user[u.userid + '|' + u.provider] = u;
            });

            //create the 'ext_role' table
            //here we need to craft an array since the key is not unique
            collections["ext_role"].data.forEach((u) => {
                if (!ext_role[u.userid + '|' + u.provider]) ext_role[u.userid + '|' + u.provider] = [];
                ext_role[u.userid + '|' + u.provider].push(u);
            });

            //create the 'client' table
            collections["client"].data.forEach((u) => {
                client[u.clientid + '|' + u.provider] = u;
            });


            //create the 'refresh_token' table
            collections["refresh_token"].data.forEach((u) => {
                refresh_token[u.tokenid] = u;
            });

            res(true);

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
                    authcode[doc.code] = doc;
                    res({ action: true, code: 'OK', authcode: doc.code, userid: doc.userid }); //code was inserted;
                } else {
                    //there's a code in the doc, so we will fetch it back and update with new dates
                    //update the doc. userid should be there as well
                    var stat = doc.stat ? doc.stat : 0;

                    if (authcode[doc.code]) {

                        if (authcode[doc.code].status == stat) {
                            authcode[doc.code].created = now;
                            authcode[doc.code].expiration = exp;
                            authcode[doc.code].status = 1;
                            authcode[doc.code].userid = doc.userid;
                            authcode[doc.code].user_roles = doc.user_roles;
                            res({ action: true, code: 0, authcode: doc.code, userid: doc.userid });

                        } else rej({ action: false, code: 'NOT_UPDATED', err: 'Update of authcode not performed' });

                    } else rej({ action: false, code: 'NOT_UPDATED', err: 'Update of authcode was not performed' });

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
                var rftoken = { tokenid: refresh_code, code: code, client_id: client, provider: prov, state: 0, created: now, expiration: exp, redirect_uri: redir, state: state };

                refresh_token[rftoken.tokenid] = rftoken;
                res({ action: true, code: 'OK', refresh_code: refresh_code });

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

                var v = refresh_token[refresh_code];
                if (v) res({ action: true, code: 'OK', refresh_token: v });
                else rej({ action: false, code: "REFRESH_TOKEN_NOT_FOUND", err: 'refresh token not found' }); //not found;
            } else rej({ action: false, code: "MALFORMED", err: 'No data was present when retrieving a refresh token' }); //error

        });

        return p;
    }


    /**
     * Find an authcode
     * @param {*} authcode string with authcode
     * @returns {action:boolean, code:number, authcode:string doc:Authcode}  action true and code OK means authcode was found
     */
    this.findAuthCode = async function (acode) {
        var p = new Promise((res, rej) => {
            if (authcode) {
                var v = authcode[acode];
                if (v) {
                    //code was found
                    res({ action: true, code: "OK", authcode: v.code, doc: v });
                } else rej({ action: false, code: "AUTHCODE_NOT_FOUND", err: 'authcode not found' }); //not found;

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
                var v = ext_role[userid + '|' + provider];
                res({ action: true, code: "OK", roles: v });
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

    }


    /**
     * Deletes an user in the database
     * @param {*} userid a user id (string)
     * @param {*} provider string with the provider
     * @returns {action:boolean, code:number} an object with action true and code OK if successful
     */
    this.deleteUser = async function (userid, provider) {

    }


    /**
     * Verify user credentials
     * @param {*} userdata {userid:"", password:"", provider:""}
     * @returns {action:boolean, code:number, user:User}  action true and code OK means user and pwd match
     */
    this.verifyUser = async function (userdata) {
        var p = new Promise((res, rej) => {
            if (userdata) {
                var v = user[userdata.userid + '|' + userdata.provider]
                if (v) {
                    //user was found, check pwd
                    if (userdata.password == v.password) res({ action: true, code: 'OK', user: v }); //password match
                    else rej({ action: false, code: 'CREDENTIALS_NOT_MATCH', err: 'User and password do not match' }); //password mismatch;

                } else rej({ action: false, code: 'USER_NOT_FOUND', err: 'User not found' }); //user was not found;

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
                var v = user[userid + '|' + provider];
                if (v) {
                    //user was found
                    res({ action: true, code: 'OK', user: v });
                } else rej({ action: false, code: 'USER_NOT_FOUND', err: 'User not found' }); //user was not found;

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
                var v = client[client_id + '|' + provider];
                if (v) {
                    //user was found
                    res({ action: true, code: 'OK', client: v });
                } else rej({ action: false, code: 'CLIENT_NOT_FOUND', err: 'Client not found' }); //client was not found;
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

    }


    //
    // helper functions to connect to and build the database
    //


    /**
     * Connects to Mongo via data in config 
     * @returns true if connected
     */
    async function connect() {

    }


    /**
    * Creates a Mongo URI via data in config
    * @returns a string with a Mongo URI
    */
    function buildURL() {

    }


    /**
     * Creates a full collection in Mongo (named, with indexes and pre-populated) given a preconfigured data set and state of current database
     * @param {*} state a directory of current state previously fetched
     * @param {*} data a collection to create, with name, indexes and data
     * @returns a string with the name of collection created
     */
    async function createAbstractCollection(state, data) {

    }


    /**
     * Fetches all collections in the referenced database
     * @returns a json directory with the name of the collections found and their respective Mongo collection objects
     */
    async function getCurrentState() {

    }






}


module.exports = LocalModel;


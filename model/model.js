/**
 * Created by Deny Azzolin on 11/21/2021
 */


//some useful tools

var  debug = require('debug')('Model');

//our own code
var config = require('../config/config'),
    Mongo = require('./mongomodel'),
    Local = require('./localmodel'); 


debug.log = console.log.bind(console);

function Model(){

    var prov = config.db.provider;
    var db_provider = config.db.providers[prov];


    this.initDB = async function(){

        debug('>> Initializing the DB provider from config:'+prov);
        var TheModel = require('./'+db_provider.impl);

        var p = new Promise((res, rej) => {

            debug('>> Loading the DB provider implementation:'+db_provider.impl);
            var model = new TheModel();

            if (model){
                model.initDB(db_provider, config.collections)
                .then((m)=>{
                    res(model);
                })
                .catch((e)=>{
                    debug('Cannot initiate '+prov+' DB provider');
                    rej('Cannot initiate '+prov+' DB provider')
                })

            } else {
                debug('Cannot load '+db_provider.impl);
                rej('Cannot load '+db_provider.impl);
            }


        });

        return p;


    }






}

module.exports = Model;
// created by Deny Azzolin

var request = require('request'),
    debug = require('debug')('utils');

function ReqBuilder() {

    var access_token = null;

    this.build = function (method, url, fields, formfields, forceJson, headers, body) {

        var _fields="";

        if (headers === undefined) {
            headers = {};
        }


        if (fields){
            for(var f in fields){
                if (fields.hasOwnProperty(f)) {
                    if (_fields!="") _fields = _fields + "&";
                    _fields = _fields + encodeURI(f + "=" + fields[f]);
                }
            }
        }

        return {
            method: method,
            uri: url+(_fields?"?"+_fields:""),
            headers: headers,
            body: body,
            form: formfields?formfields:"",
            forceJson: forceJson?true:false
        };
    };


    this.managedRequest = async function (options) {
        var self = this;

        var p = new Promise((resolve, reject)=> {
            request(options, this.responseHandler(options.forceJson, function (e, o, rsp) {
                if (e) {
                    if (options._retrycount >= 3) {
                        reject(e);
                    } else {
                        options._retrycount = (options._retrycount || 0) + 1;
                        self.managedRequest(options)
                        .then((b,r)=>{
                            resolve(b,r);
                        })
                        .catch((err)=>{
                            reject(err);
                        })
                    }
                } else {
                    resolve(o, rsp);
                }
            }));

        });

        return p;

    };


    this.responseHandler = function (forceJson, callback) {
        return function (error, response, body) {
            if (!error && (response.statusCode == 200 || response.statusCode == 201 || response.statusCode == 204)) {
                if (response.headers["content-type"] == "application/json") {
                    body = JSON.parse(body);
                } else if(forceJson){
                    body = JSON.parse(body);
                }
                callback && callback(null, body, response);
            } else {
                callback && callback(error || {httpStatus: response.statusCode, body: body});
            }
        }
    }
}


module.exports = ReqBuilder;
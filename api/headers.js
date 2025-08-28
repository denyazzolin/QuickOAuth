/**
 * Created by Deny Azzolin on 11/21/2021
 */

const { get } = require('request');

// some useful tools
var Q = require('q'),  //ok, we may use only native Promises, i promise
    debug = require('debug')('api'); //just for some useful logging
//errors = require('restify-errors');  //we need this to return specific Restify error objects

function getErrorItem(status, code, msg) {
    return {
        statusCode: status,
        code: code,
        message: msg
    };
}

var errorMap = {
    "400": getErrorItem(400, 'BadRequestError', 'Bad (or missing) header or payload value'),
    "403": getErrorItem(403, 'ForbiddenError', 'Forbidden'),
    "500": getErrorItem(500, 'InternalServerError', 'Internal server error'),
    "401": getErrorItem(401, 'UnauthorizedError', 'Unauthorized'),
    "429": getErrorItem(429, 'TooManyRequestsError', 'Too many requests'),
    "415": getErrorItem(415, 'UnsupportedMediaTypeError', 'Unsupported media'),
    "406": getErrorItem(406, 'NotAcceptableError', 'Not acceptable content'),
    "404": getErrorItem(404, 'NotFoundError', 'Entity not found')
}

function isEmpty(value) {
    return !value;
}

/**
 * Utility call that maps an error code and message to a (set of) Restify error objects
 * @param code an (string) http error code
 * @returns a restify error object, with INternal Server Error as default if nothings maps
 */
function getError(code, msg) {
    var e = null;
    e = errorMap[code];
    if (!e) e = getError(500,'InternalServerError','Internal service error');
    return e;
}

/**
 * This function inserts a header rule check in a checklist
 * @param checkList an array to host the checklist
 * @param headerName a string with the header name to check
 * @param required a boolean that determines if the header must be present or not. Defaults to true if not informed
 * @param expectedVal a string or array of strings with the expected values for the header
 * @param code an integer with the Http status code that should be used when this rule runs to a failure
 * @param extracode an integer with the X-QC-ErrorCode that may  be used when this rule runs to a failure. Defaults to 100 if not infomred
 */
function addRuleCheck(checkList, headerName, required, expectedVal, code, extracode) {
    if (headerName) {
        checkList.push({ name: headerName, required: required ? required : true, expectedValue: expectedVal, retCode: code ? code : 400, extracode: extracode ? extracode : 100 });
    }
}

/**
 * Check the headers present in the request against all rules in the informed checklist
 * @param {*} req reylar restify request object
 * @param {*} chekList a checklist with rules to check
 * @returns 0 if all rules check, or a http code (rperesented by the code parameter in the rule) for the first unverified rule, or defaults to 500
 */
function check(checkList, req) {

    if (Array.isArray(checkList)) {
        for (var i in checkList) {
            try {
                var item = checkList[i];
                var h = req.headers[item.name];
                //does it exist?
                if (isEmpty(h) && item.notEmpty) return item.retCode;
                //does it match the value?
                if (item.expectedValue) {
                    if (Array.isArray(item.expectedValue)) {
                        var one = 0;
                        for (var i in item.expectedValue) one = one + (item.expectedValue[i] == h ? 1 : 0)
                        if (one == 0) return item.retCode;
                    }
                    else if (h != item.expectedValue) return item.retCode;
                }
            } catch (e) {
                return (500);
            }
        }
        return 0; //ok!
    } else return (500);
}

/**
 * This call performs the check of all the informed rules. If a rule fails, the call returns the proper error directly on the informed response object
 * @param checkList an array with rules to check
 * @param req a Node http request
 * @param res a Node http response
 * @param next a next function to advance on a request filter pipeline
 * @returns {boolean} true if the call found a failure, false otherwise
 */
function checkAndReturn(checkList, req, res, next) {

    if (Array.isArray(checkList)) {
        for (var i = 0; i < checkList.length; i++) {
            try {
                var item = checkList[i];
                //debug(item);
                var h = req.headers[item.name];
                //does it exist?
                if (isEmpty(h) && item.notEmpty) {
                    req.setQCHeader(res, item.hpCode, errorMap[item.retCode], next);
                    return true;
                }
                //does it match the value?
                if (item.expectedValue) {
                    if (Array.isArray(item.expectedValue)) {
                        var one = 0;
                        for (var i in item.expectedValue) one = one + (item.expectedValue[i] == h ? 1 : 0)
                        if (one == 0) {
                            req.setQCHeader(res, item.hpCode, errorMap[item.retCode], next);
                            return true;
                        }
                    }
                    else if (h != item.expectedValue) {
                        req.setQCHeader(res, item.hpCode, errorMap[item.retCode], next);
                        return true;
                    }

                }
            } catch (e) {
                req.setQCHeader(res, 100, errorMap["500"], next);
                return true;
            }
        }
    } else return true;
    return false;
}


//constructor that holds internal collections of rules
function Headers() {

    var checkList = []; //internal checklist

    /**
     * This function inserts a header rule check in the internal checklist
     * @param headerName a string with the header name to check
     * @param required a boolean that determines if the header must be present or not. Defaults to true if not informed
     * @param expectedVal a string or array of strings with the expected values for the header
     * @param code an integer with the Http status code that should be used when this rule runs to a failure
     * @param extracode an integer with the X-QC-ErrorCode that may  be used when this rule runs to a failure. Defaults to 100 if not infomred
     */
    this.addRuleCheck = function (headerName, required, expectedVal, code, extracode) {
        // if (headerName){
        //     checkList.push({name:headerName, required: required?required:true, expectedValue:expectedVal, retCode:code?code:400, extracode:extracode?extracode:100});
        // }
        addRuleCheck(checkList, headerName, required, expectedVal, code, extracode);
    }

    /**
     * Check the headers present in the request against all rules in the internal checklist
     * @param {*} req regular Node request object
     * @returns 0 if all rules check, or a http code (rperesented by the code parameter in the rule) for the first unverified rule, or 500 as default
     */
    this.check = function (req) {

        return check(checkList, req);
    }


    /**
     * This call performs the check of all the informed rules. If a fails is found, the call returns the proper error directly on the informed response object
     * @param req a Node http request
     * @param res a Node http response
     * @param next a next function to advance on a request filter pipeline
     * @returns {boolean} true if the call found a failure, false otherwise
     */
    this.checkAndReturn = function (req, res, next) {

        return checkAndReturn(checkList, req, res, next);

    }

};


module.exports = {
    Headers,
    addRuleCheck,
    check,
    checkAndReturn
}
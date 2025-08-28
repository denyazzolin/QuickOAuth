/**
 * Created by Deny Azzolin on 11/21/2021
 */
var packageJSON = require('../package.json'),
  locale = require('locale'),
  fs = require('fs');
debug = require('debug')('config');

var notfound = "<html><body><h3>404 - Oooops, not found, check the configuration script!</h3></body></html>";

async function getAFileAsync(filename, idp) {

  var p = new Promise((resolve, reject) => {

    fs.readFile(__dirname + '/static/' + idp + '/' + filename, 'utf8', function (err, data) {
      if (err) {
        debug(err);
        reject(notfound);
      } else resolve(data);
    });
  });
  return p;
}

function getAFile(filename, idp) {
  return fs.readFileSync(__dirname + '/static/' + idp + '/' + filename, 'utf8');
}

var configuration = {
  db: {
    provider: "local",
    providers: {
      mongo: {
        impl: "mongomodel.js",
        address: '127.0.0.1',
        port: 27017,
        user: null,
        password: null,
        database: 'authnz',
        timezone: 'utc',
        ismock: false,
        connOptions: ''
      },
      local: {
        impl: "localmodel.js",
        ismock: false,
      }
    }
  },
  server: {
    port: 8081,
    name: 'QuickOAuth',
    about: 'A useful mock authnz service based on Oauth2.0 and OIDC'
  },
  providers: {
    "default": {
      token: {
        expiration: 518400, //in minutes
        alg: 'RS256',
        kty: 'RSA',
        isAzure: false,
        key: {
          use: null,  //nulll means the code will ramdonly rotate over the existing keys
          keys: {
            "abc1": {
              priv: null,  //yeah we should inject
              pub: null  //we load the pub key only to auto generate a JWKS endpoint
            },
            "abc2": {
              priv: null,
              pub: null  //we load the pub key only to auto generate a JWKS endpoint
            }
          }
        }
      },
      grants: {
        'code': {
          login: "login.html",
          expiration: 15 //in minutes
        },
        "authorization_code": {
          produce_refresh: true
        },
        "client_credentials": {
          produce_refresh: false
        },
        "refresh_token": {
          produce_refresh: true,
          expiration: 24 * 60, //in minutes 
        }
      }
    },
    "mesa": {
      token: {
        expiration: 518400, //in minutes
        alg: 'RS256',
        kty: 'RSA',
        isAzure: false,
        key: {
          use: 'mes01',  //a key name determines only this key will be used
          keys: {
            "mes01": {
              priv: null,  //yeah we should inject
              pub: null  //we load the pub key only to auto generate a JWKS endpoint
            }
          }
        }
      },
      grants: {
        'code': {
          login: "login.html",
          account: "account.html",
          expiration: 15 //in minutes
        },
        "authorization_code": {
          produce_refresh: true
        },
        "refresh_token": {
          produce_refresh: false,
          expiration: 24 * 60, //in minutes 
        }
      }
    }
  },
  service: {
    locales: new locale.Locales(["en", "fr", "it", "de", "es", "pt", "da", "nl", "ru", "pl", "ja", "ca", "zh", "fi", "hu", "cs", "tr", "bg", "sv"])
  },
  myapp: {
    pages: {
      validator: null,
      home: null
    }
  },
  collections: {
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
        { _id: 1, userid: "user1@domain.com", provider: 'default', firstname: "User", lastname: "Simple", email:"user1@domain.com", password: "user1", roles: ['Store', 'Quote'] },
        { _id: 2, userid: "lda1p", provider: 'default', firstname: "User", lastname: "Simple", email:"user@homedepot.com", password: "pwd", roles: ['Store', 'Quote', 'Data'] },
        { _id: 3, userid: "mesa@mesa.com", provider: 'mesa', firstname: "Stephen", lastname: "Mesa", email:"mesa@mesa.com", password: "mesa", roles: ['Store', 'Quote', 'Mesaman'] },
        { _id: 4, userid: "axlfly", provider: 'default', firstname: "Axel", lastname: "Foley", email:"axel.foley@homedepot.com", password: "aaa", roles: ['gg_pro_user'] },
        { _id: 5, userid: "exlnut", provider: 'default', firstname: "Excel", lastname: "Lover", email:"excel.nut@homedepot.com", password: "aaa", roles: ['gg_pro_user', 'gg_store_user'] },
        { _id: 6, userid: "exqzit", provider: 'default', firstname: "Esq", lastname: "Qui Zyte", email:"esqui.zyte@homedepot.com", password: "aaa", roles: ['gg_pro_user', 'gg_store_user'] }
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
        { _id: 2, clientid: "SIMPLE", provider: 'mesa', secret: "secret", scopes: ['email', 'openid', 'profile'] },
        { _id: 3, clientid: "spiffe://homedepot.com/recipe", provider: 'default', secret: "secret", scopes: ['email', 'openid', 'profile'] },
        { _id: 4, clientid: "spiffe://homedepot.com/ingredients", provider: 'default', secret: "secret", scopes: ['email', 'openid', 'profile'] },
        { _id: 5, clientid: "spiffe://homedepot.com/comments", provider: 'default', secret: "secret", scopes: ['email', 'openid', 'profile'] },
        { _id: 5, clientid: "spiffe://homedepot.com/app1", provider: 'default', secret: "secret", scopes: ['email', 'openid', 'profile'] },
        { _id: 1, clientid: "C1I3NT", provider: 'default', secret: "secret", scopes: ['email', 'openid', 'profile', 'admin'] }
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
};

//load static hmlt files and keys
//the keys should always be named "<kid>_private.key" and "<kid>_public.key" and they shoudl be in the root dir of the provider
for (var idp in configuration.providers) {
  if (configuration.providers.hasOwnProperty(idp)) {
    var p = configuration.providers[idp];
    //load login pages....logically, only "code" grants should require a login page
    for (var grant in p.grants) {
      if (p.grants.hasOwnProperty(grant)) {
        var g = p.grants[grant];
        if (g.login) {
          g.login = getAFile(g.login, idp);
        }
        if (g.account) {
          g.account = getAFile(g.account, idp);
        }
      }
    }

    //load keys. We will only attempt to load if the alg is RSA256
    if (p.token.alg == 'RS256') {
      for (var k in p.token.key.keys) {
        if (p.token.key.keys.hasOwnProperty(k)) {
          var keyf = p.token.key.keys[k];

          //private key
          keyf.priv = getAFile(k + "_private.key", idp);

          //public key
          keyf.pub = getAFile(k + "_public.key", idp);
        }
      }
    }
  }
}

configuration.myapp.pages.validator = getAFile('validator.html', 'myapp');
configuration.myapp.pages.home = getAFile('home.html', 'myapp');




module.exports = configuration;
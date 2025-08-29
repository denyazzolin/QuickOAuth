# QuickOAuth2
A simple and lightweight OAuth2 / OIDC service for testing purposes

## Features

**OAuth2 / OIDC endpoints**
| Methose | Endpoint | Description |  Output | 
| --- | --- | --- | --- |
| GET | /authenticate | Authorization enpoint as per RFC 6749 | Output via http redirects and query string fields only | 
| POST | /token | Token endpoint as per RFC 6749 | JSON payload |
| GET | /well-known/jwks.json | Delivery of JSON Wek Keys as per RFC 7517 | JSON payload |  
| GET | /well-known/openid-configuration | Discovery document for a OIDC provider | JSON payload |

The endpoints above do respect the RFCs but will diffe ron specific support fo rgrant types and/or client authentication, as described below

All above endpoints support the indication of a provider with `/idp/<provider name>` prefix. You do not need to add a prefix for the *default* provider.
See more about providers below.

**Providers**

This service has support to simulate multiple == OAuth2 providers  == A provider does:
- Offer an identity pool with users, credentials, OIDC scopes and roles (user credentials are password-based only)
- Offer a client pool with client ID's and secrets and respective total list of OIDC scopes
- Offer a login page
- Offer a `/me` user profile call
- May offer a extended role sets and a role set selection page (which supersedes any roles associated to the user)
- Indicate the accepted grant types for both /authorization and /token endpoints
- hold the (set of) RSA private and public key pairs for signing and validation and a possible rotation strategy

Providers are described on the `/config/config.js` file and need to have a folder with the provider `name` on the `/config/static/<provider name>/` folder. Keys and html pages need to be placed on the root of a provider folder.

***Available providers***
| Provider name |  Grant support on /authorize | Grant support on /token |  Client Auth | Extra roles? | Keys?(*) | 
| --- | --- | --- | --- | --- | --- |
| default | code | authorization_code <br> client_credentials <br> refresh_token <br> * (*) refresh tokens are provided only via authorizaton code grants* | basic auth | no |  two sets | 
| mesa | code | authorization_code <br> refresh_token <br> * (*) refresh tokens are provided only via authorizaton code grants* | basic auth | yes |  one set | 

***Available users***
| Provider name | Username | Password | Roles | 
| --- | --- | --- | --- |
| default | user1@domain.com | user1 | Store, Quote | 
| default | lda1p | pwd | Store, Quote, Data | 
| mesa | mesa@mesa.com | mesa | Store, Quote, Mesaman | 

***Available clients***
| Provider name | Client ID | Secret | Total scopes | 
| --- | --- | --- | --- |
| default | C1I3NT | secret | email, openid, profile, admin | 
| default | SIMPLE | secret | email, openid, profile | 

(*) you can control how keys are used when there's more than one set available via the `providers.<name>.token.key.use` field. If the field contains `null` the keys will be randomly selected when a /token produces a JWT. if the field contains a key name present on the key set collection, if will use that key.

You can also change token and refresh token expiration for the Oauth2 providers in the config file.

## Extra features

The two available providers do implement a `/validate` test app. If you hit it, the app will run the flow below and display the results
- ask for a user login
- redirects back to itself with an authorization code
- call /token with the clients infomred above for each provider
- decode the resulting JWT
- grab JWKS url from teh openid-config document for the informed `iss`
- fetch the JWKS url
- validate the JWT signature
You can also input a base64 JWT via `/validate?authorization=<the JWT>` and the app will skip the authorization step.  

## How to run

- No provision for SSL at this point
- You can change the `port` on the config.js file. It deafults to 8080.
- The service can run by either having a backing persistence or in-memory only. Change the "db.provider" on config.js to either **local** or **mongo**.
- The **mongo** provider needs connection to a **MONGODB version 5.0.4 or newer** . You can express the configuration in the `mongo` field of the config.js file:
-- **address**, defaults to 127.0.0.1
-- **user**, defaults to null (no auth)
-- **password**, defaults to null (no auth)
-- **connection options**, defaults to null
-- **database name**, defaults to *authnz*
-- The database table and indexes in mongo will be created automatically if not present
- the **local** provider is ephemeral and any data is lost wehn the service stops
- Run the service with `nodejs server.js`

## How to add/modify data

The `config.js` file has a `collections` object that represents all the tables in local or mongo db providers. The collections hava e `data` array where you can add both **users, clients or roles** for the two available providers.
If you are using a mongo db provider, make sure you drop the `authnz` prior to running the service after changing the base data.

## Requests for help

- Add SSL support, please!
- Add SCRAM password transport, please!
- Dockerize me!
- Fix the bugs. There's a lot of them.

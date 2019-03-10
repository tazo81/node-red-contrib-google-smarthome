/**
 * NodeRED Google SmartHome
 * Copyright (C) 2018 Michael Jacobsen.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

const express = require('express');
const path    = require('path');
const util    = require('util');

/******************************************************************************************************************
 * HttpAuth
 *
 */
class HttpAuth {
    constructor() {

    }
    //
    //
    //
    httpAuthRegister() {
        let me = this;

        /**
         * expecting something like the following:
         *
         * GET https://myservice.example.com/auth? \
         *   client_id=GOOGLE_CLIENT_ID
         *      - The Google client ID you registered with Google.
         *   &redirect_uri=REDIRECT_URI
         *      - The URL to which to send the response to this request
         *   &state=STATE_STRING
         *      - A bookkeeping value that is passed back to Google unchanged
         *          in the result
         *   &response_type=code
         *      - The string code
         */
        this.app.get('/oauth', function(req, res) {
            me.debug('HttpAuth:httpAuthRegister(/oauth)');

            let clientId     = req.query.client_id;
            let redirectUri  = req.query.redirect_uri;
            let state        = req.query.state;
            let responseType = req.query.response_type;
            let authCode     = req.query.code;
        
            if ('code' != responseType) {
                me.debug('HttpAuth:httpAuthRegister(/oauth): response_type ' + responseType + ' must equal "code"');
                return res.status(500)
                    .send('response_type ' + responseType + ' must equal "code"');
            }
        
            if (!me.isValidClient(clientId)) {
                me.debug('HttpAuth:httpAuthRegister(/oauth): client_id ' + clientId + ' invalid');
                return res.status(500).send('client_id ' + clientId + ' invalid');
            }
        
            // if you have an authcode use that
            if (authCode) {
                me.debug('HttpAuth:httpAuthRegister(/oauth): if you have an authcode use that');
                return res.redirect(util.format('%s?code=%s&state=%s', redirectUri, authCode, state));
            }
        
            let user = req.session.user;

            // redirect anonymous users to login page
            if (!user) {
                me.debug('HttpAuth:httpAuthRegister(/oauth): redirect anonymous users to login page');
                return res.redirect(util.format(
                  'login?client_id=%s&redirect_uri=%s&redirect=%s&state=%s',
                  clientId, encodeURIComponent(redirectUri), req.path, state));
            }
        
            me.debug('HttpAuth:httpAuthRegister(/oauth): login successful; user.name = ' + user.name);
            authCode = me.generateAuthCode(user.uid, clientId);
        
            if (authCode) {
                me.debug('HttpAuth:httpAuthRegister(/oauth): authCode successful; authCode = ' + authCode);
                return res.redirect(util.format('%s?code=%s&state=%s', redirectUri, authCode, state));
            }

            me.debug('HttpAuth:httpAuthRegister(/oauth): something went wrong');

            return res.status(400).send('something went wrong');
        });
        /**
         * client_id=GOOGLE_CLIENT_ID
         * &client_secret=GOOGLE_CLIENT_SECRET
         * &response_type=token
         * &grant_type=authorization_code
         * &code=AUTHORIZATION_CODE
         *
         * OR
         *
         *
         * client_id=GOOGLE_CLIENT_ID
         * &client_secret=GOOGLE_CLIENT_SECRET
         * &response_type=token
         * &grant_type=refresh_token
         * &refresh_token=REFRESH_TOKEN
         */
        this.app.all('/token', function(req, res) {
            me.debug('HttpAuth:httpAuthRegister(/token): query = ' + JSON.stringify(req.query));
            me.debug('HttpAuth:httpAuthRegister(/token): body = ' + JSON.stringify(req.body));
        
            let clientId     = req.query.client_id     ? req.query.client_id     : req.body.client_id;
            let clientSecret = req.query.client_secret ? req.query.client_secret : req.body.client_secret;
            let grantType    = req.query.grant_type    ? req.query.grant_type    : req.body.grant_type;
    
            if (!clientId || !clientSecret) {
                me.debug('HttpAuth:httpAuthRegister(/token): missing required parameter');
                return res.status(400).send('missing required parameter');
            }
    
            let client = me.getClient(clientId, clientSecret);

            me.debug('HttpAuth:httpAuthRegister(/token): client = ' + JSON.stringify(client));
            if (!client) {
                me.debug('HttpAuth:httpAuthRegister(/token): incorrect client data');
                return res.status(400).send('incorrect client data');
            }
    
            if ('authorization_code' == grantType) {
                return me.handleAuthCode(req, res);
            } else if ('refresh_token' == grantType) {
                return me.handleRefreshToken(req, res);
            } else {
                me.debug('HttpAuth:httpAuthRegister(/token): grant_type ' + grantType + ' is not supported');
                return res.status(400)
                    .send('grant_type ' + grantType + ' is not supported');
            }
    
        });
        //
        //
        // 
        this.app.use('/login', express.static(path.join(__dirname, 'frontend/login.html')));
        //
        // post login
        //
        this.app.post('/login', function(req, res) {
            me.debug('HttpAuth:httpAuthRegister(/login): body = ' + JSON.stringify(req.body));

            let user = me.getUser(req.body.username, req.body.password);
            if (!user) {
                process.nextTick(() => {
                    me.emit('/login', 'invalid user', req.body.username, req.body.password);
                });
    
                me.debug('HttpAuth:httpAuthRegister(/login): invalid user');
                return res.redirect(util.format(
                    '%s?client_id=%s&redirect_uri=%s&state=%s&response_type=code',
                    'frontend', req.body.client_id,
                    encodeURIComponent(req.body.redirect_uri), req.body.state));
            }
          
            me.debug('HttpAuth:httpAuthRegister(/login): logging in; user = ' + JSON.stringify(user));
            req.session.user = user;
          
            // successful logins should send the user back to /oauth/
            let path = decodeURIComponent(req.body.redirect) || 'frontend';
          
            me.debug('HttpAuth:httpAuthRegister(/login): login successful; user = ' + user.name);
            let authCode = me.generateAuthCode(user.uid, req.body.client_id);
          
            if (authCode) {
                process.nextTick(() => {
                    me.emit('/login', 'authCode successful', req.body.username, req.body.password);
                });

                me.debug('HttpAuth:httpAuthRegister(/login): authCode successful; authCode = ' + authCode);
                return res.redirect(util.format('%s?code=%s&state=%s',
                    decodeURIComponent(req.body.redirect_uri), authCode, req.body.state));
            } else {
                process.nextTick(() => {
                    me.emit('/login', 'authCode failed', req.body.username, req.body.password);
                });

                me.debug('HttpAuth:httpAuthRegister(/login): authCode failed');
                return res.redirect(util.format(
                    '%s?client_id=%s&redirect_uri=%s&state=%s&response_type=code',
                    path, req.body.client_id, encodeURIComponent(req.body.redirect_uri),
                    req.body.state));
            }
        });
    }
    /******************************************************************************************************************
     * private methods
     *
     */

    /**
     * @return {{}}
     * {
     *   token_type: "bearer",
     *   access_token: "ACCESS_TOKEN",
     *   refresh_token: "REFRESH_TOKEN"
     * }
     */
    handleAuthCode(req, res) {
        this.debug('HttpAuth:handleAuthCode(): req.query = ' + JSON.stringify(req.query));
        let clientId     = req.query.client_id     ? req.query.client_id     : req.body.client_id;
        let clientSecret = req.query.client_secret ? req.query.client_secret : req.body.client_secret;
        let code         = req.query.code          ? req.query.code          : req.body.code;
      
        let client = this.getClient(clientId, clientSecret);
      
        if (!code) {
            this.debug('HttpAuth:handleAuthCode(): missing required parameter');
            return res.status(400).send('missing required parameter');
        }
        if (!client) {
            this.debug('HttpAuth:handleAuthCode(): invalid client id or secret; clientId = ' + clientId + ", clientSecret = " + clientSecret);
            return res.status(400).send('invalid client id or secret');
        }
      
        let authCode = this.getAuthCode(code);
        if (!authCode) {
            this.debug('HttpAuth:handleAuthCode(): invalid code');
            return res.status(400).send('invalid code');
        }
        if (new Date(authCode.expiresAt) < Date.now()) {
            this.debug('HttpAuth:handleAuthCode(): expired code');
            return res.status(400).send('expired code');
        }
        if (authCode.clientId != clientId) {
            this.debug('HttpAuth:handleAuthCode(): invalid code - wrong client; authCode = ' + authCode);
            return res.status(400).send('invalid code - wrong client');
        }
      
        let token = this.getAccessToken(code);
        if (!token) {
            this.debug('HttpAuth:handleAuthCode(): unable to generate a token; code = ' + code);
            return res.status(400).send('unable to generate a token');
        }
      
        this.debug('HttpAuth:handleAuthCode(): respond success; token = ' + JSON.stringify(token));
        return res.status(200).json(token);
    }
    /**
     * @return {{}}
     * {
     *   token_type: "bearer",
     *   access_token: "ACCESS_TOKEN",
     * }
     */
    handleRefreshToken(req, res) {
        let clientId     = req.query.client_id     ? req.query.client_id : req.body.client_id;
        let clientSecret = req.query.client_secret ? req.query.client_secret : req.body.client_secret;
        let refreshToken = req.query.refresh_token ? req.query.refresh_token : req.body.refresh_token;
      
        let client = this.getClient(clientId, clientSecret);
        if (!client) {
            this.debug('HttpAuth:handleAuthCode(): invalid client id or secret; clientId = ' + clientId + ", clientSecret = " + clientSecret);
            return res.status(500).send('invalid client id or secret');
        }
      
        if (!refreshToken) {
            this.debug('HttpAuth:handleAuthCode(): missing required parameter');
            return res.status(500).send('missing required parameter');
        }
      
        res.status(200).json({
            token_type: 'bearer',
            access_token: refreshToken,
        });
    }
}

module.exports = HttpAuth;

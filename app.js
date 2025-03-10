require('dotenv').config();
const express = require('express');
const request = require('request');
const crypto = require('crypto');
const cors = require('cors');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirect_uri = 'http://localhost:8888/callback';

console.log(client_id);

const generateRandomString = (length) => {
	return crypto.randomBytes(60).toString('hex').slice(0, length);
};

const stateKey = 'spotify_auth_state';

const app = express();

app
	.use(express.static(__dirname + '/public'))
	.use(cors())
	.use(cookieParser());

app.get('/login', function(req, res) {
	const state = generateRandomString(16);
	res.cookie(stateKey, state);

	// your application requests authorization
	const scope = 'user-read-private user-read-email playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative user-library-read user-library-modify streaming user-modify-playback-state';
	res.redirect(
		'https://accounts.spotify.com/authorize?' +
		querystring.stringify({
			response_type: 'code',
			client_id: client_id,
			scope: scope,
			redirect_uri: redirect_uri,
			state: state,
		}),
	);
});

app.get('/callback', function(req, res) {
	// your application requests refresh and access tokens
	// after checking the state parameter

	const code = req.query.code || null;
	const state = req.query.state || null;
	const storedState = req.cookies ? req.cookies[stateKey] : null;

	if (state === null || state !== storedState) {
		res.redirect(
			'/#' +
			querystring.stringify({
				error: 'state_mismatch',
			}),
		);
	}
	else {
		res.clearCookie(stateKey);
		const authOptions = {
			url: 'https://accounts.spotify.com/api/token',
			form: {
				code: code,
				redirect_uri: redirect_uri,
				grant_type: 'authorization_code',
			},
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				Authorization:
					'Basic ' +
					new Buffer.from(client_id + ':' + client_secret).toString('base64'),
			},
			json: true,
		};

		request.post(authOptions, function(error, response, body) {
			if (!error && response.statusCode === 200) {
				const access_token = body.access_token,
					refresh_token = body.refresh_token;

				const options = {
					url: 'https://api.spotify.com/v1/me',
					headers: { Authorization: 'Bearer ' + access_token },
					json: true,
				};

				// use the access token to access the Spotify Web API
				request.get(options, function(error, response, body) {
					console.log(body);
				});

				// we can also pass the token to the browser to make requests from there
				res.redirect(
					'/#' +
					querystring.stringify({
						access_token: access_token,
						refresh_token: refresh_token,
					}),
				);
			}
			else {
				res.redirect(
					'/#' +
					querystring.stringify({
						error: 'invalid_token',
					}),
				);
			}
		});
	}
});

app.get('/refresh_token', function(req, res) {
	const refresh_token = req.query.refresh_token;
	const authOptions = {
		url: 'https://accounts.spotify.com/api/token',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			Authorization:
				'Basic ' +
				new Buffer.from(client_id + ':' + client_secret).toString('base64'),
		},
		form: {
			grant_type: 'refresh_token',
			refresh_token: refresh_token,
		},
		json: true,
	};

	request.post(authOptions, function(error, response, body) {
		if (!error && response.statusCode === 200) {
			const access_token = body.access_token,
				refresh_token = body.refresh_token;
			res.send({
				access_token: access_token,
				refresh_token: refresh_token,
			});
		}
	});
});

console.log('Listening on 8888');
app.listen(8888);

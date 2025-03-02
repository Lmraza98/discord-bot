import SpotifyWebApi from 'spotify-web-api-node';
import { config } from 'dotenv';
import express from 'express';
import open from 'open';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config();

// Define the required scopes for Spotify API
const SPOTIFY_SCOPES = [
	'user-read-private',
	'user-read-email',
	'user-read-currently-playing',
	'user-read-playback-state',
	'playlist-modify-public',
	'playlist-modify-private',
	'playlist-read-private',
	'playlist-read-collaborative',
];

// Create a new instance of the SpotifyWebApi
const spotifyApi = new SpotifyWebApi({
	clientId: process.env.CLIENT_ID,
	clientSecret: process.env.CLIENT_SECRET,
	redirectUri: process.env.REDIRECT_URI || 'http://localhost:8888/callback',
});

// Start the authentication server
const startAuthServer = async () => {
	const app = express();
	const PORT = 8888;
	let server;

	return new Promise((resolve, reject) => {
		app.get('/callback', async (req, res) => {
			const code = req.query.code;
			
			try {
				// Exchange the authorization code for access and refresh tokens
				const data = await spotifyApi.authorizationCodeGrant(code);
				
				const accessToken = data.body['access_token'];
				const refreshToken = data.body['refresh_token'];
				
				// Update the .env file with the new tokens
				const envPath = join(__dirname, '../../.env');
				const envContent = (await import('fs')).readFileSync(envPath, 'utf8');
				let updatedContent = envContent
					.replace(/SPOTIFY_ACCESS_TOKEN=.*/, `SPOTIFY_ACCESS_TOKEN=${accessToken}`)
					.replace(/SPOTIFY_REFRESH_TOKEN=.*/, `SPOTIFY_REFRESH_TOKEN=${refreshToken}`);
				
				await writeFile(envPath, updatedContent);
				
				res.send('Authentication successful! You can now close this window and restart your bot.');
				
				// Close the server after successful authentication
				if (server) {
					server.close();
				}
				
				resolve({ accessToken, refreshToken });
			} catch (error) {
				console.error('Error during authentication:', error);
				res.send('Authentication failed. Please check the console for more information.');
				reject(error);
			}
		});
		
		server = app.listen(PORT, () => {
			console.log(`Authentication server started on http://localhost:${PORT}`);
			
			// Generate the authorization URL
			const authUrl = spotifyApi.createAuthorizeURL(SPOTIFY_SCOPES, 'spotify-auth-state');
			console.log('Please open the following URL in your browser to authenticate with Spotify:');
			console.log(authUrl);
			
			// Try to open the URL automatically
			try {
				open(authUrl);
			} catch (error) {
				console.error('Could not open the browser automatically. Please open the URL manually.');
			}
		});
	});
};

export { startAuthServer };

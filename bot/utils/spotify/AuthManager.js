/**
 * AuthManager.js
 * Handles Spotify authentication, token refresh, and authorization.
 */

import SpotifyWebApi from 'spotify-web-api-node';
import { config } from 'dotenv';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables from the parent directory
config({ path: join(__dirname, '../../..', '.env') });

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

class AuthManager {
	constructor() {
		this.spotifyApi = new SpotifyWebApi({
			clientId: process.env.CLIENT_ID,
			clientSecret: process.env.CLIENT_SECRET,
			accessToken: process.env.SPOTIFY_ACCESS_TOKEN,
			refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
			redirectUri: process.env.REDIRECT_URI || 'http://localhost:8888/callback',
		});

		// Set up automatic token refresh every 30 minutes
		this.tokenRefreshInterval = setInterval(() => {
			this.refreshAccessToken();
		}, 30 * 60 * 1000);

		// Initial token refresh
		this.refreshAccessToken();
	}

	/**
     * Generate authorization URL with proper scopes
     * @returns {string} Authorization URL
     */
	getAuthorizationUrl() {
		return this.spotifyApi.createAuthorizeURL(SPOTIFY_SCOPES, 'spotify-auth-state');
	}

	/**
     * Refresh the Spotify access token
     * @returns {Promise<void>}
     */
	async refreshAccessToken() {
		try {
			const data = await this.spotifyApi.refreshAccessToken();
			const newAccessToken = data.body['access_token'];
			this.spotifyApi.setAccessToken(newAccessToken);

			// Update the .env file with the new access token
			const envPath = join(__dirname, '../../../.env');
			const envContent = (await import('fs')).readFileSync(envPath, 'utf8');
			const updatedContent = envContent.replace(
				/SPOTIFY_ACCESS_TOKEN=.*/,
				`SPOTIFY_ACCESS_TOKEN=${newAccessToken}`,
			);
			await writeFile(envPath, updatedContent);

			console.log('Spotify access token refreshed successfully');
		}
		catch (error) {
			console.error('Error refreshing access token:', error);
			throw error;
		}
	}

	/**
     * Execute an operation with automatic token refresh on 401 errors
     * @param {Function} operation - The operation to execute
     * @returns {Promise<any>} The result of the operation
     */
	async executeWithTokenRefresh(operation) {
		try {
			return await operation();
		}
		catch (error) {
			if (error.statusCode === 401) {
				await this.refreshAccessToken();
				return await operation();
			}
			throw error;
		}
	}

	/**
     * Get the Spotify API instance
     * @returns {Object} The Spotify API instance
     */
	getSpotifyApi() {
		return this.spotifyApi;
	}
}

export default new AuthManager();
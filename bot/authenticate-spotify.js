#!/usr/bin/env node

import { startAuthServer } from './utils/SpotifyAuthHelper.js';

console.log('Starting Spotify authentication process...');
console.log('This will open a browser window for you to authorize the application.');
console.log('Make sure to approve ALL requested permissions.');

try {
	await startAuthServer();
	console.log('Authentication successful!');
	console.log('New tokens have been saved to your .env file.');
	console.log('You can now start your bot with: node bot.js');
	process.exit(0);
}
catch (error) {
	console.error('Authentication failed:', error);
	process.exit(1);
} 
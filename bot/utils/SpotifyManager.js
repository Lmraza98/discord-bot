import SpotifyWebApi from 'spotify-web-api-node';
import { config } from 'dotenv';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables from the parent directory
config({ path: join(__dirname, '../..', '.env') });

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

class SpotifyManager {
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

		// Store playlist IDs
		this.archivePlaylistId = null;
		this.activePlaylistId = null;

		// Track the currently playing song
		this.currentlyPlaying = null;
		this.client = null;

		// Set up polling for currently playing track
		this.pollingInterval = null;
	}

	// Generate authorization URL with proper scopes
	getAuthorizationUrl() {
		return this.spotifyApi.createAuthorizeURL(SPOTIFY_SCOPES, 'spotify-auth-state');
	}

	// Set the Discord client for emitting events
	setClient(client) {
		this.client = client;
		// Start polling once we have the client
		this.startPolling();
	}

	// Start polling for currently playing track
	startPolling() {
		if (this.pollingInterval) {
			clearInterval(this.pollingInterval);
		}

		// Poll every 5 seconds
		this.pollingInterval = setInterval(() => {
			this.checkCurrentlyPlaying();
		}, 5000);

		// Initial check
		this.checkCurrentlyPlaying();
	}

	// Stop polling
	stopPolling() {
		if (this.pollingInterval) {
			clearInterval(this.pollingInterval);
			this.pollingInterval = null;
		}
	}

	// Check what's currently playing on Spotify and sync with bot
	async checkCurrentlyPlaying() {
		if (!this.client) return;

		try {
			const currentTrack = await this.getCurrentlyPlaying();

			// If nothing is playing, skip
			if (!currentTrack) {
				return;
			}

			// If the track has changed, update and emit event
			if (!this.currentlyPlaying || this.currentlyPlaying.id !== currentTrack.id) {
				const previousTrack = this.currentlyPlaying;
				this.currentlyPlaying = currentTrack;

				// If we had a previous track, emit songFinish
				if (previousTrack) {
					console.log(`Spotify changed tracks: "${previousTrack.name}" finished`);
					this.client.emit('spotifyTrackChanged', previousTrack, currentTrack);
				}

				// Log and emit the new track
				console.log(`Now playing on Spotify: "${currentTrack.name}" by ${currentTrack.artists[0].name}`);
				this.client.emit('spotifyNowPlaying', currentTrack);
			}
		}
		catch (error) {
			console.error('Error checking currently playing track:', error);
		}
	}

	// Get the currently playing track from Spotify
	async getCurrentlyPlaying() {
		return this.executeWithTokenRefresh(async () => {
			const response = await this.spotifyApi.getMyCurrentPlayingTrack();

			if (response.body && response.body.item) {
				return response.body.item;
			}

			return null;
		});
	}

	async refreshAccessToken() {
		try {
			const data = await this.spotifyApi.refreshAccessToken();
			const newAccessToken = data.body['access_token'];
			this.spotifyApi.setAccessToken(newAccessToken);

			// Update the .env file with the new access token
			const envPath = join(__dirname, '../../.env');
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

	async getArchivePlaylist() {
		return this.executeWithTokenRefresh(async () => {
			const today = new Date();
			const playlistName = today.toLocaleDateString('en-US', {
				month: '2-digit',
				day: '2-digit',
				year: 'numeric',
			}).replace(/\//g, '-') + ' Archive';

			// Get user's playlists
			const playlists = await this.spotifyApi.getUserPlaylists();
			const existingPlaylist = playlists.body.items.find(
				playlist => playlist.name === playlistName,
			);

			if (existingPlaylist) {
				this.archivePlaylistId = existingPlaylist.id;
				return existingPlaylist;
			}

			// Create new playlist if it doesn't exist
			const newPlaylist = await this.spotifyApi.createPlaylist(playlistName, {
				description: `Archive of all songs added on ${playlistName}`,
				public: true,
			});

			this.archivePlaylistId = newPlaylist.body.id;
			return newPlaylist.body;
		});
	}

	async getActivePlaylist() {
		return this.executeWithTokenRefresh(async () => {
			const playlistName = 'Active Stream Playlist';

			// Get user's playlists
			const playlists = await this.spotifyApi.getUserPlaylists();
			const existingPlaylist = playlists.body.items.find(
				playlist => playlist.name === playlistName,
			);

			if (existingPlaylist) {
				this.activePlaylistId = existingPlaylist.id;
				return existingPlaylist;
			}

			// Create new playlist if it doesn't exist
			const newPlaylist = await this.spotifyApi.createPlaylist(playlistName, {
				description: 'Currently playing songs from the stream',
				public: true,
			});

			this.activePlaylistId = newPlaylist.body.id;
			return newPlaylist.body;
		});
	}

	async searchTrack(title, url) {
		return this.executeWithTokenRefresh(async () => {
			// First try to extract track ID if URL is a Spotify URL
			const spotifyUrlMatch = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
			if (spotifyUrlMatch) {
				return spotifyUrlMatch[1];
			}

			// If not a Spotify URL, search by title
			const searchResults = await this.spotifyApi.searchTracks(title);
			if (searchResults.body.tracks.items.length > 0) {
				return searchResults.body.tracks.items[0].id;
			}

			throw new Error('Track not found on Spotify');
		});
	}

	async addToPlaylists(title, url) {
		return this.executeWithTokenRefresh(async () => {
			const trackId = await this.searchTrack(title, url);
			const trackUri = `spotify:track:${trackId}`;

			// Get both playlists
			const archivePlaylist = await this.getArchivePlaylist();
			const activePlaylist = await this.getActivePlaylist();

			// Add to both playlists
			await this.spotifyApi.addTracksToPlaylist(archivePlaylist.id, [trackUri]);
			await this.spotifyApi.addTracksToPlaylist(activePlaylist.id, [trackUri]);

			return {
				archivePlaylistName: archivePlaylist.name,
				activePlaylistName: activePlaylist.name,
			};
		});
	}

	async removeFromActivePlaylist(trackId) {
		return this.executeWithTokenRefresh(async () => {
			if (!this.activePlaylistId) {
				await this.getActivePlaylist();
			}

			if (!this.activePlaylistId) {
				console.error('Failed to get active playlist ID');
				return false;
			}

			try {
				// Get the tracks in the active playlist
				const playlistTracks = await this.spotifyApi.getPlaylistTracks(this.activePlaylistId);

				// Find the track to remove
				const trackToRemove = playlistTracks.body.items.find(item =>
					item.track && (
						item.track.id === trackId ||
						item.track.uri === `spotify:track:${trackId}`
					),
				);

				if (trackToRemove) {
					// Remove the track from the active playlist
					await this.spotifyApi.removeTracksFromPlaylist(
						this.activePlaylistId,
						[{ uri: trackToRemove.track.uri }],
					);
					console.log(`Successfully removed track ${trackToRemove.track.name} from active playlist`);
					return true;
				}
				else {
					console.log(`Track with ID ${trackId} not found in active playlist`);
					return false;
				}
			}
			catch (error) {
				console.error(`Error removing track ${trackId} from active playlist:`, error);
				return false;
			}
		});
	}

	async getFirstTrackFromActivePlaylist() {
		return this.executeWithTokenRefresh(async () => {
			if (!this.activePlaylistId) {
				await this.getActivePlaylist();
			}

			// Get the tracks in the active playlist
			const playlistTracks = await this.spotifyApi.getPlaylistTracks(this.activePlaylistId, {
				limit: 1,
			});

			if (playlistTracks.body.items.length > 0) {
				return playlistTracks.body.items[0].track;
			}

			return null;
		});
	}

	async getPlaylistLength() {
		return this.executeWithTokenRefresh(async () => {
			// Get the tracks in the active playlist
			const playlistTracks = await this.spotifyApi.getPlaylistTracks(this.activePlaylistId);
			return playlistTracks.length;
		});
	}

	async ensurePlayingFromCorrectPlaylists() {
		return this.executeWithTokenRefresh(async () => {
			try {
				// Get current playback state
				const playbackState = await this.spotifyApi.getMyCurrentPlaybackState();

				// Get the Active Stream Playlist and check if it has tracks
				const activePlaylist = await this.getActivePlaylist();
				const activeTracks = await this.spotifyApi.getPlaylistTracks(activePlaylist.id);
				const hasActiveTracks = activeTracks.body.items.length > 0;

				console.log(`Active Stream Playlist has ${activeTracks.body.items.length} tracks`);

				// If nothing is playing or no active device, start playing from correct playlist
				if (!playbackState.body || !playbackState.body.is_playing || !playbackState.body.device) {
					console.log('Nothing is currently playing or no active device, starting playback from correct playlist');
					return await this.switchToCorrectPlaylist();
				}

				// Check if currently playing from a playlist
				if (playbackState.body.context && playbackState.body.context.type === 'playlist') {
					const playlistId = playbackState.body.context.uri.split(':').pop();

					// Get the current playlist name for better logging
					const currentPlaylistData = await this.spotifyApi.getPlaylist(playlistId);
					const currentPlaylistName = currentPlaylistData.body.name;
					console.log(`Currently playing from playlist: ${currentPlaylistName}`);

					// If Active Stream Playlist has tracks, we should be playing from it
					if (hasActiveTracks) {
						if (playlistId === activePlaylist.id) {
							console.log('Already playing from Active Stream Playlist');
							return true;
						}
						console.log('Should be playing from Active Stream Playlist, switching');
						return await this.switchToCorrectPlaylist();
					}

					// If Active Stream Playlist is empty, we should be playing from New Playlist
					const playlists = await this.spotifyApi.getUserPlaylists();
					const newPlaylist = playlists.body.items.find(p => p.name === 'New Playlist');

					if (newPlaylist) {
						// Check if New Playlist has tracks
						const newPlaylistTracks = await this.spotifyApi.getPlaylistTracks(newPlaylist.id);
						console.log(`New Playlist has ${newPlaylistTracks.body.items.length} tracks`);

						// Ensure New Playlist has songs
						if (newPlaylistTracks.body.items.length === 0) {
							console.log('New Playlist is empty, populating it');
							await this.ensureNewPlaylistHasFiveSongs();
						}

						if (playlistId === newPlaylist.id) {
							console.log('Already playing from New Playlist (Active Stream Playlist is empty)');
							return true;
						}
					}

					// If playing from wrong playlist, switch to correct one
					console.log('Playing from wrong playlist, switching to correct playlist');
					return await this.switchToCorrectPlaylist();
				}
				else {
					// Not playing from a playlist (might be playing from Liked Songs or an album)
					console.log('Not playing from a playlist, switching to correct playlist');
					return await this.switchToCorrectPlaylist();
				}
			}
			catch (error) {
				console.error('Error ensuring playing from correct playlists:', error);
				return false;
			}
		});
	}

	async switchToCorrectPlaylist() {
		return this.executeWithTokenRefresh(async () => {
			try {
				// Check if there's an active device
				const devices = await this.spotifyApi.getMyDevices();
				const activeDevice = devices.body.devices.find(device => device.is_active);

				// If no active device, try to activate the first available device
				if (!activeDevice && devices.body.devices.length > 0) {
					const deviceToActivate = devices.body.devices[0];
					console.log(`No active device found. Activating device: ${deviceToActivate.name}`);
					await this.spotifyApi.transferMyPlayback([deviceToActivate.id]);

					// Wait a moment for the device to activate
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
				else if (!activeDevice) {
					console.log('No devices available to play on');
					return false;
				}

				// Get the Active Stream Playlist
				const activePlaylist = await this.getActivePlaylist();
				const activeTracks = await this.spotifyApi.getPlaylistTracks(activePlaylist.id);

				// If Active Stream Playlist has tracks, play from it
				if (activeTracks.body.items.length > 0) {
					console.log(`Playing from Active Stream Playlist (${activeTracks.body.items.length} tracks available)`);
					await this.spotifyApi.play({
						context_uri: `spotify:playlist:${activePlaylist.id}`,
					});
					return true;
				}

				// Otherwise, ensure New Playlist has tracks and play from it
				await this.ensureNewPlaylistHasFiveSongs();

				// Get the New Playlist
				const playlists = await this.spotifyApi.getUserPlaylists();
				const newPlaylist = playlists.body.items.find(p => p.name === 'New Playlist');

				if (newPlaylist) {
					const newPlaylistTracks = await this.spotifyApi.getPlaylistTracks(newPlaylist.id);
					console.log(`Playing from New Playlist (${newPlaylistTracks.body.items.length} tracks available)`);

					if (newPlaylistTracks.body.items.length === 0) {
						console.log('Warning: New Playlist is empty. Attempting to populate it.');
						await this.ensureNewPlaylistHasFiveSongs();
					}

					await this.spotifyApi.play({
						context_uri: `spotify:playlist:${newPlaylist.id}`,
					});
					return true;
				}

				console.log('Could not find any playlist to play from');
				return false;
			}
			catch (error) {
				console.error('Error switching to correct playlist:', error);
				return false;
			}
		});
	}

	async ensureNewPlaylistHasFiveSongs() {
		return this.executeWithTokenRefresh(async () => {
			// Get user's playlists
			const playlists = await this.spotifyApi.getUserPlaylists();
			const newPlaylist = playlists.body.items.find(
				playlist => playlist.name === 'New Playlist',
			);

			if (!newPlaylist) {
				// Create the New Playlist if it doesn't exist
				const createdPlaylist = await this.spotifyApi.createPlaylist('New Playlist', {
					description: 'Random songs from Liked Music',
					public: true,
				});

				console.log('Created New Playlist');
				return await this.populateNewPlaylist(createdPlaylist.body.id);
			}

			// Check current tracks in the New Playlist
			const playlistTracks = await this.spotifyApi.getPlaylistTracks(newPlaylist.id);

			if (playlistTracks.body.items.length >= 5) {
				console.log('New Playlist already has 5 or more songs');
				return newPlaylist;
			}

			// Clear the current playlist and add 5 new random songs
			return await this.populateNewPlaylist(newPlaylist.id);
		});
	}

	async populateNewPlaylist(playlistId) {
		return this.executeWithTokenRefresh(async () => {
			// Clear the current playlist
			const currentTracks = await this.spotifyApi.getPlaylistTracks(playlistId);
			if (currentTracks.body.items.length > 0) {
				const tracksToRemove = currentTracks.body.items.map(item => ({
					uri: item.track.uri,
				}));
				await this.spotifyApi.removeTracksFromPlaylist(playlistId, tracksToRemove);
				console.log('Cleared existing tracks from New Playlist');
			}

			// Get user's saved tracks (Liked songs)
			const savedTracks = await this.spotifyApi.getMySavedTracks({
				limit: 50,
			});

			if (savedTracks.body.items.length === 0) {
				console.log('No liked songs found in Spotify account');
				return null;
			}

			// Randomly select 5 tracks
			const randomTracks = [];
			const usedIndices = new Set();
			const maxTracks = Math.min(5, savedTracks.body.items.length);

			while (randomTracks.length < maxTracks) {
				const randomIndex = Math.floor(Math.random() * savedTracks.body.items.length);

				if (!usedIndices.has(randomIndex)) {
					usedIndices.add(randomIndex);
					randomTracks.push(savedTracks.body.items[randomIndex].track);
				}
			}

			// Add the random tracks to the playlist
			if (randomTracks.length > 0) {
				const trackUris = randomTracks.map(track => track.uri);
				await this.spotifyApi.addTracksToPlaylist(playlistId, trackUris);
				console.log(`Added ${randomTracks.length} random tracks to New Playlist`);

				// Get the updated playlist
				const playlists = await this.spotifyApi.getUserPlaylists();
				return playlists.body.items.find(playlist => playlist.id === playlistId);
			}

			return null;
		});
	}
}

export default new SpotifyManager();
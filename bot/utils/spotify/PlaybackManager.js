/**
 * PlaybackManager.js
 * Manages Spotify playback control, currently playing track, and playlist switching.
 */

import authManager from './AuthManager.js';
import queueManager from './QueueManager.js';
import playlistManager from './PlaylistManager.js';

class PlaybackManager {
	constructor() {
		this.spotifyApi = authManager.getSpotifyApi();
		this.currentlyPlaying = null;
		this.client = null;
		this.pollingInterval = null;
	}

	/**
     * Set the Discord client for emitting events
     * @param {Object} client - The Discord client
     */
	setClient(client) {
		this.client = client;

		// Set up event listener for track changes
		if (this.client) {
			this.client.on('spotifyTrackChanged', async (previousTrack, currentTrack) => {
				console.log(`Track changed from "${previousTrack.name}" to "${currentTrack.name}"`);

				// Remove the previous track from the Active Stream Playlist
				try {
					await playlistManager.removeFromActivePlaylist(previousTrack.id);
				}
				catch (error) {
					console.error(`Error removing track ${previousTrack.id} from Active Stream Playlist:`, error);
				}

				// Ensure we're playing from the correct playlist
				try {
					await this.ensurePlayingFromCorrectPlaylists();
				}
				catch (error) {
					console.error('Error ensuring playing from correct playlists:', error);
				}
			});
		}

		// Start polling once we have the client
		this.startPolling();
	}

	/**
     * Start polling for currently playing track
     */
	startPolling() {
		if (this.pollingInterval) clearInterval(this.pollingInterval);
		let debounceTimeout;
		this.pollingInterval = setInterval(() => {
			clearTimeout(debounceTimeout);
			debounceTimeout = setTimeout(() => this.checkCurrentlyPlaying(), 1000);
		}, 5000);
		this.checkCurrentlyPlaying();
	}

	/**
     * Stop polling
     */
	stopPolling() {
		if (this.pollingInterval) {
			clearInterval(this.pollingInterval);
			this.pollingInterval = null;
		}
	}

	/**
     * Check what's currently playing on Spotify and sync with bot
     * @returns {Promise<void>}
     */
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

				// If we had a previous track, emit songFinish and remove from Active Stream Playlist
				if (previousTrack) {
					console.log(`Spotify changed tracks: "${previousTrack.name}" finished`);

					// Remove the finished track from Active Stream Playlist
					try {
						await playlistManager.removeFromActivePlaylist(previousTrack.id);
					}
					catch (error) {
						console.error(`Error removing track ${previousTrack.id} from Active Stream Playlist:`, error);
					}

					this.client.emit('spotifyTrackChanged', previousTrack, currentTrack);
				}

				// Log and emit the new track
				console.log(`Now playing on Spotify: "${currentTrack.name}" by ${currentTrack.artists[0].name}`);
				this.client.emit('spotifyNowPlaying', currentTrack);

				// Ensure we're playing from the correct playlist
				this.ensurePlayingFromCorrectPlaylists().catch(error => {
					console.error('Error ensuring playing from correct playlists:', error);
				});
			}
		}
		catch (error) {
			console.error('Error checking currently playing track:', error);
		}
	}

	/**
     * Get the currently playing track
     * @returns {Promise<Object|null>} The currently playing track or null
     */
	async getCurrentlyPlaying() {
		return queueManager.queueOperation(async () => {
		  try {
				const result = await authManager.executeWithTokenRefresh(async () => {
			  const data = await this.spotifyApi.getMyCurrentPlayingTrack();

			  // If nothing is playing
			  if (!data.body || !data.body.item) {
						console.log('[getCurrentlyPlaying] No track currently playing');
						return null;
			  }

			  return {
						id: data.body.item.id,
						name: data.body.item.name,
						artists: data.body.item.artists,
						album: data.body.item.album.name,
						url: data.body.item.external_urls.spotify,
						progress_ms: data.body.progress_ms,
						duration_ms: data.body.item.duration_ms,
			  };
				});
				return result;
		  }
			catch (error) {
				console.error('[getCurrentlyPlaying] Error getting currently playing track:', error);
				return null;
		  }
		}, 'getCurrentlyPlaying');
	  }

	/**
     * Ensure playing from the correct playlist
     * @returns {Promise<boolean>} Whether the operation was successful
     */
	async ensurePlayingFromCorrectPlaylists(forcePlaylistId = null) {
		return queueManager.queueOperation(async () => {
			try {
				const result = await authManager.executeWithTokenRefresh(async () => {
					console.log('[ensurePlayingFromCorrectPlaylists] Start:', new Date().toISOString());
					const playbackState = await this.spotifyApi.getMyCurrentPlaybackState();
					console.log('[ensurePlayingFromCorrectPlaylists] Playback checked:', playbackState.body?.is_playing ? 'Playing' : 'Not playing');

					if (!playbackState.body || !playbackState.body.is_playing || !playbackState.body.device) {
						console.log('[ensurePlayingFromCorrectPlaylists] No playback/device, switching...');
						return await this.switchToCorrectPlaylist(forcePlaylistId);
					}

					const currentUri = playbackState.body.context?.uri;
					const activePlaylistId = '28EfM0PlgAZmCHPwN7x0P0';
					const newPlaylistId = '0zshsyToiYO1jlKSHb7bTU';

					// If forcing a specific playlist, switch to it
					if (forcePlaylistId && currentUri !== `spotify:playlist:${forcePlaylistId}`) {
						console.log(`[ensurePlayingFromCorrectPlaylists] Forcing switch to playlist ${forcePlaylistId}`);
						return await this.switchToCorrectPlaylist(forcePlaylistId);
					}

					if (currentUri === `spotify:playlist:${activePlaylistId}` || currentUri === `spotify:playlist:${newPlaylistId}`) {
						console.log('[ensurePlayingFromCorrectPlaylists] Already on correct playlist');
						return true;
					}

					console.log('[ensurePlayingFromCorrectPlaylists] Switching to correct playlist...');
					const switchResult = await this.switchToCorrectPlaylist(forcePlaylistId);
					return switchResult;
				});
				return result;
			}
			catch (error) {
				console.error('[ensurePlayingFromCorrectPlaylists] Error:', error.message);
				return false;
			}
		}, 'ensurePlayingFromCorrectPlaylists');
	}

	/**
     * Switch to the correct playlist based on available tracks
     * @returns {Promise<boolean>} Whether the operation was successful
     */

	async switchToCorrectPlaylist(forcePlaylistId = null) {
		return queueManager.queueOperation(async () => {
			try {
				const result = await authManager.executeWithTokenRefresh(async () => {
					console.log('[switchToCorrectPlaylist] Starting...');
					const [devices, activeTracks] = await Promise.all([
						this.spotifyApi.getMyDevices(),
						this.spotifyApi.getPlaylistTracks('28EfM0PlgAZmCHPwN7x0P0'),
					]);

					const activeDevice = devices.body.devices.find(device => device.is_active) || devices.body.devices[0];
					if (!activeDevice) {
						console.log('[switchToCorrectPlaylist] No devices');
						return false;
					}
					if (!activeDevice.is_active) {
						console.log(`[switchToCorrectPlaylist] Activating: ${activeDevice.name}`);
						await this.spotifyApi.transferMyPlayback([activeDevice.id], { play: false });
					}

					const targetPlaylistId = forcePlaylistId || (activeTracks.body.items.length > 0 ?
						'28EfM0PlgAZmCHPwN7x0P0' : '0zshsyToiYO1jlKSHb7bTU');

					if (targetPlaylistId === '0zshsyToiYO1jlKSHb7bTU') {
						const newTracks = await this.spotifyApi.getPlaylistTracks(targetPlaylistId);
						if (newTracks.body.items.length === 0) {
							console.log('[switchToCorrectPlaylist] New Playlist empty, populating...');
							await playlistManager.ensureNewPlaylistHasFiveSongs();
						}
					}

					console.log(`[switchToCorrectPlaylist] Playing playlist ${targetPlaylistId}`);
					await this.spotifyApi.play({ context_uri: `spotify:playlist:${targetPlaylistId}` });
					console.log('[switchToCorrectPlaylist] Switched successfully');
					return true;
				});
				return result;
			}
			catch (error) {
				console.error('[switchToCorrectPlaylist] Error:', error.message);
				return false;
			}
		}, 'switchToCorrectPlaylist');
	}
}

export default new PlaybackManager();
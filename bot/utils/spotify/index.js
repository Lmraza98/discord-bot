/**
 * index.js
 * Main entry point for the Spotify module that exports all the components.
 */

import authManager from './AuthManager.js';
import playlistManager from './PlaylistManager.js';
import playbackManager from './PlaybackManager.js';
import queueManager from './QueueManager.js';

/**
 * SpotifyManager
 * Coordinates all Spotify-related functionality by providing a unified interface
 * to the various specialized managers.
 */
class SpotifyManager {
	constructor() {
		this.authManager = authManager;
		this.playlistManager = playlistManager;
		this.playbackManager = playbackManager;
		this.queueManager = queueManager;
		// Get the spotifyApi instance from authManager for direct access
		this.spotifyApi = authManager.getSpotifyApi();
	}

	/**
     * Get the Spotify API instance
     * @returns {Object} The Spotify API instance
     */
	getSpotifyApi() {
		return this.spotifyApi;
	}

	/**
     * Search for tracks on Spotify
     * @param {string} query - The search query
     * @param {Object} options - Optional search options
     * @returns {Promise<Object>} The search results
     */
	async searchTracks(query, options = {}) {
		return this.authManager.executeWithTokenRefresh(() => {
			return this.spotifyApi.searchTracks(query, options);
		});
	}

	/**
     * Get the authorization URL for Spotify OAuth
     * @returns {string} The authorization URL
     */
	getAuthorizationUrl() {
		return this.authManager.getAuthorizationUrl();
	}

	/**
     * Set the Discord client for event emission
     * @param {Object} client - The Discord client
     */
	setClient(client) {
		this.playbackManager.setClient(client);
	}

	/**
     * Start polling for currently playing track
     */
	startPolling() {
		this.playbackManager.startPolling();
	}

	/**
     * Stop polling for currently playing track
     */
	stopPolling() {
		this.playbackManager.stopPolling();
	}

	/**
     * Check what's currently playing on Spotify
     * @returns {Promise<void>}
     */
	async checkCurrentlyPlaying() {
		return this.playbackManager.checkCurrentlyPlaying();
	}

	/**
     * Get the currently playing track
     * @returns {Promise<Object|null>} The currently playing track or null
     */
	async getCurrentlyPlaying() {
		return this.playbackManager.getCurrentlyPlaying();
	}

	/**
     * Refresh the Spotify access token
     * @returns {Promise<void>}
     */
	async refreshAccessToken() {
		return this.authManager.refreshAccessToken();
	}

	/**
     * Execute an operation with automatic token refresh
     * @param {Function} operation - The operation to execute
     * @returns {Promise<any>} The result of the operation
     */
	async executeWithTokenRefresh(operation) {
		return this.authManager.executeWithTokenRefresh(operation);
	}

	/**
     * Get or create the archive playlist
     * @returns {Promise<Object>} The archive playlist
     */
	async getArchivePlaylist() {
		return this.playlistManager.getArchivePlaylist();
	}

	/**
     * Get or create the active playlist
     * @returns {Promise<Object>} The active playlist
     */
	async getActivePlaylist() {
		return this.playlistManager.getActivePlaylist();
	}

	/**
     * Search for a track on Spotify
     * @param {string} title - The track title
     * @param {string} url - The track URL
     * @returns {Promise<string>} The track ID
     */
	async searchTrack(title, url) {
		return this.playlistManager.searchTrack(title, url);
	}

	/**
     * Add a track to both archive and active playlists
     * @param {string} title - The track title
     * @param {string} url - The track URL
     * @returns {Promise<Object>} Information about the playlists
     */
	async addToPlaylists(title, url) {
		return this.playlistManager.addToPlaylists(title, url);
	}

	/**
     * Check if a track is in a playlist
     * @param {string} trackId - The track ID
     * @param {string} playlistId - The playlist ID
     * @returns {Promise<boolean>} Whether the track is in the playlist
     */
	async isTrackInPlaylist(trackId, playlistId) {
		return this.playlistManager.isTrackInPlaylist(trackId, playlistId);
	}

	/**
     * Remove a track from the active playlist
     * @param {string} trackId - The track ID
     * @returns {Promise<boolean>} Whether the removal was successful
     */
	async removeFromActivePlaylist(trackId) {
		return this.playlistManager.removeFromActivePlaylist(trackId);
	}

	/**
     * Handle track removal and ensure the New Playlist has exactly 5 songs
     * @param {string} trackId - The track ID
     * @param {string} trackName - The track name
     * @returns {Promise<void>}
     */
	async handleTrackRemoval(trackId, trackName) {
		return this.playlistManager.handleTrackRemoval(trackId, trackName);
	}

	/**
     * Get the first track from the active playlist
     * @returns {Promise<Object|null>} The first track or null
     */
	async getFirstTrackFromActivePlaylist() {
		return this.playlistManager.getFirstTrackFromActivePlaylist();
	}

	/**
     * Get the length of the active playlist
     * @returns {Promise<number>} The number of tracks in the playlist
     */
	async getPlaylistLength() {
		return this.playlistManager.getPlaylistLength();
	}

	/**
     * Ensure playing from the correct playlists
     * @returns {Promise<void>}
     */
	async ensurePlayingFromCorrectPlaylists() {
		return this.playbackManager.ensurePlayingFromCorrectPlaylists();
	}

	/**
     * Switch to the correct playlist
     * @returns {Promise<void>}
     */
	async switchToCorrectPlaylist() {
		return this.playbackManager.switchToCorrectPlaylist();
	}

	/**
     * Ensure the New Playlist has exactly 5 songs
     * @returns {Promise<Object>} The New Playlist
     */
	async ensureNewPlaylistHasFiveSongs() {
		return this.playlistManager.ensureNewPlaylistHasFiveSongs();
	}

	/**
     * Add multiple random songs to the New Playlist
     * @param {string} playlistId - The playlist ID
     * @param {number} count - The number of songs to add
     * @returns {Promise<boolean>} Whether the operation was successful
     */
	async addMultipleRandomSongsToNewPlaylist(playlistId, count) {
		return this.playlistManager.addMultipleRandomSongsToNewPlaylist(playlistId, count);
	}

	/**
     * Get all liked songs from the user's Spotify account
     * @returns {Promise<Array>} Array of liked songs
     */
	async getAllLikedSongs() {
		return this.playlistManager.getAllLikedSongs();
	}

	/**
     * Populate the New Playlist with random tracks
     * @param {string} playlistId - The playlist ID
     * @returns {Promise<Object|null>} The updated playlist or null
     */
	async populateNewPlaylist(playlistId) {
		return this.playlistManager.populateNewPlaylist(playlistId);
	}

	/**
     * Get tracks from a playlist
     * @param {string} playlistId - The playlist ID
     * @returns {Promise<Object>} The playlist tracks
     */
	async getPlaylistTracks(playlistId) {
		return this.playlistManager.getPlaylistTracks(playlistId);
	}

	/**
     * Get the current playback state
     * @returns {Promise<Object>} The current playback state
     */
	async getMyCurrentPlaybackState() {
		return this.authManager.executeWithTokenRefresh(() => {
			return this.spotifyApi.getMyCurrentPlaybackState();
		});
	}

	/**
     * Get a playlist by ID
     * @param {string} playlistId - The playlist ID
     * @returns {Promise<Object>} The playlist
     */
	async getPlaylist(playlistId) {
		return this.authManager.executeWithTokenRefresh(() => {
			return this.spotifyApi.getPlaylist(playlistId);
		});
	}

	/**
     * Start or resume playback
     * @param {Object} options - Playback options
     * @returns {Promise<Object>} The playback response
     */
	async play(options) {
		return this.authManager.executeWithTokenRefresh(() => {
			return this.spotifyApi.play(options);
		});
	}
}

// Create and export a singleton instance
const spotifyManager = new SpotifyManager();
export default spotifyManager;

// Also export individual managers for direct access if needed
export {
	authManager,
	playlistManager,
	playbackManager,
	queueManager,
};
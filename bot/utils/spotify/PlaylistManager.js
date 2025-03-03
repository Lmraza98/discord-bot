/**
 * PlaylistManager.js
 * Manages Spotify playlist operations including creating, updating, and managing tracks.
 */

import authManager from './AuthManager.js';
import queueManager from './QueueManager.js';

class PlaylistManager {
	constructor() {
		this.spotifyApi = authManager.getSpotifyApi();
		this.archivePlaylistId = null;
		this.activePlaylistId = null;
		this.activePlaylistTracks = [];
		this.newPlaylistTracks = [];
		this.lastRefresh = 0;
		this.likedSongsCache = [];
		this.lastLikedSongsRefresh = 0;
	}

	validateTrackId(trackId) {
		if (!trackId) return false;
		// Spotify track IDs are base-62 strings of exactly 22 characters
		// They only contain alphanumeric characters (no special chars)
		return /^[A-Za-z0-9]{22}$/.test(trackId);
	}

	normalizeTrackId(trackId) {
		if (!trackId) return null;
		// Remove any Spotify URI prefix if present
		const match = trackId.match(/(?:spotify:track:)?([A-Za-z0-9]{22})/);
		return match ? match[1] : null;
	}

	async refreshPlaylists() {
		// Only refresh if cache is older than 10 seconds
		if (Date.now() - this.lastRefresh < 10000) {
			return;
		}

		try {
			// Fetch both playlists in parallel
			const [active, newPl, activeTracks, newTracks] = await Promise.all([
				this.getActivePlaylist(),
				this.spotifyApi.getPlaylist('0zshsyToiYO1jlKSHb7bTU'),
				this.activePlaylistId ? this.spotifyApi.getPlaylistTracks(this.activePlaylistId) : Promise.resolve({ body: { items: [] } }),
				this.spotifyApi.getPlaylistTracks('0zshsyToiYO1jlKSHb7bTU'),
			]);

			this.activePlaylistTracks = activeTracks.body.items;
			this.newPlaylistTracks = newTracks.body.items;
			this.lastRefresh = Date.now();
		} catch (error) {
			console.error('[refreshPlaylists] Error refreshing playlists:', error.message);
		}
	}

	async isTrackInPlaylist(trackId, playlistId) {
		await this.refreshPlaylists();
		const tracks = playlistId === this.activePlaylistId ? this.activePlaylistTracks : this.newPlaylistTracks;
		return tracks.some(item => item.track?.id === trackId);
	}

	/**
     * Get or create the archive playlist for the current date
     * @returns {Promise<Object>} The archive playlist
     */
	async getArchivePlaylist() {
		return queueManager.queueOperation(async () => {
		  try {
				const result = await authManager.executeWithTokenRefresh(async () => {
			  const today = new Date();
			  const playlistName = today.toLocaleDateString('en-US', {
						month: '2-digit',
						day: '2-digit',
						year: 'numeric',
			  }).replace(/\//g, '-') + ' Archive';
			  console.log(`[getArchivePlaylist] Looking for playlist: ${playlistName}`);

			  // Get user's playlists
			  const playlists = await this.spotifyApi.getUserPlaylists();
			  console.log(`[getArchivePlaylist] Fetched ${playlists.body.items.length} user playlists`);

			  const existingPlaylist = playlists.body.items.find(
						playlist => playlist.name === playlistName,
			  );

			  if (existingPlaylist) {
						this.archivePlaylistId = existingPlaylist.id;
						console.log(`[getArchivePlaylist] Found existing archive playlist with ID: ${existingPlaylist.id}`);
						return existingPlaylist;
			  }

			  // Create new playlist if it doesn't exist
			  console.log(`[getArchivePlaylist] Archive playlist not found, creating new one: ${playlistName}`);
			  const newPlaylist = await this.spotifyApi.createPlaylist(playlistName, {
						description: `Archive of all songs added on ${playlistName}`,
						public: true,
			  });
			  this.archivePlaylistId = newPlaylist.body.id;
			  console.log(`[getArchivePlaylist] Created new archive playlist with ID: ${newPlaylist.body.id}`);
			  return newPlaylist.body;
				});
				return result;
		  }
			catch (error) {
				console.error('[getArchivePlaylist] Error getting or creating archive playlist:', error);
				return null;
		  }
		}, 'getArchivePlaylist');
	  }

	/**
     * Get or create the active stream playlist
     * @returns {Promise<Object>} The active stream playlist
     */
	async getActivePlaylist() {
		return queueManager.queueOperation(async () => {
		  try {
				const result = await authManager.executeWithTokenRefresh(async () => {
			  const playlistName = 'Active Stream Playlist';
			  console.log(`[getActivePlaylist] Looking for playlist: ${playlistName}`);

			  // Get user's playlists
			  const playlists = await this.spotifyApi.getUserPlaylists();
			  console.log(`[getActivePlaylist] Fetched ${playlists.body.items.length} user playlists`);

			  const existingPlaylist = playlists.body.items.find(
						playlist => playlist.name === playlistName,
			  );

			  if (existingPlaylist) {
						this.activePlaylistId = existingPlaylist.id;
						console.log(`[getActivePlaylist] Found existing active playlist with ID: ${existingPlaylist.id}`);
						return existingPlaylist;
			  }

			  // Create new playlist if it doesn't exist
			  console.log('[getActivePlaylist] Active Stream Playlist not found, creating new one');
			  const newPlaylist = await this.spotifyApi.createPlaylist(playlistName, {
						description: 'Currently playing songs from the stream',
						public: true,
			  });
			  this.activePlaylistId = newPlaylist.body.id;
			  console.log(`[getActivePlaylist] Created new active playlist with ID: ${newPlaylist.body.id}`);
			  return newPlaylist.body;
				});
				return result;
		  }
			catch (error) {
				console.error('[getActivePlaylist] Error getting or creating active playlist:', error);
				return null;
				// Return null on failure to indicate no playlist was retrieved
		  }
		}, 'getActivePlaylist');
	  }

	/**
     * Search for a track on Spotify
     * @param {string} title - The track title to search for
     * @param {string} url - Optional Spotify URL
     * @returns {Promise<string>} The track ID
     */
	async searchTrack(title, url) {
		return queueManager.queueOperation(async () => {
			try {
				const result = await authManager.executeWithTokenRefresh(async () => {
					console.log(`[searchTrack] Searching for track: "${title}"${url ? ` with URL: ${url}` : ''}`);

					// Extract ID from URL if provided
					if (url) {
						const spotifyUrlMatch = url.match(/spotify\.com\/track\/([A-Za-z0-9]{22})/);
						if (spotifyUrlMatch) {
							const trackId = this.normalizeTrackId(spotifyUrlMatch[1]);
							if (!this.validateTrackId(trackId)) {
								console.error(`[searchTrack] Invalid track ID extracted from URL: ${trackId}`);
								throw new Error('Invalid track ID from URL');
							}
							console.log(`[searchTrack] Extracted track ID from URL: ${trackId}`);
							return trackId;
						}
					}

					// Search by title
					const searchResults = await this.spotifyApi.searchTracks(title);
					console.log(`[searchTrack] Search returned ${searchResults.body.tracks.items.length} results for "${title}"`);

					if (!searchResults.body?.tracks?.items || searchResults.body.tracks.items.length === 0) {
						console.log(`[searchTrack] No tracks found for "${title}"`);
						throw new Error(`No tracks found for "${title}"`);
					}

					// Find the first valid track ID
					let trackId = null;
					for (const item of searchResults.body.tracks.items) {
						const normalizedId = this.normalizeTrackId(item?.id);
						if (normalizedId && this.validateTrackId(normalizedId)) {
							trackId = normalizedId;
							break;
						}
					}

					if (!trackId) {
						console.error(`[searchTrack] No valid track ID found in search results for "${title}"`, searchResults.body.tracks.items);
						throw new Error('No valid track ID found in search results');
					}

					console.log(`[searchTrack] Found track ID: ${trackId}`);
					return trackId;
				});
				return result;
			}
			catch (error) {
				console.error(`[searchTrack] Error searching for track "${title}":`, error.message);
				throw error;
			}
		}, `searchTrack-${title}`);
	}

	/**
     * Add a track to both archive and active playlists
     * @param {string} title - The track title
     * @param {string} url - The track URL
     * @returns {Promise<Object>} Information about the playlists
     */
	async addToPlaylists(title, url, isPriority = false) {
		return queueManager.queueOperation(async () => {
			try {
				const trackId = await this.searchTrack(title, url);
				const normalizedId = this.normalizeTrackId(trackId);
				if (!normalizedId || !this.validateTrackId(normalizedId)) {
					return { success: false, error: 'Invalid track ID' };
				}

				const trackUri = `spotify:track:${normalizedId}`;

				// Get both playlist IDs in parallel if needed
				if (!this.archivePlaylistId || !this.activePlaylistId) {
					const [archive, active] = await Promise.all([
						!this.archivePlaylistId ? this.getArchivePlaylist() : Promise.resolve(null),
						!this.activePlaylistId ? this.getActivePlaylist() : Promise.resolve(null)
					]);
					if (archive) this.archivePlaylistId = archive.id;
					if (active) this.activePlaylistId = active.id;
				}

				if (!this.archivePlaylistId || !this.activePlaylistId) {
					return { success: false, error: 'Failed to get playlists' };
				}

				// Check if track exists in active playlist
				const isInActivePlaylist = this.activePlaylistTracks?.some(item => 
					this.normalizeTrackId(item.track?.id) === normalizedId
				);

				// Add to both playlists in parallel
				await Promise.all([
					this.spotifyApi.addTracksToPlaylist(this.archivePlaylistId, [trackUri])
						.catch(error => console.error(`Failed to add to archive: ${error.message}`)),
					!isInActivePlaylist ? 
						this.spotifyApi.addTracksToPlaylist(this.activePlaylistId, [trackUri])
						.catch(error => {
							console.error(`Failed to add to active: ${error.message}`);
							throw error; // Propagate active playlist errors
						}) : 
						Promise.resolve()
				]);

				// Only check new playlist if needed
				const newPlaylistNeedsUpdate = this.newPlaylistTracks?.length !== 5;
				if (newPlaylistNeedsUpdate) {
					await this.ensureNewPlaylistHasFiveSongs();
				}

				return {
					success: true,
					archivePlaylistName: `${new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }).replace(/\//g, '-')} Archive`,
					activePlaylistName: 'Active Stream Playlist',
				};
			}
			catch (error) {
				return { success: false, error: error.message };
			}
		}, `addToPlaylists-${title}`, isPriority);
	}

	/**
     * Check if a track is already in a playlist
     * @param {string} trackId - The track ID
     * @param {string} playlistId - The playlist ID
     * @returns {Promise<boolean>} Whether the track is in the playlist
     */
	// async isTrackInPlaylist(trackId, playlistId) {
	// 	return queueManager.queueOperation(async () => {
	// 	  try {
	// 			const result = await authManager.executeWithTokenRefresh(async () => {
	// 		  console.log(`[isTrackInPlaylist] Checking if track ${trackId} is in playlist ${playlistId}`);

	// 		  // Get all tracks in the playlist
	// 		  const playlistTracks = await this.spotifyApi.getPlaylistTracks(playlistId);
	// 		  console.log(`[isTrackInPlaylist] Fetched ${playlistTracks.body.items.length} tracks from playlist ${playlistId}`);

	// 		  // Check if the track is already in the playlist
	// 		  const isPresent = playlistTracks.body.items.some(item =>
	// 					item.track && (
	// 			  item.track.id === trackId ||
	// 			  item.track.uri === `spotify:track:${trackId}`
	// 					),
	// 		  );
	// 		  console.log(`[isTrackInPlaylist] Track ${trackId} is ${isPresent ? 'present' : 'not present'} in playlist ${playlistId}`);

	// 		  return isPresent;
	// 			});
	// 			return result;
	// 	  }
	// 		catch (error) {
	// 			console.error(`[isTrackInPlaylist] Error checking if track ${trackId} is in playlist ${playlistId}:`, error);
	// 			return false;
	// 	  }
	// 	}, `isTrackInPlaylist-${trackId}-${playlistId}`);
	//   }

	/**
     * Remove a track from the active playlist
     * @param {string} trackId - The track ID to remove
     * @returns {Promise<boolean>} Whether the removal was successful
     */
	async removeFromActivePlaylist(trackId) {
		return queueManager.queueOperation(async () => {
		  try {
				const result = await authManager.executeWithTokenRefresh(async () => {
			  console.log(`[removeFromActivePlaylist] Attempting to remove track ${trackId} from active playlist`);

			  // Ensure activePlaylistId is set
			  if (!this.activePlaylistId) {
						console.log('[removeFromActivePlaylist] Active playlist ID not set, fetching...');
						await this.getActivePlaylist();
			  }

			  if (!this.activePlaylistId) {
						console.error('[removeFromActivePlaylist] Failed to get active playlist ID');
						return false;
			  }
			  console.log(`[removeFromActivePlaylist] Using active playlist ID: ${this.activePlaylistId}`);

			  // Get the tracks in the active playlist
			  const playlistTracks = await this.spotifyApi.getPlaylistTracks(this.activePlaylistId);
			  console.log(`[removeFromActivePlaylist] Fetched ${playlistTracks.body.items.length} tracks from active playlist`);

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
						console.log(`[removeFromActivePlaylist] Successfully removed track "${trackToRemove.track.name}" from active playlist`);

						// Check if the active playlist is the New Playlist
						const playlists = await this.spotifyApi.getUserPlaylists();
						const newPlaylist = playlists.body.items.find(p => p.name === 'New Playlist');

						if (newPlaylist && this.activePlaylistId === newPlaylist.id) {
				  console.log('[removeFromActivePlaylist] Track was removed from New Playlist, ensuring it still has exactly 5 songs');
				  await this.ensureNewPlaylistHasFiveSongs();
						}

						return true;
			  }
					else {
						console.log(`[removeFromActivePlaylist] Track with ID ${trackId} not found in active playlist`);
						return false;
			  }
				});
				return result;
		  }
			catch (error) {
				console.error(`[removeFromActivePlaylist] Error removing track ${trackId} from active playlist:`, error);
				return false;
		  }
		}, `removeFromActivePlaylist-${trackId}`);
	  }

	/**
     * Get the first track from the active playlist
     * @returns {Promise<Object|null>} The first track or null if none
     */
	async getFirstTrackFromActivePlaylist() {
		return queueManager.queueOperation(async () => {
		  try {
				const result = await authManager.executeWithTokenRefresh(async () => {
			  console.log('[getFirstTrackFromActivePlaylist] Fetching first track from active playlist');

			  // Ensure activePlaylistId is set
			  if (!this.activePlaylistId) {
						console.log('[getFirstTrackFromActivePlaylist] Active playlist ID not set, fetching...');
						await this.getActivePlaylist();
			  }

			  if (!this.activePlaylistId) {
						console.error('[getFirstTrackFromActivePlaylist] Failed to get active playlist ID');
						return null;
			  }
			  console.log(`[getFirstTrackFromActivePlaylist] Using active playlist ID: ${this.activePlaylistId}`);

			  // Get the tracks in the active playlist
			  const playlistTracks = await this.spotifyApi.getPlaylistTracks(this.activePlaylistId, {
						limit: 1,
			  });
			  console.log(`[getFirstTrackFromActivePlaylist] Fetched ${playlistTracks.body.items.length} tracks from active playlist`);

			  if (playlistTracks.body.items.length > 0) {
						const track = playlistTracks.body.items[0].track;
						console.log(`[getFirstTrackFromActivePlaylist] Found first track: "${track.name}"`);
						return track;
			  }

			  console.log('[getFirstTrackFromActivePlaylist] No tracks found in active playlist');
			  return null;
				});
				return result;
		  }
			catch (error) {
				console.error('[getFirstTrackFromActivePlaylist] Error fetching first track from active playlist:', error);
				return null;
		  }
		}, 'getFirstTrackFromActivePlaylist');
	  }

	/**
     * Get the length of the active playlist
     * @returns {Promise<number>} The number of tracks in the playlist
     */
	async getPlaylistLength() {
		return queueManager.queueOperation(async () => {
		  try {
				const result = await authManager.executeWithTokenRefresh(async () => {
			  console.log('[getPlaylistLength] Fetching length of active playlist');

			  // Ensure activePlaylistId is set
			  if (!this.activePlaylistId) {
						console.log('[getPlaylistLength] Active playlist ID not set, fetching...');
						await this.getActivePlaylist();
			  }

			  if (!this.activePlaylistId) {
						console.error('[getPlaylistLength] Failed to get active playlist ID');
						return 0;
			  }
			  console.log(`[getPlaylistLength] Using active playlist ID: ${this.activePlaylistId}`);

			  // Get the tracks in the active playlist
			  const playlistTracks = await this.spotifyApi.getPlaylistTracks(this.activePlaylistId);
			  const length = playlistTracks.body.items.length;
			  console.log(`[getPlaylistLength] Active playlist has ${length} tracks`);

			  return length;
				});
				return result;
		  }
			catch (error) {
				console.error('[getPlaylistLength] Error fetching playlist length:', error);
				return 0;
		  }
		}, 'getPlaylistLength');
	  }

	/**
     * Handle track removal and ensure the New Playlist has exactly 5 songs
     * @param {string} trackId - The track ID to remove
     * @param {string} trackName - The track name for logging
     * @returns {Promise<void>}
     */
	async handleTrackRemoval(trackId, trackName, removalCount = 1) {
		return queueManager.queueOperation(async () => {
			try {
				const normalizedId = this.normalizeTrackId(trackId);
				if (!normalizedId || !this.validateTrackId(normalizedId)) {
					return false;
				}

				// Get all necessary playlist IDs in parallel at start
				if (!this.activePlaylistId || !this.newPlaylistId) {
					const playlists = await this.spotifyApi.getUserPlaylists();
					const [active, newPl] = [
						playlists.body.items.find(p => p.name === 'Active Stream Playlist'),
						playlists.body.items.find(p => p.name === 'New Playlist'),
					];
					if (active) this.activePlaylistId = active.id;
					if (newPl) this.newPlaylistId = newPl.id;
				}

				// Batch all removals together
				const removals = [];
				const trackUri = `spotify:track:${normalizedId}`;

				if (this.activePlaylistId) {
					removals.push(
						this.spotifyApi.removeTracksFromPlaylist(this.activePlaylistId, [{ uri: trackUri }])
							.catch(error => console.error(`Failed to remove from active playlist: ${error.message}`)),
					);
				}

				if (this.newPlaylistId) {
					removals.push(
						this.spotifyApi.removeTracksFromPlaylist(this.newPlaylistId, [{ uri: trackUri }])
							.catch(error => console.error(`Failed to remove from new playlist: ${error.message}`)),
					);

					// Prepare replacement songs in parallel while removals are happening
					const replacementPromise = (async () => {
						if (removalCount > 0) {
							const likedSongs = await this.getAllLikedSongs();
							if (likedSongs.length > 0) {
								this.shuffleArray(likedSongs);
								const songsToAdd = likedSongs
									.slice(0, removalCount)
									.map(s => s.uri || `spotify:track:${s.id}`)
									.filter(uri => this.validateTrackId(this.normalizeTrackId(uri)));

								if (songsToAdd.length > 0) {
									await this.spotifyApi.addTracksToPlaylist(this.newPlaylistId, songsToAdd);
								}
							}
						}
					})();
					removals.push(replacementPromise);
				}

				// Execute all operations in parallel
				await Promise.all(removals);

				// Quick check if we need to ensure 5 songs
				const newPlaylistTracks = this.newPlaylistId ? 
					await this.spotifyApi.getPlaylistTracks(this.newPlaylistId) : 
					{ body: { items: [] } };

				if (newPlaylistTracks.body.items.length !== 5) {
					await this.ensureNewPlaylistHasFiveSongs();
				}

				return true;
			} catch (error) {
				console.error(`[handleTrackRemoval] Error: ${error.message}`);
				return false;
			}
		}, `handleTrackRemoval-${trackId}`, true); // Mark as priority
	}

	/**
     * Ensure the New Playlist has exactly 5 songs
     * @returns {Promise<Object>} The New Playlist
     */
	async ensureNewPlaylistHasFiveSongs() {
		return queueManager.queueOperation(async () => {
		  try {
				const result = await authManager.executeWithTokenRefresh(async () => {
			  console.log('[ensureNewPlaylistHasFiveSongs] Starting...');
			  const playlists = await this.spotifyApi.getUserPlaylists();
			  console.log(`[ensureNewPlaylistHasFiveSongs] Fetched ${playlists.body.items.length} playlists`);
			  let newPlaylist = playlists.body.items.find(p => p.name === 'New Playlist');

			  if (!newPlaylist) {
						console.log('[ensureNewPlaylistHasFiveSongs] Creating New Playlist...');
						newPlaylist = await this.spotifyApi.createPlaylist('New Playlist', {
				  description: 'Random songs from Liked Music',
				  public: true,
						}).then(res => res.body);
						return await this.populateNewPlaylist(newPlaylist.id);
			  }

			  console.log(`[ensureNewPlaylistHasFiveSongs] Using New Playlist ID: ${newPlaylist.id}`);
			  const playlistTracks = await this.spotifyApi.getPlaylistTracks(newPlaylist.id);
			  console.log(`[ensureNewPlaylistHasFiveSongs] Fetched ${playlistTracks.body.items.length} tracks`);

			  const currentCount = playlistTracks.body.items.length;
			  const targetCount = 5;

			  if (currentCount === 0) {
						console.log('[ensureNewPlaylistHasFiveSongs] Playlist empty, populating...');
						return await this.populateNewPlaylist(newPlaylist.id);
			  }
					else if (currentCount < targetCount) {
						const songsNeeded = targetCount - currentCount;
						console.log(`[ensureNewPlaylistHasFiveSongs] Adding ${songsNeeded} songs...`);
						const likedSongs = await this.getAllLikedSongs();
						if (likedSongs.length === 0) return newPlaylist;

						this.shuffleArray(likedSongs);
						const trackUris = likedSongs.slice(0, songsNeeded).map(song => song.uri || `spotify:track:${song.id}`).filter(Boolean);
						await this.spotifyApi.addTracksToPlaylist(newPlaylist.id, trackUris);
						console.log(`[ensureNewPlaylistHasFiveSongs] Added ${songsNeeded} songs`);
			  }
					else if (currentCount > targetCount) {
						const tracksToRemove = playlistTracks.body.items.slice(targetCount).map(item => ({ uri: item.track.uri }));
						await this.spotifyApi.removeTracksFromPlaylist(newPlaylist.id, tracksToRemove);
						console.log(`[ensureNewPlaylistHasFiveSongs] Removed ${currentCount - targetCount} excess tracks`);
			  }
					else {
						console.log('[ensureNewPlaylistHasFiveSongs] Already has 5 songs');
			  }

			  const finalTracks = await this.spotifyApi.getPlaylistTracks(newPlaylist.id);
			  console.log(`[ensureNewPlaylistHasFiveSongs] Final count: ${finalTracks.body.items.length} tracks`);
			  return newPlaylist;
				});
				return result;
		  }
			catch (error) {
				console.error(`[ensureNewPlaylistHasFiveSongs] Error: ${error.message}`);
				return null;
		  }
		}, 'ensureNewPlaylistHasFiveSongs');
	  }

	/**
     * Add multiple random songs to the New Playlist
     * @param {string} playlistId - The playlist ID
     * @param {number} count - The number of songs to add
     * @returns {Promise<boolean>} Whether the operation was successful
     */
	async addMultipleRandomSongsToNewPlaylist(playlistId, count) {
		return queueManager.queueOperation(async () => {
		  try {
				const result = await authManager.executeWithTokenRefresh(async () => {
			  console.log(`[addMultipleRandomSongsToNewPlaylist] === Starting addMultipleRandomSongsToNewPlaylist for playlist ${playlistId}, count: ${count} ===`);

			  // Get a random selection of liked songs
			  const likedSongs = await this.getAllLikedSongs();
			  console.log(`[addMultipleRandomSongsToNewPlaylist] Fetched ${likedSongs.length} liked songs`);

			  if (likedSongs.length === 0) {
						console.error('[addMultipleRandomSongsToNewPlaylist] No liked songs found to add to the playlist');
						return false;
			  }

			  console.log(`[addMultipleRandomSongsToNewPlaylist] Found ${likedSongs.length} liked songs, selecting ${count} random songs`);

			  // Shuffle the array of liked songs
			  this.shuffleArray(likedSongs);

			  // Select the required number of random songs
			  const randomSongs = likedSongs.slice(0, Math.min(count, likedSongs.length));
			  if (randomSongs.length === 0) {
						console.error('[addMultipleRandomSongsToNewPlaylist] No random songs selected');
						return false;
			  }

			  console.log('[addMultipleRandomSongsToNewPlaylist] Selected the following random songs:');
			  randomSongs.forEach((song, index) => {
						console.log(`[addMultipleRandomSongsToNewPlaylist]   ${index + 1}. "${song.name}" by ${song.artists || 'Unknown Artist'}`);
			  });

			  // Add songs one by one for better reliability
			  let addedCount = 0;

			  for (const song of randomSongs) {
						try {
				  const uri = song.uri || `spotify:track:${song.id}`;
				  console.log(`[addMultipleRandomSongsToNewPlaylist] Adding song "${song.name}" to New Playlist`);
				  await this.spotifyApi.addTracksToPlaylist(playlistId, [uri]);
				  addedCount++;
				  console.log(`[addMultipleRandomSongsToNewPlaylist] Successfully added "${song.name}"`);
				  await new Promise(resolve => setTimeout(resolve, 100));
						}
						catch (error) {
				  console.error(`[addMultipleRandomSongsToNewPlaylist] Error adding song "${song.name}": ${error.message}`);
				  await new Promise(resolve => setTimeout(resolve, 100));
				  try {
								const uri = song.uri || `spotify:track:${song.id}`;
								await this.spotifyApi.addTracksToPlaylist(playlistId, [uri]);
								addedCount++;
								console.log(`[addMultipleRandomSongsToNewPlaylist] Added song "${song.name}" after retry`);
				  }
							catch (retryError) {
								console.error(`[addMultipleRandomSongsToNewPlaylist] Retry failed for song "${song.name}": ${retryError.message}`);
				  }
						}
			  }

			  console.log(`[addMultipleRandomSongsToNewPlaylist] Successfully added ${addedCount} out of ${randomSongs.length} songs to New Playlist`);

			  // Verify the songs were added
			  try {
						await new Promise(resolve => setTimeout(resolve, 1000));
						const updatedTracks = await this.spotifyApi.getPlaylistTracks(playlistId);
						console.log(`[addMultipleRandomSongsToNewPlaylist] After adding songs, New Playlist has ${updatedTracks.body.items.length} tracks`);
			  }
					catch (verifyError) {
						console.error(`[addMultipleRandomSongsToNewPlaylist] Error verifying playlist after adding songs: ${verifyError.message}`);
			  }

			  return addedCount > 0;
				});
				return result;
		  }
			catch (error) {
				console.error(`[addMultipleRandomSongsToNewPlaylist] Error in addMultipleRandomSongsToNewPlaylist for playlist ${playlistId}: ${error.message}`);
				return false;
		  }
		}, `addMultipleRandomSongsToNewPlaylist-${playlistId}-${count}`);
	  }

	/**
     * Populate the New Playlist with random tracks
     * @param {string} playlistId - The playlist ID
     * @returns {Promise<Object|null>} The updated playlist or null
     */
	async populateNewPlaylist(playlistId) {
		return queueManager.queueOperation(async () => {
		  try {
				const result = await authManager.executeWithTokenRefresh(async () => {
			  console.log(`[populateNewPlaylist] === Starting populateNewPlaylist for playlist ${playlistId} ===`);

			  console.log('[populateNewPlaylist] Attempting to fetch current tracks...');
			  let currentTracks;
			  try {
						currentTracks = await this.spotifyApi.getPlaylistTracks(playlistId);
						console.log(`[populateNewPlaylist] Fetched ${currentTracks.body.items.length} tracks from playlist`);
			  }
					catch (error) {
						console.error(`[populateNewPlaylist] Failed to fetch playlist tracks: ${error.response?.data || error.message}`);
						throw error;
			  }

			  if (currentTracks.body.items.length > 0) {
						console.log(`[populateNewPlaylist] Clearing ${currentTracks.body.items.length} existing tracks...`);
						const batchSize = 25;
						const batches = [];
						for (let i = 0; i < currentTracks.body.items.length; i += batchSize) {
				  const batch = currentTracks.body.items.slice(i, i + batchSize);
				  batches.push(batch.map(item => ({ uri: item.track.uri })));
						}
						await Promise.all(batches.map(tracks => this.spotifyApi.removeTracksFromPlaylist(playlistId, tracks)));
						console.log('[populateNewPlaylist] Finished clearing tracks');
			  }
					else {
						console.log('[populateNewPlaylist] Playlist is already empty');
			  }

			  console.log('[populateNewPlaylist] Fetching liked songs...');
			  const allSavedTracks = await this.getAllLikedSongs();
			  if (!allSavedTracks || allSavedTracks.length === 0) {
						console.log('[populateNewPlaylist] No liked songs found');
						return null;
			  }
			  console.log(`[populateNewPlaylist] Fetched ${allSavedTracks.length} liked songs`);

			  console.log('[populateNewPlaylist] Shuffling tracks...');
			  this.shuffleArray(allSavedTracks);
			  const maxTracks = Math.min(5, allSavedTracks.length);
			  const randomTracks = allSavedTracks.slice(0, maxTracks);
			  console.log(`[populateNewPlaylist] Selected ${randomTracks.length} random tracks`);

			  if (randomTracks.length > 0) {
						const trackUris = randomTracks.map(track => track.uri || `spotify:track:${track.id}`).filter(Boolean);
						console.log(`[populateNewPlaylist] Adding ${trackUris.length} tracks to playlist in one batch...`);
						await this.spotifyApi.addTracksToPlaylist(playlistId, trackUris);
						console.log('[populateNewPlaylist] Finished adding tracks');

						const finalCheck = await this.spotifyApi.getPlaylistTracks(playlistId);
						console.log(`[populateNewPlaylist] Playlist now has ${finalCheck.body.items.length} tracks`);
						return { id: playlistId, trackCount: finalCheck.body.items.length };
			  }

			  console.log('[populateNewPlaylist] No tracks to add');
			  return null;
				});
				return result;
		  }
			catch (error) {
				console.error(`[populateNewPlaylist] Error in populateNewPlaylist for playlist ${playlistId}: ${error.message}`);
				return null;
		  }
		}, `populateNewPlaylist-${playlistId}`);
	  }

	/**
     * Get all liked songs from the user's Spotify account
     * @returns {Promise<Array>} An array of liked song objects
     */
	async getAllLikedSongs() {
		return queueManager.queueOperation(async () => {
			try {
				// Use cache if less than 5 minutes old
				if (Date.now() - this.lastLikedSongsRefresh < 300000 && this.likedSongsCache.length > 0) {
					return this.likedSongsCache;
				}

				const result = await authManager.executeWithTokenRefresh(async () => {
					const likedSongs = [];
					let offset = 0;
					const limit = 50;
					const maxSongs = 200; // Reduced from 500 to improve speed

					// Use Promise.all to fetch multiple pages in parallel
					const pagePromises = [];
					while (offset < maxSongs) {
						pagePromises.push(
							this.spotifyApi.getMySavedTracks({ limit, offset })
								.then(response => response.body.items.map(item => ({
									id: item.track.id,
									name: item.track.name,
									uri: item.track.uri,
									artists: item.track.artists.map(artist => artist.name).join(', '),
								})))
								.catch(() => [])
						);
						offset += limit;
					}

					const results = await Promise.all(pagePromises);
					results.forEach(tracks => likedSongs.push(...tracks));

					this.likedSongsCache = likedSongs;
					this.lastLikedSongsRefresh = Date.now();
					return likedSongs;
				});
				return result || [];
			} catch (error) {
				return this.likedSongsCache; // Return cached songs on error
			}
		}, 'getAllLikedSongs');
	}

	/**
     * Get tracks from a playlist
     * @param {string} playlistId - The playlist ID
     * @returns {Promise<Object>} The playlist tracks
     */
	async getPlaylistTracks(playlistId) {
		return queueManager.queueOperation(async () => {
		  try {
				const result = await authManager.executeWithTokenRefresh(async () => {
			  console.log(`[getPlaylistTracks] Fetching tracks for playlist ${playlistId}`);

			  const response = await this.spotifyApi.getPlaylistTracks(playlistId);
			  console.log(`[getPlaylistTracks] Fetched ${response.body.items.length} tracks for playlist ${playlistId}`);

			  return response;
				});
				return result;
		  }
			catch (error) {
				console.error(`[getPlaylistTracks] Error getting playlist tracks for ${playlistId}: ${error.message}`);
				return { body: { items: [] } };
		  }
		}, `getPlaylistTracks-${playlistId}`);
	  }

	/**
     * Shuffle an array using Fisher-Yates algorithm
     * @param {Array} array - The array to shuffle
     */
	shuffleArray(array) {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[array[i], array[j]] = [array[j], array[i]];
		}
	}

	/**
     * Switch to a specific playlist immediately
     * @param {string} playlistName - The name of the playlist to switch to
     * @returns {Promise<boolean>} Whether the switch was successful
     */
	async switchToPlaylist(playlistName) {
		try {
			// Get playlist ID (use cache if available)
			let playlistId;
			if (playlistName === 'Active Stream Playlist' && this.activePlaylistId) {
				playlistId = this.activePlaylistId;
			} else if (playlistName === 'New Playlist' && this.newPlaylistId) {
				playlistId = this.newPlaylistId;
			} else {
				// Fast playlist lookup
				const playlists = await this.spotifyApi.getUserPlaylists({ limit: 20 });
				const playlist = playlists.body.items.find(p => p.name === playlistName);
				if (!playlist) {
					throw new Error(`Playlist "${playlistName}" not found`);
				}
				playlistId = playlist.id;

				// Update cache
				if (playlistName === 'Active Stream Playlist') {
					this.activePlaylistId = playlistId;
				} else if (playlistName === 'New Playlist') {
					this.newPlaylistId = playlistId;
				}
			}

			// Immediately play the playlist
			await this.spotifyApi.play({
				context_uri: `spotify:playlist:${playlistId}`,
			});

			return true;
		} catch (error) {
			console.error(`Failed to switch to playlist "${playlistName}":`, error.message);
			return false;
		}
	}

	/**
     * Switch to the active stream playlist immediately
     * @returns {Promise<boolean>} Whether the switch was successful
     */
	async switchToActivePlaylist() {
		return queueManager.queueOperation(
			() => this.switchToPlaylist('Active Stream Playlist'),
			'switchPlaylist-active',
			true,
		);
	}

	/**
     * Switch to the new playlist immediately
     * @returns {Promise<boolean>} Whether the switch was successful
     */
	async switchToNewPlaylist() {
		return queueManager.queueOperation(
			() => this.switchToPlaylist('New Playlist'),
			'switchPlaylist-new',
			true,
		);
	}
}

export default new PlaylistManager();
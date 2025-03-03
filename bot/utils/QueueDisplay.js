import { EmbedBuilder } from 'discord.js';
import songQueue from './SongQueue.js';
import spotifyManager from './SpotifyManager.js';

const VOTE_EMOJIS = [
	'0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣',
	'5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣',
	'🔟', '1️⃣1️⃣', '1️⃣2️⃣', '1️⃣3️⃣', '1️⃣4️⃣',
	'1️⃣5️⃣', '1️⃣6️⃣', '1️⃣7️⃣', '1️⃣8️⃣', '1️⃣9️⃣',
];

let queueMessage = null;
let queueChannel = null;
let currentlyPlayingSong = null;
let songTimer = null;
let client = null;

export class QueueDisplay {
	static async initialize(channel, discordClient) {
		queueChannel = channel;
		client = discordClient;

		// Try to find existing queue message
		try {
			const messages = await channel.messages.fetch({ limit: 50 });
			const existingQueueMessage = messages.find(m =>
				m.author.bot &&
				m.embeds.length > 0 &&
				m.embeds[0].title === '🎵 Priority Queue',
			);

			if (existingQueueMessage) {
				await existingQueueMessage.delete();
			}
		}
		catch (error) {
			console.error('Error cleaning up old message:', error);
		}

		// Sync with Active Stream Playlist if queue is empty
		await this.syncQueueWithActivePlaylist();

		// Create new queue message
		const embed = this.createQueueEmbed();
		try {
			queueMessage = await channel.send({ embeds: [embed] });
			await this.updateReactions();
			return true;
		}
		catch (error) {
			console.error('Error creating queue message:', error);
			return false;
		}
	}

	static createQueueEmbed() {
		const queue = songQueue.getQueue();
		const description = queue.length === 0
			? 'The queue is empty! Add songs with /addsong'
			: queue.map((song, index) => {
				if (index >= VOTE_EMOJIS.length) return null;
				const voterCount = song.voters.size;
				const voterText = voterCount === 1 ? '1 vote' : `${voterCount} votes`;
				return `${VOTE_EMOJIS[index]} "${song.title}" (${voterText} - added by <@${song.addedBy}>)`;
			})
				.filter(line => line !== null)
				.join('\n');

		return new EmbedBuilder()
			.setTitle('🎵 Priority Queue')
			.setColor(0x0099FF)
			.setDescription(description)
			.setFooter({ text: 'React with emojis to vote for songs!' })
			.setTimestamp();
	}

	static async updateDisplay() {
		try {
			if (!queueMessage || !queueChannel) {
				console.log('Queue message or channel missing, attempting recovery');
				// Try to recover the message
				const messages = await queueChannel?.messages.fetch({ limit: 50 });
				queueMessage = messages?.find(m =>
					m.author.bot &&
					m.embeds.length > 0 &&
					m.embeds[0].title === '🎵 Priority Queue',
				);

				if (!queueMessage) {
					console.log('Queue message not found, reinitializing');
					// If we still can't find it, create a new one
					if (queueChannel) {
						await this.initialize(queueChannel, client);
					}
					return;
				}
			}

			// Create a fresh embed with the latest data
			const embed = this.createQueueEmbed();

			// Verify message still exists before updating
			try {
				await queueMessage.fetch();
			}
			catch (error) {
				console.log('Message no longer exists, reinitializing');
				console.error('Error fetching queue message:', error);
				if (queueChannel) {
					await this.initialize(queueChannel, client);
					return;
				}
			}

			// Update the message with the new embed
			await queueMessage.edit({ embeds: [embed] });

			// Update the reactions to match the current queue
			await this.updateReactions();
		}
		catch (error) {
			console.error('Error updating queue display:', error);
			// If edit fails, try to reinitialize
			if (queueChannel) {
				await this.initialize(queueChannel, client);
			}
		}
	}

	static async updateReactions() {
		if (!queueMessage) return;

		try {
			const queue = songQueue.getQueue();
			const currentReactions = queueMessage.reactions.cache;

			// Add missing reactions based on queue length
			for (let i = 0; i < Math.min(queue.length, VOTE_EMOJIS.length); i++) {
				const emoji = VOTE_EMOJIS[i];
				if (!currentReactions.has(emoji)) {
					await queueMessage.react(emoji);
				}
			}

			// Remove reactions that are no longer needed
			for (const reaction of currentReactions.values()) {
				const emojiIndex = VOTE_EMOJIS.indexOf(reaction.emoji.name);
				if (emojiIndex === -1 || emojiIndex >= queue.length) {
					await reaction.remove();
				}
			}
		}
		catch (error) {
			console.error('Error updating reactions:', error);
		}
	}

	static async handleReaction(reaction, user) {
		if (user.bot || !queueMessage) return;

		const emojiIndex = VOTE_EMOJIS.indexOf(reaction.emoji.name);
		if (emojiIndex === -1) return;

		try {
			// Process the vote
			const success = songQueue.vote(emojiIndex, user.id);

			if (success) {
				// Update the display without removing the user's reaction
				await this.updateDisplay();
			}
			else {
				// Only remove the reaction if the vote was not successful (e.g., already voted)
				await reaction.users.remove(user.id);
			}
		}
		catch (error) {
			console.error('Error handling reaction:', error);
		}
	}

	static async onSongFinish() {
		if (!queueMessage) return;

		try {
			console.log('Song finished, handling queue updates');

			// Remove the song from the queue
			const removedSong = songQueue.removeFirst();

			if (removedSong) {
				console.log(`Removed song "${removedSong.title}" from queue`);

				// If the song has a Spotify URL, extract the track ID and handle removal
				if (removedSong.url && removedSong.url.includes('spotify.com/track/')) {
					const trackId = removedSong.url.split('/').pop().split('?')[0];
					if (trackId) {
						try {
							await spotifyManager.handleTrackRemoval(trackId, removedSong.title);
							console.log(`Handled Spotify track removal for "${removedSong.title}" (${trackId})`);
						}
						catch (error) {
							console.error(`Error handling Spotify track removal: ${error.message}`);
						}
					}
				}
			}

			// Set the next song as currently playing
			if (songQueue.getQueue().length > 0) {
				currentlyPlayingSong = songQueue.getQueue()[0];
				console.log(`Next song in queue: "${currentlyPlayingSong.title}"`);
			}
			else {
				currentlyPlayingSong = null;
				console.log('Queue is now empty');

				// If the queue is now empty, sync with Active Stream Playlist
				await this.syncQueueWithActivePlaylist();
			}

			// Update the display
			await this.updateDisplay();

			// Ensure we're playing from the correct playlists
			await spotifyManager.ensurePlayingFromCorrectPlaylists();

			return removedSong;
		}
		catch (error) {
			console.error('Error handling song finish:', error);
			return null;
		}
	}

	static async startPlayingSong() {
		if (songQueue.getQueue().length > 0) {
			currentlyPlayingSong = songQueue.getQueue()[0];
			await this.updateDisplay();

			// Start a timer for the song duration
			await this.startSongTimer(currentlyPlayingSong);

			return currentlyPlayingSong;
		}
		return null;
	}

	static async startSongTimer(song) {
		// Clear any existing timer
		if (songTimer) {
			clearTimeout(songTimer);
			songTimer = null;
		}

		if (!song || !client) return;

		try {
			// Get the track details from Spotify to get the duration
			const trackIdMatch = song.url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
			if (trackIdMatch) {
				const trackId = trackIdMatch[1];
				const trackInfo = await spotifyManager.spotifyApi.getTrack(trackId);

				if (trackInfo && trackInfo.body) {
					// Get the duration in milliseconds
					const duration = trackInfo.body.duration_ms;
					console.log(`Starting timer for song "${song.title}" with duration ${duration}ms`);

					// Set a timer to emit the songFinish event when the song ends
					songTimer = setTimeout(async () => {
						console.log(`Song "${song.title}" finished playing after ${duration}ms`);

						try {
							// We no longer remove the song here - this will be handled by the spotifyTrackChanged event
							// or the onSongFinish method when the song actually finishes playing

							// Emit the songFinish event
							client.emit('songFinish');
						}
						catch (error) {
							console.error('Error in song timer:', error);
							// Still emit the songFinish event even if there was an error
							client.emit('songFinish');
						}
					}, duration);
				}
			}
		}
		catch (error) {
			console.error('Error starting song timer:', error);
		}
	}

	// Add a method to clear the song timer
	static clearSongTimer() {
		if (songTimer) {
			clearTimeout(songTimer);
			songTimer = null;
			console.log('Song timer cleared due to skip command');
		}
	}

	// Sync the bot's state with Spotify's currently playing track
	static async syncWithSpotify(spotifyTrack) {
		if (!spotifyTrack) return;

		try {
			const queue = songQueue.getQueue();

			// If the queue is empty, nothing to sync
			if (queue.length === 0) {
				return;
			}

			// Check if the currently playing song in the bot matches the Spotify track
			if (currentlyPlayingSong) {
				const currentTrackIdMatch = currentlyPlayingSong.url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
				if (currentTrackIdMatch && currentTrackIdMatch[1] === spotifyTrack.id) {
					// Already in sync
					return;
				}
			}

			// Try to find the Spotify track in our queue
			const spotifyTrackId = spotifyTrack.id;
			let foundIndex = -1;

			for (let i = 0; i < queue.length; i++) {
				const trackIdMatch = queue[i].url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
				if (trackIdMatch && trackIdMatch[1] === spotifyTrackId) {
					foundIndex = i;
					break;
				}
			}

			if (foundIndex === -1) {
				// Track not in our queue, nothing to sync
				console.log(`Spotify is playing "${spotifyTrack.name}" which is not in our queue`);
				return;
			}

			if (foundIndex === 0) {
				// The first song in the queue matches Spotify, just update our state
				currentlyPlayingSong = queue[0];
				console.log(`Synced with Spotify: Now playing "${currentlyPlayingSong.title}"`);
				return;
			}

			// The song is in our queue but not at the top, need to reorder
			console.log(`Reordering queue to match Spotify: "${spotifyTrack.name}" should be playing`);

			// Move the found song to the top of the queue
			const songToPlay = queue[foundIndex];

			// Remove the song from its current position
			queue.splice(foundIndex, 1);

			// If we have a currently playing song, put it back in the queue
			if (currentlyPlayingSong) {
				queue.unshift(currentlyPlayingSong);
			}

			// Set the found song as currently playing
			currentlyPlayingSong = songToPlay;

			// Update the display
			await this.updateDisplay();

			console.log(`Queue reordered, now playing "${currentlyPlayingSong.title}"`);
		}
		catch (error) {
			console.error('Error syncing with Spotify:', error);
		}
	}

	static async syncQueueWithActivePlaylist() {
		try {
			const queue = songQueue.getQueue();

			// Only sync if the queue is empty
			if (queue.length === 0) {
				console.log('Queue is empty, syncing with Active Stream Playlist');

				// Get tracks from the Active Stream Playlist
				const activePlaylist = await spotifyManager.getActivePlaylist();
				const activeTracks = await spotifyManager.getPlaylistTracks(activePlaylist.id);

				if (activeTracks.body.items.length > 0) {
					console.log(`Found ${activeTracks.body.items.length} tracks in Active Stream Playlist`);

					// Clear the existing queue first to avoid duplicates
					songQueue.songs = [];

					// Add each track to the queue
					for (const item of activeTracks.body.items) {
						if (item.track) {
							const trackTitle = `${item.track.name} - ${item.track.artists[0].name}`;
							const trackUrl = item.track.external_urls.spotify;

							// Use the bot's client ID as the addedBy since these are system-added
							const botUserId = client.user.id;

							// Add to queue
							songQueue.addSong(trackTitle, trackUrl, botUserId);
							console.log(`Added "${trackTitle}" to queue from Active Stream Playlist`);
						}
					}

					// Set the first song as currently playing
					if (songQueue.getQueue().length > 0) {
						currentlyPlayingSong = songQueue.getQueue()[0];
						console.log(`Set currently playing song to "${currentlyPlayingSong.title}"`);
					}

					console.log('Successfully synced queue with Active Stream Playlist');
					return true;
				}
				else {
					console.log('Active Stream Playlist is empty, checking New Playlist');

					// If Active Stream Playlist is empty, try to get songs from New Playlist
					try {
						const playlists = await spotifyManager.spotifyApi.getUserPlaylists();
						const newPlaylist = playlists.body.items.find(
							playlist => playlist.name === 'New Playlist',
						);

						if (newPlaylist) {
							// Ensure New Playlist has 5 songs
							await spotifyManager.ensureNewPlaylistHasFiveSongs();

							// Get tracks from the New Playlist
							const newPlaylistTracks = await spotifyManager.getPlaylistTracks(newPlaylist.id);

							if (newPlaylistTracks.body.items.length > 0) {
								console.log(`Found ${newPlaylistTracks.body.items.length} tracks in New Playlist`);

								// Add each track to the queue
								for (const item of newPlaylistTracks.body.items) {
									if (item.track) {
										const trackTitle = `${item.track.name} - ${item.track.artists[0].name}`;
										const trackUrl = item.track.external_urls.spotify;

										// Use the bot's client ID as the addedBy
										const botUserId = client.user.id;

										// Add to queue
										songQueue.addSong(trackTitle, trackUrl, botUserId);
										console.log(`Added "${trackTitle}" to queue from New Playlist`);
									}
								}

								// Set the first song as currently playing
								if (songQueue.getQueue().length > 0) {
									currentlyPlayingSong = songQueue.getQueue()[0];
									console.log(`Set currently playing song to "${currentlyPlayingSong.title}"`);
								}

								console.log('Successfully synced queue with New Playlist');
								return true;
							}
						}
					}
					catch (error) {
						console.error('Error syncing with New Playlist:', error);
					}

					console.log('Both playlists are empty, nothing to sync');
				}
			}
			else {
				console.log('Queue is not empty, skipping sync with Active Stream Playlist');
			}

			return false;
		}
		catch (error) {
			console.error('Error syncing queue with Active Stream Playlist:', error);
			return false;
		}
	}
}

export default QueueDisplay;
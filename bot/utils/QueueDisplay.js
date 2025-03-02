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
			// We no longer remove songs from playlists here
			// This is now handled by the spotifyTrackChanged event in bot.js

			// Remove the song from the queue
			const removedSong = songQueue.removeFirst();

			// Set the next song as currently playing
			if (songQueue.getQueue().length > 0) {
				currentlyPlayingSong = songQueue.getQueue()[0];
			}
			else {
				currentlyPlayingSong = null;
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
}

export default QueueDisplay;
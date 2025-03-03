import { SlashCommandBuilder } from 'discord.js';
import { QueueDisplay } from '../../utils/QueueDisplay.js';
import spotifyManager from '../../utils/SpotifyManager.js';
import songQueue from '../../utils/SongQueue.js';

export default {
	data: new SlashCommandBuilder()
		.setName('skip')
		.setDescription('Skip the currently playing song')
		.addIntegerOption(option => 
			option.setName('count')
				.setDescription('Number of songs to skip (default: 1)')
				.setRequired(false)
				.setMinValue(1)
				.setMaxValue(5)),

	async execute(interaction) {
		try {
			// Defer the reply to prevent timeout
			await interaction.deferReply();

			// Get the client from the interaction
			const client = interaction.client;
			
			// Get the number of songs to skip (default: 1)
			const skipCount = interaction.options.getInteger('count') || 1;
			console.log(`Skip command: Requested to skip ${skipCount} song(s)`);

			// Get the currently playing track before skipping
			const currentTrack = await spotifyManager.getCurrentlyPlaying();

			if (!currentTrack) {
				await interaction.editReply({
					content: 'No song is currently playing to skip!',
					ephemeral: true,
				});
				return;
			}

			// Clear the current song timer first to prevent double events
			QueueDisplay.clearSongTimer();
			
			// Handle multiple skips if requested
			let skippedSongs = [];
			
			try {
				for (let i = 0; i < skipCount; i++) {
					// If we're on the first skip, use the current track
					if (i === 0 && currentTrack.id) {
						console.log(`Skipping currently playing track: ${currentTrack.name} (${currentTrack.id})`);
						await spotifyManager.handleTrackRemoval(currentTrack.id, currentTrack.name);
						skippedSongs.push(currentTrack.name);
					}
					
					// For subsequent skips, or if we don't have a current track ID,
					// get the next song from the queue
					if (i > 0 || !currentTrack.id) {
						if (songQueue.getQueue().length > 0) {
							const nextSong = songQueue.getQueue()[0];
							console.log(`Skipping next song in queue: ${nextSong.title}`);
							
							// Extract track ID from URL if available
							if (nextSong.url && nextSong.url.includes('spotify.com/track/')) {
								const trackId = nextSong.url.split('/').pop().split('?')[0];
								if (trackId) {
									await spotifyManager.handleTrackRemoval(trackId, nextSong.title);
								}
							}
							// Remove from queue
							songQueue.removeFirst();
							skippedSongs.push(nextSong.title);
						} else {
							// No more songs in queue to skip
							console.log(`No more songs in queue to skip after skipping ${i} song(s)`);
							break;
						}
					}
					
					// Emit the songFinish event to trigger the next song
					client.emit('songFinish');
				}
			} catch (skipError) {
				console.error(`Error during skip operation: ${skipError.message}`);
			}
			
			// Ensure the New Playlist has exactly 5 songs
			try {
				await spotifyManager.ensureNewPlaylistHasFiveSongs();
			} catch (playlistError) {
				console.error(`Error ensuring New Playlist has 5 songs: ${playlistError.message}`);
			}
			
			// Update the queue display
			await QueueDisplay.updateDisplay();
			
			// Ensure we're playing from the correct playlists
			try {
				await spotifyManager.ensurePlayingFromCorrectPlaylists();
			} catch (playlistError) {
				console.error(`Error ensuring playing from correct playlists: ${playlistError.message}`);
			}

			// Prepare response message
			let responseMessage = '';
			if (skippedSongs.length === 1) {
				responseMessage = `Skipped "${skippedSongs[0]}"!`;
			} else if (skippedSongs.length > 0) {
				responseMessage = `Skipped ${skippedSongs.length} songs:\n${skippedSongs.map((song, index) => `${index + 1}. "${song}"`).join('\n')}`;
			} else {
				responseMessage = 'Could not skip any songs.';
			}

			await interaction.editReply({
				content: responseMessage,
				ephemeral: true,
			});
		} catch (error) {
			console.error('Error in skip command:', error);
			// If we already deferred, use editReply, otherwise use reply
			try {
				await interaction.editReply({
					content: 'There was an error skipping the song. Please try again.',
					ephemeral: true,
				});
			} catch (replyError) {
				console.error('Error sending reply:', replyError);
			}
		}
	},
};
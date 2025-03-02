import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import songQueue from '../../utils/SongQueue.js';
import spotifyManager from '../../utils/SpotifyManager.js';
import { QueueDisplay } from '../../utils/QueueDisplay.js';

export default {
	data: new SlashCommandBuilder()
		.setName('addsong')
		.setDescription('Add a song to the priority queue')
		.addStringOption(option =>
			option.setName('title')
				.setDescription('The title of the song')
				.setRequired(true)),

	async execute(interaction) {
		const searchQuery = interaction.options.getString('title');
		const userId = interaction.user.id;

		try {
			// Defer the reply to prevent timeout
			await interaction.deferReply();

			console.log(`Searching for song: "${searchQuery}" requested by user ${userId}`);

			// Search for tracks on Spotify
			const searchResults = await spotifyManager.spotifyApi.searchTracks(searchQuery);
			const tracks = searchResults.body.tracks.items.slice(0, 5);

			if (tracks.length === 0) {
				await interaction.editReply({
					content: 'No songs found matching your search.',
					ephemeral: true,
				});
				return;
			}

			// Create buttons for each track
			const row = new ActionRowBuilder();
			tracks.forEach((track, index) => {
				row.addComponents(
					new ButtonBuilder()
						.setCustomId(`song_${index}`)
						.setLabel(`${index + 1}`)
						.setStyle(ButtonStyle.Primary),
				);
			});

			// Create the song selection message
			const songList = tracks.map((track, index) =>
				`${index + 1}. "${track.name}" by ${track.artists[0].name} (${track.album.name})`,
			).join('\n');

			const response = await interaction.editReply({
				content: `Found these songs matching "${searchQuery}":\n${songList}\n\nClick a number to select your song:`,
				components: [row],
				ephemeral: true,
			});

			// Create button collector
			const collector = response.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: 30000,
			});

			collector.on('collect', async (i) => {
				if (i.user.id !== userId) {
					await i.reply({
						content: 'Only the person who initiated the command can select a song.',
						ephemeral: true,
					});
					return;
				}

				const selectedIndex = parseInt(i.customId.split('_')[1]);
				const selectedTrack = tracks[selectedIndex];
				const trackTitle = `${selectedTrack.name} - ${selectedTrack.artists[0].name}`;
				const trackUrl = selectedTrack.external_urls.spotify;

				// Add to queue
				const song = songQueue.addSong(trackTitle, trackUrl, userId);
				const queuePosition = songQueue.getQueue().findIndex(s => s === song) + 1;

				// Update the queue display
				await QueueDisplay.updateDisplay();

				// Add to Spotify playlists
				let spotifyMessage = '';
				try {
					const playlists = await spotifyManager.addToPlaylists(trackTitle, trackUrl);
					spotifyMessage = `\nAdded to Spotify playlists: Archive (${playlists.archivePlaylistName}) and Active (${playlists.activePlaylistName})`;

					// Check if we should start playing the Active Stream Playlist
					const activePlaylist = await spotifyManager.getActivePlaylist();
					const playlistTracks = await spotifyManager.spotifyApi.getPlaylistTracks(activePlaylist.id);

					if (playlistTracks.body.items.length > 0) {
						// Get current playback state
						const playbackData = await spotifyManager.spotifyApi.getMyCurrentPlaybackState();

						// Check if something is playing and what playlist it's from
						if (playbackData.body && playbackData.body.context &&
							playbackData.body.context.type === 'playlist') {
							const currentPlaylistId = playbackData.body.context.uri.split(':')[2];
							const currentPlaylistData = await spotifyManager.spotifyApi.getPlaylist(currentPlaylistId);
							const currentPlaylistName = currentPlaylistData.body.name;

							// If not already playing from the Active Stream Playlist, switch to it
							if (currentPlaylistName !== 'Active Stream Playlist') {
								await spotifyManager.spotifyApi.play({
									context_uri: `spotify:playlist:${activePlaylist.id}`,
								});
								spotifyMessage += '\nStarted playing from the Active Stream Playlist!';
							}
						}
						else {
							// Nothing is playing or not playing from a playlist, start the Active Stream Playlist
							await spotifyManager.spotifyApi.play({
								context_uri: `spotify:playlist:${activePlaylist.id}`,
							});
							spotifyMessage += '\nStarted playing from the Active Stream Playlist!';
						}
					}
				}
				catch (spotifyError) {
					console.error('Error adding to Spotify:', spotifyError);
					spotifyMessage = '\nNote: Could not add to Spotify playlists';
				}

				// Update the original message
				await interaction.editReply({
					content: `Added "${trackTitle}" to the queue at position ${queuePosition}! Use /vote to vote for songs.${spotifyMessage}`,
					components: [],
					ephemeral: false,
				});

				collector.stop();
			});

			collector.on('end', async (collected, reason) => {
				if (reason === 'time' && collected.size === 0) {
					await interaction.editReply({
						content: 'Song selection timed out. Please try again.',
						components: [],
						ephemeral: true,
					});
				}
			});
		}
		catch (error) {
			console.error('Error in addsong command:', error);

			// If we already deferred, use editReply, otherwise use reply
			const replyMethod = interaction.deferred ? 'editReply' : 'reply';
			await interaction[replyMethod]({
				content: `Failed to add song to the queue. Error: ${error.message}`,
				ephemeral: true,
			});
		}
	},
};

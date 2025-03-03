import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import songQueue from '../../utils/SongQueue.js';
import spotifyManager from '../../utils/SpotifyManager.js';
import { QueueDisplay } from '../../utils/QueueDisplay.js';

export default {
	data: new SlashCommandBuilder()
		.setName('addsong')
		.setDescription('Add a song to the priority queue and play it immediately')
		.addStringOption(option =>
			option.setName('title')
				.setDescription('The title of the song')
				.setRequired(true)),

	async execute(interaction) {
		const searchQuery = interaction.options.getString('title');
		const userId = interaction.user.id;

		try {
			await interaction.deferReply();

			console.log(`Searching for song: "${searchQuery}" requested by user ${userId}`);

			let searchResults;
			for (let attempt = 1; attempt <= 3; attempt++) {
				try {
					searchResults = await spotifyManager.searchTracks(searchQuery);
					break;
				}
				catch (error) {
					if (attempt === 3 || error.statusCode !== 500) throw error;
					console.warn(`Search attempt ${attempt} failed: ${error.message}. Retrying...`);
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
			}

			if (!searchResults?.body?.tracks?.items) {
				await interaction.editReply({
					content: 'Failed to search for songs. Please try again later.',
					ephemeral: true,
				});
				return;
			}
			const tracks = searchResults.body.tracks.items.slice(0, 5);

			if (tracks.length === 0) {
				await interaction.editReply({
					content: 'No songs found matching your search.',
					ephemeral: true,
				});
				return;
			}

			const row = new ActionRowBuilder();
			tracks.forEach((track, index) => {
				row.addComponents(
					new ButtonBuilder()
						.setCustomId(`song_${index}`)
						.setLabel(`${index + 1}`)
						.setStyle(ButtonStyle.Primary),
				);
			});

			const songList = tracks.map((track, index) =>
				`${index + 1}. "${track.name}" by ${track.artists[0].name} (${track.album.name})`,
			).join('\n');

			const response = await interaction.editReply({
				content: `Found these songs matching "${searchQuery}":\n${songList}\n\nClick a number to select your song:`,
				components: [row],
			});

			const collector = response.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: 30000,
			});

			collector.on('collect', async (i) => {
				await i.deferUpdate().catch(console.error);
				if (i.user.id !== userId) {
					await i.followUp({ content: 'Only the initiator can select.', flags: MessageFlags.Ephemeral });
					return;
				}

				const selectedIndex = parseInt(i.customId.split('_')[1]);
				const selectedTrack = tracks[selectedIndex];
				const trackTitle = `${selectedTrack.name} - ${selectedTrack.artists[0].name}`;
				const trackUrl = selectedTrack.external_urls.spotify;
				const trackId = selectedTrack.id;

				// const song = songQueue.addSong(trackTitle, trackUrl, userId);
				const queue = songQueue.getQueue();
				const songIndex = queue.findIndex(s => s.title === trackTitle && s.userId === userId);
				if (songIndex > 0) {
					const [movedSong] = queue.splice(songIndex, 1);
					queue.unshift(movedSong);
				}
				const queuePosition = 1;

				await QueueDisplay.updateDisplay();

				let spotifyMessage = '';
				try {
					const result = await spotifyManager.addToPlaylists(trackTitle, trackUrl, true);
					if (result?.success) {
						spotifyMessage = `\nAdded to playlists: Archive (${result.archivePlaylistName}) and Active (${result.activePlaylistName})`;
						await spotifyManager.play({
							context_uri: 'spotify:playlist:28EfM0PlgAZmCHPwN7x0P0',
							offset: { uri: `spotify:track:${trackId}` },
							position_ms: 0,
						});
					}
					else {
						spotifyMessage = `\nFailed to add: ${result?.error || 'Unknown error'}`;
					}
				}
				catch (error) {
					console.error('Spotify error:', error);
					spotifyMessage = `\nError adding/playing: ${error.message}`;
				}

				const confirmMessage = await i.followUp({
					content: `Added "${trackTitle}" to queue at position ${queuePosition} and playing now! Use /vote to vote.${spotifyMessage}`,
				});

				try {
					console.log('Deleting selection message...');
					if (interaction.channel) await interaction.channel.messages.delete(response.id);
				}
				catch (error) {
					console.error('Error deleting selection:', error);
					await interaction.editReply({ content: '_ _', components: [], embeds: [] }).catch(console.error);
				}

				setTimeout(async () => {
					try {
						if (confirmMessage?.deletable) await confirmMessage.delete();
					}
					catch (error) {
						console.error('Error deleting confirmation:', error);
					}
				}, 5000);

				collector.stop();
			});

			collector.on('end', async (collected, reason) => {
				if (reason === 'time' && collected.size === 0) {
					try {
						await interaction.editReply({
							content: 'Song selection timed out. Please try again.',
							components: [],
						});
						setTimeout(async () => {
							try {
								if (interaction.channel) {
									await interaction.channel.messages.delete(response.id);
								}
								else {
									await interaction.deleteReply();
								}
							}
							catch (error) {
								console.error('Error deleting timed out message:', error);
								try {
									await interaction.editReply({ content: '_ _', components: [], embeds: [] });
								}
								catch (secondError) {
									console.error('Failed to clear timed out message:', secondError);
								}
							}
						}, 5000);
					}
					catch (error) {
						console.error('Error handling collector end:', error);
					}
				}
			});
		}
		catch (error) {
			console.error('Error in addsong command:', error);
			const replyMethod = interaction.deferred ? 'editReply' : 'reply';
			await interaction[replyMethod]({
				content: `Failed to add song: ${error.message}`,
				ephemeral: true,
			});
		}
	},
};
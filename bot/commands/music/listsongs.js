import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import spotifyManager from '../../utils/SpotifyManager.js';

export default {
	data: new SlashCommandBuilder()
		.setName('listsongs')
		.setDescription('List the next 5 songs in the queue'),

	async execute(interaction) {
		try {
			// Defer the reply to prevent timeout
			await interaction.deferReply();

			// Ensure the "New Playlist" has 5 songs
			await spotifyManager.ensureNewPlaylistHasFiveSongs();

			// Get the active playlist
			const activePlaylist = await spotifyManager.getActivePlaylist();

			// Get tracks from the active playlist
			const activePlaylistTracks = await spotifyManager.spotifyApi.getPlaylistTracks(activePlaylist.id, {
				limit: 5,
			});

			// Create an embed to display the songs
			const embed = new EmbedBuilder()
				.setTitle('🎵 Next Songs')
				.setColor('#1DB954');

			let totalTracksAdded = 0;
			let description = '';

			// Add tracks from the active playlist
			if (activePlaylistTracks.body.items.length > 0) {
				description += '**From Active Stream Playlist:**\n';

				// Add each track to the embed
				activePlaylistTracks.body.items.forEach((item, index) => {
					if (item.track) {
						const artists = item.track.artists.map(artist => artist.name).join(', ');
						embed.addFields({
							name: `${index + 1}. ${item.track.name}`,
							value: `by ${artists} | [Listen on Spotify](${item.track.external_urls.spotify})`,
						});
						totalTracksAdded++;
					}
				});
			}

			// If we have fewer than 5 tracks from the active playlist, get more from the "New Playlist"
			if (totalTracksAdded < 5) {
				// Get user's playlists
				const playlists = await spotifyManager.spotifyApi.getUserPlaylists();
				const newPlaylist = playlists.body.items.find(
					playlist => playlist.name === 'New Playlist',
				);

				if (newPlaylist) {
					// Get tracks from the "New Playlist"
					const newPlaylistTracks = await spotifyManager.spotifyApi.getPlaylistTracks(newPlaylist.id, {
						limit: 5 - totalTracksAdded,
					});

					if (newPlaylistTracks.body.items.length > 0) {
						if (totalTracksAdded > 0) {
							description += '\n**From New Playlist:**\n';
						}
						else {
							description += '**From New Playlist:**\n';
						}

						// Add each track to the embed
						newPlaylistTracks.body.items.forEach((item, index) => {
							if (item.track) {
								const artists = item.track.artists.map(artist => artist.name).join(', ');
								embed.addFields({
									name: `${totalTracksAdded + index + 1}. ${item.track.name}`,
									value: `by ${artists} | [Listen on Spotify](${item.track.external_urls.spotify})`,
								});
							}
						});
					}
				}
			}

			// Set the description
			if (description) {
				embed.setDescription(description);
			}
			else {
				embed.setDescription('No songs found in either playlist.');
			}

			await interaction.editReply({ embeds: [embed] });
		}
		catch (error) {
			console.error('Error in listsongs command:', error);

			// If we already deferred, use editReply, otherwise use reply
			const replyMethod = interaction.deferred ? 'editReply' : 'reply';
			await interaction[replyMethod]({
				content: `Failed to list songs. Error: ${error.message}`,
				ephemeral: true,
			});
		}
	},
};

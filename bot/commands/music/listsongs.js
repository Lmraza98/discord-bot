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
			
			// Create an embed to display the songs
			const embed = new EmbedBuilder()
				.setTitle('🎵 Next Songs')
				.setColor('#1DB954');

			let totalTracksAdded = 0;
			let description = '';

			// Get tracks from the active playlist
			try {
				const activePlaylistTracks = await spotifyManager.spotifyApi.getPlaylistTracks(activePlaylist.id, {
					limit: 5,
				});

				// Add tracks from the active playlist
				if (activePlaylistTracks.body.items.length > 0) {
					description += '**From Active Stream Playlist:**\n';

					// Add each track to the embed
					for (const item of activePlaylistTracks.body.items) {
						if (item.track) {
							const artists = item.track.artists.map(artist => artist.name).join(', ');
							embed.addFields({
								name: `${totalTracksAdded + 1}. ${item.track.name}`,
								value: `by ${artists} | [Listen on Spotify](${item.track.external_urls.spotify})`,
							});
							totalTracksAdded++;
							
							// Only show up to 5 tracks total
							if (totalTracksAdded >= 5) break;
						}
					}
				}
			} catch (error) {
				console.error('Error fetching Active Stream Playlist tracks:', error);
				description += '*Error fetching Active Stream Playlist tracks*\n';
			}

			// If we have fewer than 5 tracks from the active playlist, get more from the "New Playlist"
			if (totalTracksAdded < 5) {
				try {
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
							} else {
								description += '**From New Playlist:**\n';
							}

							// Add each track to the embed
							for (const item of newPlaylistTracks.body.items) {
								if (item.track) {
									const artists = item.track.artists.map(artist => artist.name).join(', ');
									embed.addFields({
										name: `${totalTracksAdded + 1}. ${item.track.name}`,
										value: `by ${artists} | [Listen on Spotify](${item.track.external_urls.spotify})`,
									});
									totalTracksAdded++;
									
									// Only show up to 5 tracks total
									if (totalTracksAdded >= 5) break;
								}
							}
						}
					} else {
						description += '\n*New Playlist not found*';
					}
				} catch (error) {
					console.error('Error fetching New Playlist tracks:', error);
					description += '\n*Error fetching New Playlist tracks*';
				}
			}

			// Set the description
			if (description) {
				embed.setDescription(description);
			} else {
				embed.setDescription('No songs found in either playlist.');
			}

			// Add a footer with the total count
			embed.setFooter({ 
				text: `Showing ${totalTracksAdded} song${totalTracksAdded !== 1 ? 's' : ''} | Use /addsong to add more songs` 
			});

			await interaction.editReply({ embeds: [embed], ephemeral: true });
		} catch (error) {
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

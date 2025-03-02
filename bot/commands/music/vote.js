import { SlashCommandBuilder } from 'discord.js';
import songQueue from '../../utils/SongQueue.js';

export default {
	data: new SlashCommandBuilder()
		.setName('vote')
		.setDescription('Vote for a song in the queue')
		.addIntegerOption(option =>
			option.setName('position')
				.setDescription('The position of the song in the queue (1-based)')
				.setRequired(true)
				.setMinValue(1)),

	async execute(interaction) {
		const position = interaction.options.getInteger('position');
		const userId = interaction.user.id;

		try {
			const queue = songQueue.getQueue();
			if (position > queue.length) {
				await interaction.reply({
					content: `Invalid position. The queue only has ${queue.length} songs.`,
					ephemeral: true,
				});
				return;
			}

			const success = songQueue.vote(position - 1, userId);
			if (success) {
				const song = queue[position - 1];
				const newPosition = songQueue.getQueue().findIndex(s => s === song) + 1;

				await interaction.reply({
					content: `Voted for "${song.title}"! It now has ${song.votes} votes and is at position ${newPosition}.`,
					ephemeral: false,
				});
			}
			else {
				await interaction.reply({
					content: 'You have already voted for this song!',
					ephemeral: true,
				});
			}
		}
		catch (error) {
			console.error('Error voting for song:', error);
			await interaction.reply({
				content: 'Failed to vote for the song.',
				ephemeral: true,
			});
		}
	},
};

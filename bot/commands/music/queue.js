import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import songQueue from '../../utils/SongQueue.js';

export default {
	data: new SlashCommandBuilder()
		.setName('queue')
		.setDescription('Show the current song queue'),

	async execute(interaction) {
		const queue = songQueue.getQueue();

		if (queue.length === 0) {
			await interaction.reply({
				content: 'The queue is empty! Add songs with /addsong',
				ephemeral: true,
			});
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle('🎵 Song Queue')
			.setColor(0x0099FF)
			.setDescription(
				queue.map((song, index) =>
					`${index + 1}. "${song.title}" - ${song.votes} votes (<@${song.addedBy}>)`,
				).join('\n'),
			)
			.setFooter({ text: 'Use /vote <position> to vote for a song!' });

		await interaction.reply({ embeds: [embed], ephemeral: true });
	},
};

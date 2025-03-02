import { SlashCommandBuilder } from 'discord.js';
import { QueueDisplay } from '../../utils/QueueDisplay.js';

export default {
	data: new SlashCommandBuilder()
		.setName('skip')
		.setDescription('Skip the currently playing song'),

	async execute(interaction) {
		try {
			// Defer the reply to prevent timeout
			await interaction.deferReply();

			// Get the client from the interaction
			const client = interaction.client;

			// Clear the current song timer first to prevent double events
			QueueDisplay.clearSongTimer();

			// Emit the songFinish event to trigger the next song
			client.emit('songFinish');

			await interaction.editReply({
				content: 'Skipped to the next song!',
				ephemeral: false,
			});
		}
		catch (error) {
			console.error('Error in skip command:', error);
			// If we already deferred, use editReply, otherwise use reply
			const replyMethod = interaction.deferred ? 'editReply' : 'reply';
			await interaction[replyMethod]({
				content: `Failed to skip song. Error: ${error.message}`,
				ephemeral: true,
			});
		}
	},
};
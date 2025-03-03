import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readdirSync } from 'fs';
import { join } from 'path';
import { QueueDisplay } from './utils/QueueDisplay.js';
import spotifyManager from './utils/SpotifyManager.js';
import songQueue from './utils/SongQueue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env') });

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.MessageContent,
	],
});

client.commands = new Collection();

const foldersPath = join(__dirname, 'commands');
const commandFolders = readdirSync(foldersPath);

for (const folder of commandFolders) {
	const commandsPath = join(foldersPath, folder);
	const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

	for (const file of commandFiles) {
		const filePath = join(commandsPath, file);
		const command = await import('file://' + filePath);

		if (command.default && 'data' in command.default && 'execute' in command.default) {
			client.commands.set(command.default.data.name, command.default);
		}
		else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property, or has no default export.`);
		}
	}
}

let queueChannel = null;
let lastCheckTime = 0;
const CHECK_INTERVAL = 30000;
// 30 seconds

async function checkPlayback() {
	const now = Date.now();
	if (now - lastCheckTime < CHECK_INTERVAL) return;
	 // Throttle checks
	lastCheckTime = now;

	const current = await spotifyManager.getCurrentlyPlaying();
	console.log(`Now playing on Spotify: ${current?.name || 'Nothing'}`);
	if (current && !songQueue.getQueue().some(song => song.title === current.name)) {
		await spotifyManager.ensurePlayingFromCorrectPlaylists();
	}
}

client.once(Events.ClientReady, async () => {
	console.log('Bot is ready!');

	const guild = client.guilds.cache.first();
	if (guild) {
		queueChannel = guild.channels.cache.find(channel => channel.name === 'music-queue') ||
      await guild.channels.create({
      	name: 'music-queue',
      	topic: 'Music Queue - React with emojis to vote!',
      });
		await QueueDisplay.initialize(queueChannel, client);

		spotifyManager.setClient(client);
		await spotifyManager.ensureNewPlaylistHasFiveSongs();
		await QueueDisplay.syncQueueWithActivePlaylist();
		await QueueDisplay.startPlayingSong();

		const devices = await spotifyManager.getSpotifyApi().getMyDevices();
		console.log(`Found ${devices.body.devices.length} available Spotify devices`);
		devices.body.devices.forEach(device => {
			console.log(`Device: ${device.name} (${device.type}) - Active: ${device.is_active}`);
		});

		setInterval(checkPlayback, 5000);
		 // Check every 5 seconds, throttled internally
	}
});

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	const command = client.commands.get(interaction.commandName);
	if (!command) return;

	try {
		await command.execute(interaction);
		if (['addsong', 'vote'].includes(interaction.commandName)) {
			await QueueDisplay.updateDisplay();
			if (interaction.commandName === 'addsong') {
				await QueueDisplay.startPlayingSong();
			}
		}
	}
	catch (error) {
		console.error(error);
		await interaction.reply({
			content: 'There was an error executing this command!',
			ephemeral: true,
		});
	}
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
	if (user.bot) return;
	await QueueDisplay.handleReaction(reaction, user);
});

client.on('spotifyTrackChanged', async (previousTrack, currentTrack) => {
	if (!previousTrack || !previousTrack.id) return;

	console.log(`Spotify track changed from "${previousTrack.name}" to "${currentTrack.name}"`);
	await spotifyManager.handleTrackRemoval(previousTrack.id, previousTrack.name);
	await QueueDisplay.onSongFinish();
	await spotifyManager.ensurePlayingFromCorrectPlaylists();
});

client.on('spotifyNowPlaying', async (track) => {
	console.log(`Now playing on Spotify: ${track.name} by ${track.artists[0].name}`);
	await QueueDisplay.syncWithSpotify(track);
});

client.login(process.env.DISCORD_TOKEN);
import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readdirSync } from 'fs';
import { join } from 'path';
import QueueDisplay from './utils/QueueDisplay.js';
import spotifyManager from './utils/SpotifyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from the parent directory
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

client.once(Events.ClientReady, async () => {
	console.log('Bot is ready!');

	// Find or create the queue channel
	const guild = client.guilds.cache.first();
	if (guild) {
		queueChannel = guild.channels.cache.find(channel => channel.name === 'music-queue');
		if (!queueChannel) {
			queueChannel = await guild.channels.create({
				name: 'music-queue',
				topic: 'Music Queue - React with emojis to vote!',
			});
		}
		await QueueDisplay.initialize(queueChannel, client);

		// Initialize Spotify manager with the client
		spotifyManager.setClient(client);

		// Ensure the "New Playlist" has 5 random songs from Liked Music
		await spotifyManager.ensureNewPlaylistHasFiveSongs();

		// Check for active devices and ensure we're playing from the correct playlists
		try {
			const devices = await spotifyManager.spotifyApi.getMyDevices();
			console.log(`Found ${devices.body.devices.length} available Spotify devices`);

			// Log available devices
			devices.body.devices.forEach(device => {
				console.log(`Device: ${device.name} (${device.type}) - Active: ${device.is_active}`);
			});

			// Ensure we're playing from the correct playlists
			await spotifyManager.ensurePlayingFromCorrectPlaylists();
		}
		catch (error) {
			console.error('Error checking Spotify devices:', error);
		}

		// Start playing the first song if there's one in the queue
		await QueueDisplay.startPlayingSong();
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

			// If this is the first song added, start playing it
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

// Handle reactions to the queue message
client.on(Events.MessageReactionAdd, async (reaction, user) => {
	if (user.bot) return;
	await QueueDisplay.handleReaction(reaction, user);
});

// Handle Spotify track changes
client.on('spotifyTrackChanged', async (previousTrack, currentTrack) => {
	console.log(`Spotify track changed from "${previousTrack.name}" to "${currentTrack.name}"`);

	// Only remove the previous track when a track change occurs (song finishes playing)
	try {
		const trackId = previousTrack.id;

		// First check if the track is in the Active Stream Playlist
		const activePlaylist = await spotifyManager.getActivePlaylist();
		const activePlaylistTracks = await spotifyManager.spotifyApi.getPlaylistTracks(activePlaylist.id);

		// Find the track to remove in Active Playlist
		const activeTrackToRemove = activePlaylistTracks.body.items.find(item =>
			item.track && (
				item.track.id === trackId ||
				item.track.uri === `spotify:track:${trackId}`
			),
		);

		if (activeTrackToRemove) {
			await spotifyManager.spotifyApi.removeTracksFromPlaylist(
				activePlaylist.id,
				[{ uri: activeTrackToRemove.track.uri }],
			);
			console.log(`Successfully removed track ${previousTrack.name} from active playlist after track change`);
		}
		else {
			// If not in Active Playlist, check the New Playlist
			const playlists = await spotifyManager.spotifyApi.getUserPlaylists();
			const newPlaylist = playlists.body.items.find(p => p.name === 'New Playlist');

			if (newPlaylist) {
				const newPlaylistTracks = await spotifyManager.spotifyApi.getPlaylistTracks(newPlaylist.id);

				// Find the track to remove in New Playlist
				const newTrackToRemove = newPlaylistTracks.body.items.find(item =>
					item.track && (
						item.track.id === trackId ||
						item.track.uri === `spotify:track:${trackId}`
					),
				);

				if (newTrackToRemove) {
					await spotifyManager.spotifyApi.removeTracksFromPlaylist(
						newPlaylist.id,
						[{ uri: newTrackToRemove.track.uri }],
					);
					console.log(`Successfully removed track ${previousTrack.name} from New Playlist after track change`);

					// Ensure New Playlist always has 5 songs
					await spotifyManager.ensureNewPlaylistHasFiveSongs();
				}
			}
		}
	}
	catch (error) {
		console.error('Error removing previous track from playlists:', error);
	}

	await QueueDisplay.onSongFinish();

	// Ensure the "New Playlist" always has 5 songs
	await spotifyManager.ensureNewPlaylistHasFiveSongs();

	// Ensure we're playing from the correct playlists
	await spotifyManager.ensurePlayingFromCorrectPlaylists();
});

// Handle Spotify now playing updates
client.on('spotifyNowPlaying', async (track) => {
	console.log(`Now playing on Spotify: ${track.name} by ${track.artists[0].name}`);
	// Update the bot's currently playing song if needed
	await QueueDisplay.syncWithSpotify(track);
});

// Legacy event handlers - kept for backward compatibility
client.on('songFinish', async () => {
	const nextSong = await QueueDisplay.onSongFinish();
	if (nextSong) {
		// Emit an event that the next song should start playing
		client.emit('songStart', nextSong);
	}
});

client.on('songStart', async (song) => {
	if (song) {
		console.log(`Now playing: ${song.title}`);
		// Here you would implement the actual playback logic
		// This could involve sending a message to a music player service
		// or updating a UI element to show what's currently playing
	}
});

client.login(process.env.DISCORD_TOKEN);
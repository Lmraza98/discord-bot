# Discord Music Bot with Spotify Integration

This Discord bot allows users to add songs to a queue, vote on songs, and integrates with Spotify to play music.

## Setup Instructions

1. Clone this repository
2. Install dependencies:
   ```
   cd bot
   npm install
   ```
3. Create a `.env` file in the root directory with the following variables:
   ```
   DISCORD_CLIENT_ID=your_discord_client_id
   DISCORD_TOKEN=your_discord_token
   CLIENT_ID=your_spotify_client_id
   CLIENT_SECRET=your_spotify_client_secret
   REDIRECT_URI=http://localhost:8888/callback
   ```

4. Authenticate with Spotify:
   ```
   cd bot
   npm run auth
   ```
   This will open a browser window where you can authorize the application with Spotify. Make sure to approve all requested permissions.

5. Deploy the commands to your Discord server:
   ```
   node bot/deploy-commands.js
   ```

6. Start the bot:
   ```
   node bot/bot.js
   ```

## Fixing Spotify Permissions Issue

If you encounter a "Permissions missing" error when the bot tries to access Spotify, follow these steps:

1. Run the authentication script again to get fresh tokens with all required permissions:
   ```
   cd bot
   npm run auth
   ```

2. Follow the prompts to authenticate with Spotify, making sure to approve all requested permissions.

3. The script will automatically update your `.env` file with the new tokens.

4. Restart your bot:
   ```
   node bot/bot.js
   ```

## Available Commands

- `/addsong [title]` - Search for and add a song to the queue
- `/vote [position]` - Vote for a song in the queue
- `/skip` - Skip the currently playing song
- `/queue` - View the current song queue

## Troubleshooting

If you continue to experience issues with Spotify permissions:

1. Make sure your Spotify Developer Application has the correct redirect URI set (http://localhost:8888/callback)
2. Ensure you've authorized all the required scopes by running the authentication script
3. Check that your `.env` file has been updated with the new tokens after authorization
4. Verify that your Spotify account is active and has a valid subscription 
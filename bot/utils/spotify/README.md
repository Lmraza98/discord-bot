# Spotify Integration Module

This directory contains the refactored Spotify integration modules for the Discord bot. The code has been modularized following the Single Responsibility Principle to improve maintainability and testability.

## Module Structure

- **index.js**: Main entry point that exports the SpotifyManager class, which provides a unified interface to all Spotify functionality.
- **AuthManager.js**: Handles Spotify authentication, token refresh, and authorization.
- **PlaylistManager.js**: Manages Spotify playlist operations including creating, updating, and managing tracks.
- **PlaybackManager.js**: Manages Spotify playback control, currently playing track, and playlist switching.
- **QueueManager.js**: Manages operation queuing for Spotify API calls to prevent rate limiting and ensure operations are executed in order.

## Architecture

The architecture follows these design patterns:

1. **Dependency Injection**: The spotifyApi instance is created in AuthManager and injected into other modules.
2. **Facade Pattern**: The SpotifyManager class provides a simplified interface to the complex subsystems.
3. **Single Responsibility Principle**: Each module has a specific responsibility.
4. **Queue Pattern**: Operations are queued to prevent rate limiting and ensure proper execution order.

## Usage

```javascript
import spotifyManager from './utils/SpotifyManager.js';

// Search for tracks
const searchResults = await spotifyManager.searchTracks('song title');

// Add a song to playlists
const playlists = await spotifyManager.addToPlaylists('song title', 'song url');

// Get the active playlist
const activePlaylist = await spotifyManager.getActivePlaylist();

// Start playback
await spotifyManager.play({
  context_uri: `spotify:playlist:${playlistId}`,
});
```

## Error Handling

All Spotify API calls are wrapped with error handling and automatic token refresh. If a 401 Unauthorized error occurs, the access token is refreshed automatically and the operation is retried.

## Dependencies

- spotify-web-api-node: Node.js wrapper for the Spotify Web API
- dotenv: For loading environment variables

## Environment Variables

The following environment variables are required:

- CLIENT_ID: Spotify API client ID
- CLIENT_SECRET: Spotify API client secret
- SPOTIFY_ACCESS_TOKEN: Spotify access token
- SPOTIFY_REFRESH_TOKEN: Spotify refresh token
- REDIRECT_URI: Redirect URI for Spotify OAuth (default: http://localhost:8888/callback) 
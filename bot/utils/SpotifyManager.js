/**
 * SpotifyManager.js
 * Main entry point for Spotify functionality.
 * This file is kept for backward compatibility and delegates to the modular implementation.
 */

import spotifyManager from './spotify/index.js';

// Re-export the default instance for backward compatibility
export default spotifyManager;
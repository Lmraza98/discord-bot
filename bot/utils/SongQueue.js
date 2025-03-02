class Song {
	constructor(title, url, addedBy) {
		this.title = title;
		this.url = url;
		this.addedBy = addedBy;
		this.votes = 1;
		this.voters = new Set([addedBy]);
		this.addedAt = Date.now();
	}
}

export class SongQueue {
	constructor() {
		this.songs = [];
	}

	addSong(title, url, userId) {
		const song = new Song(title, url, userId);
		this.songs.push(song);
		this._sortQueue();
		return song;
	}

	vote(songIndex, userId) {
		if (songIndex < 0 || songIndex >= this.songs.length) {
			throw new Error('Invalid song index');
		}

		const song = this.songs[songIndex];
		if (song.voters.has(userId)) {
			return false;
		}

		song.votes++;
		song.voters.add(userId);
		this._sortQueue();
		return true;
	}

	getQueue() {
		return this.songs;
	}

	getSize() {
		return this.songs.length;
	}

	_sortQueue() {
		// Sort by votes (descending) and then by time added (ascending)
		this.songs.sort((a, b) => {
			if (b.votes !== a.votes) {
				return b.votes - a.votes;
			}
			return a.addedAt - b.addedAt;
		});
	}

	removeFirst() {
		if (this.songs.length === 0) return null;
		return this.songs.shift();
	}
}

export default new SongQueue();

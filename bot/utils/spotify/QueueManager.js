class QueueManager {
	constructor() {
		this.operationQueue = [];
		this.isProcessingQueue = false;
		this.timeouts = {
			default: 10000,
			longRunning: 30000,
			veryLongRunning: 60000,
		};
		this.longRunningOperations = [
			'getAllLikedSongs',
			'populateNewPlaylist',
		];
		this.veryLongRunningOperations = [
			'addMultipleRandomSongsToNewPlaylist',
		];
		this.criticalOperations = [
			'play',
			'switchPlaylist',
		];
	}

	getTimeoutForOperation(description) {
		if (this.criticalOperations.some(op => description.includes(op))) {
			return 5000; // Very short timeout for critical operations
		}
		if (this.veryLongRunningOperations.some(op => description.includes(op))) {
			return this.timeouts.veryLongRunning;
		}
		if (this.longRunningOperations.some(op => description.includes(op))) {
			return this.timeouts.longRunning;
		}
		return this.timeouts.default;
	}

	async queueOperation(operation, description = 'Unnamed operation', isPriority = false) {
		// Handle critical operations immediately
		if (this.criticalOperations.some(op => description.includes(op))) {
			try {
				const timeout = this.getTimeoutForOperation(description);
				return await Promise.race([
					operation(),
					new Promise((_, reject) => setTimeout(() => reject(new Error(`Critical operation (${description}) timed out`)), timeout)),
				]);
			} catch (error) {
				console.error(`Critical operation (${description}) failed:`, error.message);
				return { success: false, error: error.message };
			}
		}

		return new Promise((resolve, reject) => {
			const queueItem = { operation, resolve, reject, description };
			if (isPriority) {
				this.operationQueue.unshift(queueItem);
			} else {
				this.operationQueue.push(queueItem);
			}
			if (!this.isProcessingQueue) this.processQueue();
		}).catch(error => {
			console.error(`Unhandled rejection in (${description}):`, error.message);
			return { success: false, error: error.message };
		});
	}

	async processQueue() {
		if (this.isProcessingQueue) return;
		this.isProcessingQueue = true;

		while (this.operationQueue.length > 0) {
			const { operation, resolve, reject, description } = this.operationQueue.shift();
			try {
				const timeout = this.getTimeoutForOperation(description);
				const result = await Promise.race([
					operation(),
					new Promise((_, reject) => setTimeout(() => reject(new Error(`Operation (${description}) timed out`)), timeout)),
				]);
				resolve(result || { success: false, error: 'No result returned' });
			} catch (error) {
				console.error(`Operation (${description}) failed:`, error);
				reject(error);
			}
		}

		this.isProcessingQueue = false;
	}
}

export default new QueueManager();
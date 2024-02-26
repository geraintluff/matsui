Matsui.makeHash = (path, query) => {
	let fragment = location.href.replace(/^[^#]*#?/, '');
	if (typeof path !== 'string') {
		path = fragment.replace(/\?.*/, ''); // keep existing fragment
	}

	let queryString = '';
	if (query && typeof query === 'object') {
		queryString = Object.keys(query).filter(k => query[k] != null).map(key => {
			if (query[key] === '') return encodeURIComponent(key);
			return [key, query[key]].map(encodeURIComponent).join('=')
		}).join('&').replace(/%20/g, '+');
	}

	let result = path + (queryString && '?') + queryString;
	return {
		hash: result,
		push:(result != fragment) && (fragment.replace(/\?.*/, '') != path)
	};
};
Matsui.merge.apply(Matsui.Wrapped.prototype, {
	syncHash(dataToSyncTarget) {
		let wrapped = this;
		function parseHash(historyState) {
			let fragment = location.href.replace(/^[^#]*#?/, '');
			let path = fragment.replace(/\?.*/, '');
			let queryString = fragment.substr(path.length + 1);

			let query = {};
			queryString.replace(/\+/g, '%20').split('&').forEach(pair => {
				if (!pair) return;
				let parts = pair.split('=').map(x => {
					try {
						return decodeURIComponent(x);
					} catch (e) {
						return x;
					}
				});
				query[parts.shift()] = parts.join('=');
			});
			
			let syncTarget = dataToSyncTarget(wrapped.data);
			if (syncTarget.path !== path) {
				syncTarget.path = path;
			}
			if (syncTarget.query !== query) {
				syncTarget.query = query;
			}
			Matsui.merge.apply(syncTarget.state, Matsui.merge.make(syncTarget.state, historyState));
		}
		addEventListener("hashchange", e => parseHash(null));
		addEventListener("popstate", e => parseHash(window.history.state));
		parseHash(window.history.state);

		wrapped.addUpdates(data => {
			let syncTarget = dataToSyncTarget(data);
			let result = Matsui.makeHash(syncTarget.path, syncTarget.query);

			let historyState = Matsui.getRaw(Matsui.access.pierce(syncTarget.state));
			historyState = historyState && JSON.parse(JSON.stringify(historyState));
			// Creates history if the path changes, but not if it's just the query
			if (result.push) {
				window.history.pushState(historyState, "", "#" + result.hash);
			} else {
				window.history.replaceState(historyState, "", "#" + result.hash);
			}
		});
	},
	syncLocalStorage(dataToSyncTarget) {
		let wrapped = this;
		function readFromStorage(key) {
			let syncTarget = dataToSyncTarget(wrapped.data);
			if (key === null) { // reload everything
				for (let k in syncTarget) {
					readFromStorage(k);
				}
				return;
			}

			let json = localStorage.getItem(key);
			if (json) {
				try {
					syncTarget[key] = JSON.parse(json);
				} catch (e) {
					console.error("localStorage." + key, e);
				}
			}
		}
		
		addEventListener("storage", e => readFromStorage(e.key))
		readFromStorage(null); // load everything

		wrapped.addUpdates(data => { // update localStorage
			let syncTarget = dataToSyncTarget(data);
			for (let k in syncTarget) {
				let value = syncTarget[k];
				if (value == null) {
					localStorage.removeItem(k);
				} else {
					localStorage.setItem(k, JSON.stringify(value));
				}
			}
		});
	}
});

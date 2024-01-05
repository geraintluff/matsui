Matsui.merge.apply(Matsui.Wrapped.prototype, {
	syncHash(dataToSyncTarget) {
		let wrapped = this;
		function parseHash(historyState) {
			let syncTarget = dataToSyncTarget(wrapped.data);
			let fragment = location.href.replace(/^[^#]*#?/, '');
			let path = fragment.replace(/\?.*/, '');
			let queryString = fragment.substr(path.length + 1);

			if (syncTarget.path !== path) {
				syncTarget.path = path;
			}
			
			Matsui.merge.apply(syncTarget.state, Matsui.merge.make(syncTarget.state, historyState));

			let query = {};
			queryString.split('&').forEach(pair => {
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
			if (syncTarget.query !== query) {
				syncTarget.query = query;
			}
		}
		addEventListener("hashchange", e => parseHash(null));
		addEventListener("popstate", e => parseHash(window.history.state));
		parseHash(window.history.state);

		wrapped.addUpdates(data => {
			let syncTarget = dataToSyncTarget(data);
			let fragment = location.href.replace(/^[^#]*#?/, '');
			
			let path = syncTarget.path;
			if (typeof path !== 'string') {
				path = fragment.replace(/\?.*/, ''); // keep existing fragment
			}

			let queryString = '';
			let query = syncTarget.query;
			if (query && typeof query === 'object') {
				queryString = Object.keys(query).map(key => {
					if (query[key] === '') return encodeURIComponent(key);
					return [key, query[key]].map(encodeURIComponent).join('=')
				}).join('&');
			}

			let result = path + (queryString && '?') + queryString;

			let historyState = Matsui.getRaw(Matsui.access.pierce(syncTarget.state));
			historyState = historyState && JSON.parse(JSON.stringify(historyState));
			// Creates history if the path changes, but not if it's just the query
			let newEntry = (result != fragment) && (fragment.replace(/\?.*/, '') != path);
			if (newEntry) {
				window.history.pushState(historyState, "", "#" + result);
			} else {
				window.history.replaceState(historyState, "", "#" + result);
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
			} else {
				syncTarget[key] = null;
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

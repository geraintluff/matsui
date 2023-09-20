// TODO: we need a way to only track the things we've been handed

Matsui.sync = Matsui.sync || {};
Matsui.sync.hash = (wrapped, syncTarget) => {
	function read() {
		let fragment = location.href.replace(/^[^#]*#?/, '');
		let path = fragment.replace(/\?.*/, '');
		let queryString = fragment.substr(path.length + 1);
		
		syncTarget.path = path;

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
		syncTarget.query = query;
	}
	addEventListener("hashchange", read);
	read();

	wrapped.track(update => {
		let fragment = location.href.replace(/^[^#]*#?/, '');

		let path = syncTarget.path;
		if (typeof path !== 'string') {
			path = fragment.replace(/\?.*/, ''); // keep existing fragment
		}

		let queryString = '';
		let query = syncTarget.query;
		if (query && typeof query === 'object') {
			queryString = Object.keys(query).map(key => (
				[key, query[key]].map(encodeURIComponent).join('=')
			)).join('&');
		}

		let result = path + (queryString && '?') + queryString;
		if (result != fragment) {
			location.replace('#' + result);
		}
	});
};

Matsui.sync.localStorage = (wrapped, syncTarget) => {
	function read(key) {
		if (key === null) { // reload everything
			for (let k in syncTarget) {
				read(k);
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
	
	addEventListener("storage", e => read(e.key))
	read(null); // load everything

	wrapped.track(update => {
		for (let k in syncTarget) {
			let value = syncTarget[k];
			if (value == null) {
				localStorage.removeItem(k);
			} else {
				localStorage.setItem(k, JSON.stringify(value));
			}
		}
	});
};

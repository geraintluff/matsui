Test("combining updates", (api, pass, fail, assert) => {
	let data = {
		foo: 'bar',
		baz: ['bing', 'zap']
	};
	
	let updates = [
		// foo
		data => {
			assert(data.foo == 'bar');
		},
		// foo + root object (via Object.keys)
		data => {
			assert(Object.keys(data).length == 2);
			assert(data.foo == 'bar');
		},
		// baz[0]
		data => {
			assert(data.baz[0] == 'bing');
		},
		// baz (by baz.length)
		data => {
			assert(data.baz.length == 2);
		},
		// baz (by piercing)
		data => {
			let baz = api.access.pierce(data.baz);
		},
		// the non-existent property .florp
		data => {
			assert(typeof data.florp == 'undefined');
		},
		// root object (by piercing)
		data => {
			let baz = api.access.pierce(data);
		},
		// only on the first run
		data => {
			let unrelated = {fiveHundred: 500};
			let pierced = api.access.pierce(unrelated);
			assert(pierced === unrelated); // don't do anything weird
		}
	];

	let prevIndex = -1;
	let updatesCallCount = updates.map(x => 0);
	updates = updates.map((update, index) => {
		assert(index > prevIndex); // they should always be called in order
		prevIndex = index;
		return data => {
			++updatesCallCount[index];
			update(data);
		};
	});
	
	function callCount() {
		let result = updatesCallCount;
		// reset various counters
		updatesCallCount = updatesCallCount.map(x => 0);
		prevIndex = -1;
		return result;
	}

	let combined = api.access.combineUpdates(updates);
	combined(data, {bar: 5, bink: "BINK"}); // call with anything
	assert.deepEqual(callCount(), [1, 1, 1, 1, 1, 1, 1, 1]);

	for (let repeat = 0; repeat < 2; ++repeat) {
		// accessing root, foo
		combined(data, {
			foo: 'BAR'
		});
		assert.deepEqual(callCount(), [1, 1, 0, 0, 0, 0, 1, 0]);
		
		// same again: the leaf merge values aren't actually used, only the tree shape is what matters
		combined(data, {
			foo: null
		});
		assert.deepEqual(callCount(), [1, 1, 0, 0, 0, 0, 1, 0]);
		
		// accessing root, baz, baz[0]
		combined(data, {
			baz: {0: "BING"}
		});
		assert.deepEqual(callCount(), [0, 1, 1, 1, 1, 0, 1, 0]);
		
		// accessing root, baz, and a non-existent index of baz
		combined(data, {
			baz: {4: "four"}
		});
		assert.deepEqual(callCount(), [0, 1, 0, 1, 1, 0, 1, 0]);

		// accessing root, baz (by claiming to replace it)
		combined(data, {
			baz: "BAZ"
		});
		assert.deepEqual(callCount(), [0, 1, 0, 1, 1, 0, 1, 0]);

		// accessing root, baz (by claiming to delete it)
		combined(data, {
			baz: null
		});
		assert.deepEqual(callCount(), [0, 1, 0, 1, 1, 0, 1, 0]);

		// accessing root, and the non-existent property florp
		combined(data, {
			florp: "FLORP"
		});
		assert.deepEqual(callCount(), [0, 1, 0, 0, 0, 1, 1, 0]);

		// accessing just root, with no actual changes
		combined(data, {});
		assert.deepEqual(callCount(), [0, 1, 0, 0, 0, 0, 1, 0]);
		combined(data, "mystery");
		assert.deepEqual(callCount(), [0, 1, 0, 0, 0, 0, 1, 0]);
		combined(data, null);
		assert.deepEqual(callCount(), [0, 1, 0, 0, 0, 0, 1, 0]);
	}
	pass()
});

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
		// only on the first run, or if the top-level object is replaced (since that could change the boolean status, and we have no way of telling if that's checked)
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

	let combined = api.combineUpdates(updates);
	let updateWithMerge = mergeObj => {
		let withMerge = api.merge.addHidden(data, mergeObj);
		combined(withMerge);
	};
	let updateWithDataMerge = (dataObj, mergeObj) => {
		let withMerge = api.merge.addHidden(dataObj, mergeObj);
		combined(withMerge);
	};
	updateWithMerge({bar: 5, bink: "BINK"}); // call with anything
	assert.deepEqual(callCount(), [1, 1, 1, 1, 1, 1, 1, 1]);

	for (let repeat = 0; repeat < 2; ++repeat) {
		// accessing root, foo
		updateWithMerge({
			foo: 'BAR'
		});
		assert.deepEqual(callCount(), [1, 1, 0, 0, 0, 0, 1, 0]);
		
		// same again: the leaf merge values aren't actually used, only the tree shape is what matters
		updateWithMerge({
			foo: null
		});
		assert.deepEqual(callCount(), [1, 1, 0, 0, 0, 0, 1, 0]);
		
		// accessing root, baz, baz[0]
		updateWithMerge({
			baz: {0: "BING"}
		});
		assert.deepEqual(callCount(), [0, 1, 1, 1, 1, 0, 1, 0]);
		
		// accessing root, baz, and a non-existent index of baz
		updateWithMerge({
			baz: {4: "four"}
		});
		assert.deepEqual(callCount(), [0, 1, 0, 1, 1, 0, 1, 0]);

		// accessing root, baz (by claiming to replace it) and baz[0] (because baz was replaced)
		updateWithMerge({
			baz: "BAZ"
		});
		assert.deepEqual(callCount(), [0, 1, 1, 1, 1, 0, 1, 0]);

		// accessing root, baz (by claiming to delete it) and baz[0] (because the baz was deleted)
		updateWithMerge({
			baz: null
		});
		assert.deepEqual(callCount(), [0, 1, 1, 1, 1, 0, 1, 0]);

		// accessing root, and the non-existent property florp
		updateWithMerge({
			florp: "FLORP"
		});
		assert.deepEqual(callCount(), [0, 1, 0, 0, 0, 1, 1, 0]);

		// accessing just root, with no actual changes
		updateWithMerge({});
		assert.deepEqual(callCount(), [0, 1, 0, 0, 0, 0, 1, 0]);
		updateWithMerge("mystery"); // claims to replace everything
		assert.deepEqual(callCount(), [1, 1, 1, 1, 1, 1, 1, 1]);
		updateWithMerge(null); // claims to delete everything
		assert.deepEqual(callCount(), [1, 1, 1, 1, 1, 1, 1, 1]);
	}
	pass()
});

Test("combining a combined update", (api, pass, fail, assert) => {
	let updateCount = 0;
	let updates = [
		data => updateCount++
	];
	
	let combined = api.combineUpdates(updates);
	assert(combined !== updates[0]);
	combined();
	assert(updateCount === 1);
	combined();
	assert(updateCount === 2);
	
	let combined2 = api.combineUpdates([combined]);
	assert(combined2 === combined); // it shouldn't wrap it twice
	combined2();
	assert(updateCount === 3);

	let combined3 = api.combineUpdates([combined, combined]);
	assert(combined3 !== combined);
	combined3();
	assert(updateCount === 5); // calls things twice
	
	pass();
});

Test("deleting a sub-object", (api, pass, fail, assert) => {
	let updateCount = 0;
	let data = {
		foo: {
			bar: 5
		}
	};
	let updates = [
		data => (data.foo.bar, ++updateCount)
	];
	
	let combined = api.combineUpdates(updates);
	function callWithMerge(merge) {
		let withMerge = Matsui.merge.addHidden(data, merge);
		combined(withMerge);
	}
	
	combined(data);
	assert(updateCount === 1);

	callWithMerge({foo:{bar:6}});
	assert(updateCount === 2);

	// Shouldn't matter that it didn't actually change, it's based on the merge
	callWithMerge({foo:null});
	assert(updateCount === 3);
	
	data.foo = null;
	let didThrow = false;
	try {
		callWithMerge({foo:null});
	} catch (e) {
		didThrow = true;
	}
	assert(didThrow); // it called the update, and failed to access data.foo.bar
	assert(updateCount === 3); // so didn't get to the following statement

	pass();
});

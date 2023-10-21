Test("combining updates", (api, pass, fail, assert) => {
	let data = {
		foo: 'bar',
		baz: ['bing', 'zap'],
		bip: {bang: true, boom:  false}
	};

	let updates = [
		// pierced root object
		data => {
			let root = api.access.pierce(data);
		},
		// silent-pierced root object
		data => {
			let root = api.access.pierce(data, true);
		},
		// foo
		data => {
			assert(data.foo == 'bar');
		},
		// foo + root keys
		data => {
			assert(Object.keys(data).length == 3);
			assert(data.foo == 'bar');
		},
		// baz (access)
		data => {
			assert(data.baz);
		},
		// baz[0]
		data => {
			assert(data.baz[0] == 'bing');
		},
		// baz keys (by baz.length)
		data => {
			assert(data.baz.length == 2);
		},
		// baz (by piercing)
		data => {
			let baz = api.access.pierce(data.baz);
		},
		// baz (by silent piercing)
		data => {
			let baz = api.access.pierce(data.baz, true);
		},
		// the non-existent property .florp
		data => {
			assert(typeof data.florp == 'undefined');
		},
		// unrelated data
		data => {
			let unrelated = {fiveHundred: 500};
			let pierced = api.access.pierce(unrelated);
			assert(pierced === unrelated); // don't do anything weird
		},
		// access bip directly, but don't look at the contents
		data => {
			let bip = data.bip;
		},
		// access bip with pierce
		data => {
			let pierced = api.access.pierce(data.bip);
		},
		// list bip keys - should care about add/remove keys, but not changing their values
		data => {
			let bipKeys = Object.keys(data.bip);
		},
		// bip keys, with a different method
		data => {
			for (let k in data.bip) {
				k = k;
			}
		},
		// bip.bang - cares about changing a particular value
		data => {
			let bipBang = data.bip.bang;
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

	assert.deepEqual(callCount(), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);

	for (let repeat = 0; repeat < 2; ++repeat) {
		let split = x => x.split('').map(parseFloat);
	
		// replacing foo
		updateWithMerge({
			foo: 'BAR'
		});
		assert.deepEqual(callCount(), split('1011000000000000'));
		
		// deleting foo
		updateWithMerge({
			foo: null
		});
		assert.deepEqual(callCount(), split('1011000000000000'));

		// accessing baz[0] - counts as changing the keys because we're fully replacing a value
		updateWithMerge({
			baz: {0: "BING"}
		});
		assert.deepEqual(callCount(), split('1000011100000000'));
		
		// changing a new index of baz
		updateWithMerge({
			baz: {4: "four"}
		});
		assert.deepEqual(callCount(), split('1000001100000000'));

		// replacing all of baz
		updateWithMerge({
			baz: "BAZ"
		});
		assert.deepEqual(callCount(), split('1001111110000000'));

		// deleting baz
		updateWithMerge({
			baz: null
		});
		assert.deepEqual(callCount(), split('1001111110000000'));

		// the non-existent property florp
		updateWithMerge({
			florp: "FLORP"
		});
		assert.deepEqual(callCount(), split('1001000001000000'));

		// accessing just root, with no actual changes
		updateWithMerge({});
		assert.deepEqual(callCount(), split('1000000000000000'));
		updateWithMerge("mystery"); // claims to replace everything
		assert.deepEqual(callCount(), split('1111111111111111'));
		updateWithMerge(null); // claims to delete everything
		assert.deepEqual(callCount(), split('1111111111111111'));

		// pierced root object
		// silent-pierced root object
		// foo
		// foo + root keys
		
		// baz (access)
		// baz[0]
		// baz keys (by baz.length)
		// baz (by piercing)
		
		// baz (by silent piercing)
		// the non-existent property .florp
		// unrelated data
		// access bip directly, but don't look at the contents
		
		// access bip with pierce
		// bip keys - should care about add/remove keys, but not changing their values
		// bip keys, with a different method
		// bip.bang - cares about changing a particular value

		// no change to bip
		updateWithMerge({bip: {}});
		assert.deepEqual(callCount(), split('1000000000001000'));
		// special replacement merge which remembers it's doing a full overwrite of bip
		let replaceMerge = api.merge.apply({bip: null}, {bip: {}}, true);
		updateWithMerge(replaceMerge);
		assert.deepEqual(callCount(), split('1001000000011111'));
		updateWithMerge({bip: 5});
		assert.deepEqual(callCount(), split('1001000000011111'));
		updateWithMerge({bip: {bang: 6}});
		assert.deepEqual(callCount(), split('1000000000001111'));
		updateWithMerge({bip: {florp: 100}});
		assert.deepEqual(callCount(), split('1000000000001110'));
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

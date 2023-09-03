Test("plain values", (api, pass, fail, assert) => {
	let plainValues = [
		50,
		5.4,
		0,
		null,
		undefined,
		"floop",
		true,
		false,
		Symbol('symbol'),
		function(){},
		a => a + a
	];
	plainValues.forEach(data => {
		let mergeObj = {merge: (typeof data)};
		let result = api.merge.addHidden(data, mergeObj);
		
		assert(result === data);
	});
	pass();
});

Test("no extra keys", (api, pass, fail, assert) => {
	let data = {'foo': 'bar'};
	
	let withExtra = api.merge.addHidden(data, {'bing': 5});
	
	assert.deepEqual(data, withExtra);
	assert.deepEqual(Object.keys(data), ['foo']);
	assert.deepEqual(Object.keys(withExtra), ['foo']);

	pass();
});

Test("get", (api, pass, fail, assert) => {
	let data = {foo: {bar: 'baz', bing: 'zap'}, extra: {no: 'merge'}};
	let merge = {foo: {bar: 10}};
	
	let withExtra = api.merge.addHidden(data, merge);
	
	assert.deepEqual(data, withExtra);

	// It returns the object if there isn't a hidden merge
	assert(api.merge.getHidden(data) === data);
	// It returns the hidden merge if it exists
	assert(api.merge.getHidden(withExtra) === merge);
	
	// It recurses into properties
	assert(api.merge.getHidden(withExtra.foo) === merge.foo);
	// but has a "no change" value
	assert(api.merge.getHidden(withExtra.extra) === undefined);
	// which we can set
	let fallback = {fallback: 'value'};
	assert(api.merge.getHidden(withExtra.extra, fallback) === fallback);

	pass();
});


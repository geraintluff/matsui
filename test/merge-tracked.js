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
		let tracked = api.merge.tracked(data);
		assert(tracked == data, "data: " + (data ? data.toString() : data));

		let tracked2 = api.merge.tracked(data, x => x, true);
		assert(tracked2 == data, "data: " + (data ? data.toString() : data));
	});
	pass();
});

Test("synchronous", (api, pass, fail, assert) => {
	let sixFn = (x => "six");
	let oneSymbol = Symbol("1");
	
	let expectedList = [
		{baz: sixFn},
		{foo: {bar: "five"}},
		{foo: {bing: {1: oneSymbol}}},
		{foo: {bar: null}},
		{foo: {bing: null, zap: 5}}
	];

	let data = {
		foo: {
			bar: 5,
			bing: [0, 1, 2]
		},
		baz: 6
	};
	let dataCopy = JSON.parse(JSON.stringify(data));

	function listener(mergeObj) {
		assert(typeof mergeObj != 'undefined');
		let expected = expectedList.shift();
		assert.deepEqual(mergeObj, expected);
		dataCopy = api.merge.apply(dataCopy, mergeObj);
		assert.deepEqual(dataCopy, data); // the changes represent the correct modification
	}

	let tracked = api.merge.tracked(data, listener);
	tracked.baz = sixFn;
	tracked.foo.bar = "five";
	tracked.foo.bing[1] = oneSymbol;
	delete tracked.foo.bar;
	tracked.foo = {zap: 5}
	
	assert(expectedList.length == 0);

	pass();
});

Test("asynchronous", (api, pass, fail, assert) => {
	let expectedList = [];

	let data = {
		foo: {
			bar: 5,
			bing: [0, 1, 2]
		},
		baz: function () {return 6;}
	};
	let dataCopy = JSON.parse(JSON.stringify(data));
	let original = JSON.parse(JSON.stringify(data));

	function listener(mergeObj) {
		assert(typeof mergeObj != 'undefined');
		let expected = expectedList.shift();
		assert.deepEqual(mergeObj, expected);
		dataCopy = api.merge.apply(dataCopy, mergeObj);
		assert.deepEqual(dataCopy, data); // the changes represent the correct modification
	}

	let tracked = api.merge.tracked(data, listener, true);
	tracked.baz = "six";
	tracked.foo.bar = "five";
	tracked.foo.bing[1] = "one";
	delete tracked.foo.bar;
	tracked.foo = {zap: 5};
	
	// Should have no updates at this point, but we'll get one soon
	expectedList.push(api.merge.make(original, data));
	
	setTimeout(() => {
		// The combined merge should have been executed by now
		assert(expectedList.length == 0);

		pass();
	}, 10);
});

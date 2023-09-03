Test("simple", (api, pass, fail) => {
	let data = {
		foo: {
			bar: 5
		},
		baz: 6
	};
	let merge = {foo: {bar: "five"}};
	
	let newData = api.merge.apply(data, merge);
	
	if (newData != data) return fail("objects should match");
	if (data.foo.bar != "five") return fail("foo.bar should change");
	if (data.baz != 6) return fail("baz should not change");
	
	pass();
});

Test("delete + add properties", (api, pass, fail) => {
	let data = {
		foo: {
			bar: 5
		},
		baz: 6
	};
	let merge = {foo: {bar: null}, bing: 'bop'};
	
	let newData = api.merge.apply(data, merge);
	if (newData != data) return fail("objects should match");
	
	if ('bar' in data.foo) return fail("property should be deleted");
	if (!('bing' in data)) return fail("property should be added");
	if (data.bing !== 'bop') return fail('bing == bop');
	
	pass();
});

Test("simple value merge", (api, pass, fail) => {
	let data = {
		foo: {
			bar: 5
		},
		baz: 6
	};
	let merge = false;
	
	let newData = api.merge.apply(data, merge);
	if (newData !== false) return fail("should be replaced with false");
	pass();
});

Test("simple value data", (api, pass, fail) => {
	let data = 5;
	let merge = {foo: 'bar'};
	
	let newData = api.merge.apply(data, merge);
	if (newData.foo !== 'bar') return fail("should be replaced with object");
	pass();
});

Test("array merge", (api, pass, fail) => {
	let data = {
		foo: {
			bar: 5
		},
		baz: 6
	};
	let merge = [1, 2, 3];
	
	let newData = api.merge.apply(data, merge);
	if (!Array.isArray(newData)) return fail("should be replaced with array");
	pass();
});

Test("array + array", (api, pass, fail) => {
	let data = [1, 2, 3];
	let merge = [4, 5, 6];
	
	let newData = api.merge.apply(data, merge);
	if (data == newData) return fail("should be replaced");
	if (JSON.stringify(newData) != JSON.stringify(merge)) return fail("should match the merge");
	pass();
});

Test("array + object", (api, pass, fail) => {
	let data = {foo: [0, 1, 2]};
	let merge = {
		foo: {
			0: "zero",
			2: "two"
		}
	};
	let expected = {foo: ["zero", 1, "two"]};
	
	let newData = api.merge.apply(data, merge);
	if (JSON.stringify(newData) != JSON.stringify(expected)) return fail("incorrect change");
	pass();
});

Test("make merge", (api, pass, fail) => {
	let data = {
		foo: {
			bar: [1, 2, 3]
		},
		bing: 5,
		unchanged1: 60,
		unchanged2: {a: 'b'},
		baz: {
			bip: true,
			zap: false
		}
	};
	let original = JSON.parse(JSON.stringify(data));
	let target = {
		foo: {
			bar: [1, 5, 3]
		},
		bing: 500,
		unchanged1: 60,
		unchanged2: {a: 'b'},
		baz: {
			bip: false,
			boom: true
		}
	};

	let merge = api.merge.make(data, target);

	if (JSON.stringify(data) != JSON.stringify(original)) return fail("original was changed");
	if ('unchanged1' in merge) return fail("unchanged1");
	if ('unchanged2' in merge) return fail("unchanged2");
	if (JSON.stringify(data) != JSON.stringify(original)) return fail("original was changed");

	// Check that if we apply the merge, the *new* merge between data/target is empty
	let newData = api.merge.apply(data, merge);
	if (data != newData) return fail("data != newData");
	let merge2 = api.merge.make(data, target);
	if (JSON.stringify(merge2) != "{}") return fail("merge2: " + JSON.stringify(merge2));

	pass();
});

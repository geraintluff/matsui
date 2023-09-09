Test("tracking property access", (api, pass, fail, assert) => {
	let accessed = api.access.accessed;
	let data = {
		foo: 'bar',
		baz: ['bing']
	};
	let tracker1 = {};
	let tracked1 = api.access.tracked(data, tracker1, "tracked1");
	assert(tracked1.foo === 'bar');
	assert.deepEqual(Object.keys(tracker1), ['foo']);
	assert(tracker1.foo[accessed]);
	assert(!tracker1.baz); // property not present since we didn't access it

	let tracker2 = {}
	let tracked2 = api.access.tracked(data, tracker2, "tracked2");
	assert(tracked2.foo === 'bar');
	assert(tracked2.baz[0] === 'bing');
	tracked2.baz[0]; // read it a second time, to make sure it handles duplicate access
	
	assert.deepEqual(Object.keys(tracker2).sort(), ['baz', 'foo']);

	assert(tracker2.foo[accessed]);
	assert(!tracker2.baz[accessed]); // present but not accessed
	assert(tracker2.baz[0][accessed]); // index 0 was accessed

	pass();
});

Test("piercing gets original object", (api, pass, fail, assert) => {
	let data = {
		foo: 'bar',
		baz: ['bing']
	};
	let tracker = {};

	let tracked = api.access.tracked(data, tracker, "pierced");
	let pierced = api.access.pierce(tracked);
	assert(pierced === data);
	assert(tracker[api.access.accessed]);

	assert(!tracker.baz);
	let piercedBaz = api.access.pierce(tracked.baz);
	assert(piercedBaz === data.baz);
	assert(tracker.baz[api.access.accessed]);

	pass();
});

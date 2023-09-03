Test("tracking property access", (api, pass, fail, assert) => {
	let data = {
		foo: 'bar',
		baz: ['bing']
	};
	let tracker = {};

	let tracked1 = api.access.tracked(data, tracker, "tracked1");
	assert(tracked1.foo === 'bar');

	let tracked2 = api.access.tracked(data, tracker, "tracked2");
	assert(tracked2.foo === 'bar');
	assert(tracked2.baz[0] === 'bing');
	
	assert.deepEqual(Object.keys(tracker).sort(), ['baz', 'foo']);

	let fooList = api.access.values(tracker.foo);
	assert(fooList instanceof Set);
	assert(fooList.size == 2);
	assert(fooList.has('tracked1'));
	assert(fooList.has('tracked2'));

	let bazList = api.access.values(tracker.baz);
	assert(!bazList || bazList.size == 0);

	let baz0List = api.access.values(tracker.baz[0]);
	assert(baz0List.size == 1);
	assert(baz0List.has("tracked2"));

	pass();
});

Test("piercing gets original", (api, pass, fail, assert) => {
	let data = {
		foo: 'bar',
		baz: ['bing']
	};
	let tracker = {};

	let tracked = api.access.tracked(data, tracker, "pierced");
	let pierced = api.access.pierce(tracked);
	assert(pierced === data);

	let trackedList = api.access.values(tracker);
	assert(trackedList.size == 1);
	assert(trackedList.has("pierced"));

	pass();
});

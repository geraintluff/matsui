Test("text", (api, pass, fail, assert) => {
	let errorTemplate = _ => {
		fail("inner template should not be called");
	};
	
	let textTemplate = api.global.getNamed("text");
	let binding = textTemplate(errorTemplate);
	
	assert(binding.node instanceof Text); // Should be a DOM text node
	assert(Array.isArray(binding.updates));
	assert(binding.updates.length == 1);
	
	binding.updates[0]("foo");
	assert(binding.node.nodeValue === "foo");
	
	let element = document.createElement('div');
	element.appendChild(binding.node);
	
	binding.updates[0]("bar");
	assert(binding.node.nodeValue === "bar")
	
	pass();

}, {document: true});

Test("list", (api, pass, fail, assert) => {
	let itemConstructionCount = 0;
	
	let fallbackTemplate = () => {
		throw new Error("Shouldn't be called");
	};
	let itemTemplate = innerTemplate => {
		assert(innerTemplate === fallbackTemplate);

		++itemConstructionCount;
		let div = document.createElement('div');
		return {
			node: div,
			updates: [data => {
				div.textContent = data;
			}]
		};
	};
	
	let listTemplate = api.global.getNamed("list");
	let binding = listTemplate(_ => itemTemplate(fallbackTemplate));
	let container = document.createElement('div');
	container.append(binding.node);

	let data = '';
	let applyMerge = merge => {
		data = api.merge.apply(data, merge);
		let withMerge = api.merge.addHidden(data, merge);
		binding.updates.forEach(fn => fn(withMerge));
	};
	applyMerge('');
	assert(container.innerHTML === '');
	
	applyMerge([]);
	assert(container.innerHTML === '');
	
	applyMerge({0: 5, 1: 10});
	assert(container.innerHTML === '<div>5</div><div>10</div>');

	applyMerge(["foo", "bar"]);
	assert(container.innerHTML === '<div>foo</div><div>bar</div>');

	applyMerge(null);
	assert(container.innerHTML === '');

	/*
	applyMerge({foo: 'bar', bing: 'baz'});
	assert(container.innerHTML === '<div>foo:bar</div><div>bing:baz</div>');

	applyMerge({bip: 'zap'});
	assert(container.innerHTML === '<div>foo:bar</div><div>bing:baz</div><div>bip:zap</div>');

	applyMerge({foo: null});
	assert(container.innerHTML === '<div>bing:baz</div><div>bip:zap</div>');
	*/

	pass();

}, {document: true});

Test("combined updates", (api, pass, fail, assert) => {
	let itemConstructionCount = 0;
	
	let fallbackTemplate = () => {
		throw new Error("Shouldn't be called");
	};
	let customTemplate = innerTemplate => {
		let fooCounter = 0, barCounter = 0;
		let foo = document.createElement('span');
		let bar = document.createElement('div');

		let node = document.createDocumentFragment();
		node.append(foo, bar);
		
		return {
			node: node,
			updates: [
				data => {
					foo.textContent = `${++fooCounter}:${data.foo}`
				},
				data => {
					bar.textContent = `${++barCounter}:${data.bar}`
				}
			]
		};
	};
	
	let binding = customTemplate(fallbackTemplate);
	let container = document.createElement('div');
	container.append(binding.node);
	
	let combined;
	let data = {foo: 'foo', bar: 'bar'};
	let applyMerge = merge => {
		data = api.merge.apply(data, merge);
		let withMerge = api.merge.addHidden(data, merge);
		if (combined) {
			combined(withMerge);
		} else {
			binding.updates.forEach(fn => fn(withMerge));
		}
	};
	// Both of them run, because we don't have
	applyMerge({bar: 'BAR'});
	assert(container.innerHTML === '<span>1:foo</span><div>1:BAR</div>');
	// merge doesn't make a difference here
	applyMerge({foo: 'FOO'});
	assert(container.innerHTML === '<span>2:FOO</span><div>2:BAR</div>');
	
	combined = Matsui.combineUpdates(binding.updates);
	applyMerge({bar: 'Bar'}); // All of them are called first time
	assert(container.innerHTML === '<span>3:FOO</span><div>3:Bar</div>');
	applyMerge({foo: 'Foo'});
	assert(container.innerHTML === '<span>4:Foo</span><div>3:Bar</div>');
	applyMerge({biz: 'boop'});
	assert(container.innerHTML === '<span>4:Foo</span><div>3:Bar</div>');
	applyMerge({bar: '(bar)'});
	assert(container.innerHTML === '<span>4:Foo</span><div>4:(bar)</div>');
	applyMerge({bar: '(bar)'}); // refreshed because of the merge, even though it's the same value
	assert(container.innerHTML === '<span>4:Foo</span><div>5:(bar)</div>');

	// replace data with a different object
	data = {foo: '_foo_', bar: '_bar_'};
	applyMerge({foo: 'FOO'}); // both of them run, even though bar isn't in the merge, because the object changes
	assert(container.innerHTML === '<span>5:FOO</span><div>6:_bar_</div>');

	pass();

}, {document: true});


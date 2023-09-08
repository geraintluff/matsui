Test("template.text", (api, pass, fail, assert) => {
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

Test("template.list", (api, pass, fail, assert) => {
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


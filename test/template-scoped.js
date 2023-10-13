(() => {

	function testTemplate(template, assert) {
		let data = api.wrap({foo: 'bar', baz: 'bing'}, true);

		let host = document.createElement('div');
		let $ = (q => host.querySelector(q));

		let bound = data.addTo(host, template); // binds the template, and updates on merge/change
		// Check the binding worked
		assert($('.scoped-foo').innerHTML == 'bar');
		assert($('.baz-button').innerHTML == 'bing');
		
		// click the button
		let event = new MouseEvent("click", {
			view: window,
			bubbles: true,
			cancelable: true,
		});
		$('.baz-button').dispatchEvent(event);

		assert(data.data.foo === 'BAR'); // the click worked
		assert($('.scoped-foo').innerHTML == 'bar'); // but the display didn't update
		assert($('.baz-button').innerHTML == 'bing'); // still good
		
		data.data.baz = 'BING';
		assert($('.scoped-foo').innerHTML == 'bar'); // still not updated
		assert($('.baz-button').innerHTML == 'BING'); // but this is
		
		data.data = {foo: 'BAR', baz: 'bing!'}; // new data object
		assert($('.scoped-foo').innerHTML == 'BAR'); // it's updated now
		assert($('.baz-button').innerHTML == 'bing!'); // so is this
	}

	Test("tag", (api, pass, fail, assert) => {
		let template = api.scoped(scopedData => api.global.fromTag`
			<div class="scoped-foo">${scopedData.foo}</div>
			<button class="baz-button" $click="${e => scopedData.foo = 'BAR'}">{baz}</button>
		`);
		testTemplate(template, assert);
		
		let templateSet = api.global.extend();
		let namedTemplate = templateSet.addScoped("scoped-example", scopedData => templateSet.fromTag`
			<div class="scoped-foo">${scopedData.foo}</div>
			<button class="baz-button" $click="${e => scopedData.foo = 'BAR'}">{baz}</button>
		`);
		testTemplate(templateSet.getNamed("scoped-example"), assert);

		pass();
	}, {document: true});

	Test("inner <template>", (api, pass, fail, assert) => {
		let element = document.createElement('template');
		element.innerHTML = `
			<template @scoped="scopedData">
				<div class="scoped-foo">\${scopedData.foo}</div>
				<button class="baz-button" $click="\${e => scopedData.foo = 'BAR'}">{baz}</button>
			</template>
		`;
		testTemplate(api.global.fromElement(element), assert);

		pass();
	}, {document: true, csp: false});

	Test("inner <div>", (api, pass, fail, assert) => {
		let element = document.createElement('template');
		element.innerHTML = `
			<div @scoped="scopedData">
				<div class="scoped-foo">\${scopedData.foo}</div>
				<button class="baz-button" $click="\${e => scopedData.foo = 'BAR'}">{baz}</button>
			</div>
		`;
		testTemplate(api.global.fromElement(element), assert);

		pass();
	}, {document: true, csp: false});
	
	Test("outer <template>", (api, pass, fail, assert) => {
		let element = document.createElement('template');
		element.innerHTML = `
			<template @scoped="scopedData">
				<div class="scoped-foo">\${scopedData.foo}</div>
				<button class="baz-button" $click="\${e => scopedData.foo = 'BAR'}">{baz}</button>
			</template>
		`;
		element = element.content.querySelector('template');
		assert(element);
		testTemplate(api.global.fromElement(element), assert);
		pass();
	}, {document: true, csp: false});

	Test("outer <section>", (api, pass, fail, assert) => {
		let element = document.createElement('template');
		element.innerHTML = `
			<section @scoped="scopedData">
				<div class="scoped-foo">\${scopedData.foo}</div>
				<button class="baz-button" $click="\${e => scopedData.foo = 'BAR'}">{baz}</button>
			</section>
		`;
		element = element.content.querySelector('section');
		assert(element);
		testTemplate(api.global.fromElement(element), assert);
		pass();
	}, {document: true, csp: false});
})();

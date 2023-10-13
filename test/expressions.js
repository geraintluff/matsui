let expressionListPrefix = document.currentScript.src.replace('expressions.js', '');
Test("check expression end", (api, pass, fail, assert) => {
	let expressionFiles = ['expressions-esfuzz.js', 'expressions-eslump.js'];
	function loadNext() {
		let src = expressionListPrefix + expressionFiles.pop();
		let script = document.createElement('script');
		script.src = src;
		script.onload = e => {
			if (expressionFiles.length) return loadNext();
			done();
		}
		script.onerror = fail;
		document.head.appendChild(script);
	}
	loadNext();
	
	function done() {
		function htmlEscape(text) {
			return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
		}
		function parsedElementHtml(expr) {
			let element = document.createElement('template');
			element.innerHTML = `<div $expr="foo\$\{${htmlEscape(expr)}}bar">bing\$\{${htmlEscape(expr)}}bip</div>`;
			let template = api.global.fromElement(element);
			return element.innerHTML; // should have exactly the two expressions replaced
		}

		let reference = parsedElementHtml('foo=1'); // a known-good case
		
		let expressions = [
			// a couple of things that failed during development
			'if (/(?:)/);else;if (/[-]/);else;',
			'while(0)/~/'
		].concat(EXPRESSIONS_ESFUZZ).concat(EXPRESSIONS_ESLUMP);
		
		expressions.forEach((code, index) => {
			let expr = `function(){${code}}`;
			try {
				let fn = new Function('return ' + expr);
			} catch (e) {
				console.log(`EXPRESSIONS[${index}] failed to parse: ${e.message}`);
				console.log("Trying strict mode...");
				expr = `function(){"use strict";${code}}`
				try {
					let fn = new Function('return ' + expr);
				} catch (e) {
					console.log(`EXPRESSIONS[${index}] failed again: ${e.message}`);
					return;
				}
			}
			let html = parsedElementHtml(expr);
			assert(html == reference);
		});

		pass();
	};
}, {document: true, csp: false});

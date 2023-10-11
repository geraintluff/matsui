#!/usr/bin/env node

if (process.argv.length < 4) {
	console.error("Missing arguments: [input.js] [ClassName] [?output.js] [?prefix]");
	process.exit(1);
}
let inputFile = process.argv[2];
let className = process.argv[3];
let outputFile = process.argv[4] || inputFile.replace(/(\.min)\.js$/i, '.worker.js');
if (outputFile == inputFile) outputFile += '.worker.js';
let prefix = process.argv[5] || '';

let fs = require('fs');

let inputJs = fs.readFileSync(inputFile);

let prefixList = prefix.split('.').filter(x => x);
let outputJs = `// ./node-inline-worker.js ${process.argv.slice(2).map(JSON.stringify).join(' ')}
(function factoryHandler(factory) {
	let className = ${JSON.stringify(className)};
	let prefixList = ${JSON.stringify(prefixList)};
	if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
		// The worker
		factory.call(self);
		self.addEventListener('message', e => {
			let data = e.data;
			try {
				if (Array.isArray(data.call)) {
					let methodKey = data.call.pop();
					let obj = self;
					data.call.forEach(prop => {
						obj = obj[prop];
					});

					let result = obj[methodKey].apply(obj, [].concat(data.args));
					postMessage({
						id: data.id,
						result: result
					});
				} else {
					throw Error("unrecognised action: " + Object.keys(data));
				}
			} catch (e) {
				console.error(e);
				postMessage({
					id: data.id,
					error: {
						message: e.message,
						stack: e.stack
					}
				});
			}
		});
	} else {
		// the page
		let scriptSrc = document.currentScript.src;
		if (!scriptSrc || /^file:\\/\\//.test(scriptSrc)) {
			scriptSrc = URL.createObjectURL(new Blob([
				\`(\${factoryHandler})(\${factory});\`
			], {type: 'text/javascript'}));
		}

		function create() {
			let messageCounter = 0;
			let pendingMap = {};

			let worker = new Worker(scriptSrc);
			worker.addEventListener('message', e => {
				let id = e.data.id;
				let responder = pendingMap[id](e.data);
			});
			function functionProxy(keyPath) {
				return new Proxy(_=>_, {
					get(obj, prop) {
						return functionProxy(keyPath.concat(prop));
					},
					apply(obj, thisArg, args) {
						let messageId = (++messageCounter);
						return new Promise((pass, fail) => {
							pendingMap[messageId] = data => {
								delete pendingMap[messageId];
								if (data.error) {
									throw Error(data.error.message || data.error);
								}
								pass(data.result);
							};
						
							worker.postMessage({
								id: messageId,
								call: keyPath,
								args: args
							});
						});
					}
				});
			}
			return functionProxy(prefixList);
		}
		let singleton;
		self[className] = spawn => {
			if (spawn) {
				return create(); // new Worker
			} else {
				if (!singleton) singleton = create();
				return singleton;
			}
		}
	}
})(function() {

// ${inputFile}
${inputJs}

});`;

fs.writeFileSync(outputFile, outputJs);

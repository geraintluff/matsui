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

let inputJs = "// " + inputFile + "\n" + fs.readFileSync(inputFile);

let prefixList = prefix.split('.').filter(x => x);
let callComment = `// ./node-create-inline-worker.js ${process.argv.slice(2).map(JSON.stringify).join(' ')}`;

function factoryHandler(factory, className, prefixList) {
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
					Promise.resolve(result).then(result => {
						postMessage({
							id: data.id,
							result: result
						});
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
		if (!scriptSrc || /^file:\/\//.test(scriptSrc)) {
			scriptSrc = URL.createObjectURL(new Blob([
				`(${factoryHandler})(${factory});`
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
}

let factoryHandlerMin = 'function factoryHandler(t,o,s){if("undefined"!=typeof WorkerGlobalScope&&self instanceof WorkerGlobalScope)t.call(self),self.addEventListener("message",e=>{let t=e.data;try{if(!Array.isArray(t.call))throw Error("unrecognised action: "+Object.keys(t));{var o=t.call.pop();let r=self;t.call.forEach(e=>{r=r[e]});var s=r[o].apply(r,[].concat(t.args));Promise.resolve(s).then(e=>{postMessage({id:t.id,result:e})})}}catch(e){console.error(e),postMessage({id:t.id,error:{message:e.message,stack:e.stack}})}});else{let e=document.currentScript.src;function l(){let l=0,n={},a=new Worker(e);return a.addEventListener("message",e=>{var r=e.data.id;n[r](e.data)}),function t(s){return new Proxy(e=>e,{get(e,r){return t(s.concat(r))},apply(e,r,t){let o=++l;return new Promise((r,e)=>{n[o]=e=>{if(delete n[o],e.error)throw Error(e.error.message||e.error);r(e.result)},a.postMessage({id:o,call:s,args:t})})}})}(s)}e&&!/^file:\\/\\//.test(e)||(e=URL.createObjectURL(new Blob([`(${factoryHandler})(${t});`],{type:"text/javascript"})));let r;self[o]=e=>e?l():r=r||l()}}';

let outputJs = `${callComment}
(${factoryHandlerMin})(function(){
${inputJs}
},${JSON.stringify(className)},${JSON.stringify(prefixList)});`

fs.writeFileSync(outputFile, outputJs);
